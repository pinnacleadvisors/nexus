/**
 * lib/chat/edit-plan.ts — `edit-plan` + `edit-group-complete` fenced block
 * parsers. Fourth member of the chat-block protocol family (sibling to
 * approval-request, manual-task, iteration-plan, bug-hunt-finding).
 *
 * Purpose: split long multi-file edits into resumable per-turn chunks so a
 * single ~3-min gateway turn doesn't have to do all the work. The agent
 * emits an `edit-plan` to propose the chunking, the operator approves
 * group-by-group via the existing `APPROVAL [<plan_id>]:` reply machinery,
 * the agent works ONE group per turn and emits `edit-group-complete` at
 * the end. The enqueue route then walks history to find approved-but-
 * incomplete groups and injects a resume hint into the next turn's
 * system prompt.
 *
 * Why a separate block vs reusing approval-request: the card needs to
 * surface file lists + per-group est_turns + completion status (✓ / ⏳),
 * which doesn't fit the flat label list of approval-request. We keep the
 * reply format identical (`APPROVAL [<plan_id>]: ...`) so the agent's
 * downstream parsing doesn't change — only the rendered card differs.
 *
 * Shapes:
 *   ```edit-plan
 *   {
 *     "plan_id": "ep-2026-05-15-001",
 *     "intent":  "Add EditPlanCard + resume hint + chunking nudge",
 *     "groups": [
 *       { "id": "g1", "label": "New parser + types",
 *         "files": ["lib/chat/edit-plan.ts"], "est_turns": 1 },
 *       { "id": "g2", "label": "Poll route wiring",
 *         "files": ["app/api/.../route.ts"], "est_turns": 1 }
 *     ]
 *   }
 *   ```
 *
 *   ```edit-group-complete
 *   {
 *     "plan_id":  "ep-2026-05-15-001",
 *     "group_id": "g1",
 *     "summary":  "Created parser + buildReply. tsc clean."
 *   }
 *   ```
 *
 * Operator replies (the EditPlanCard generates these — the agent just
 * reads them in the next turn's transcript):
 *   - APPROVAL [<plan_id>]: approve g1,g2,g3        ← whole plan approved
 *   - APPROVAL [<plan_id>]: approve g1,g2           ← subset (skip rest)
 *   - APPROVAL [<plan_id>]: continue                 ← next un-completed approved group
 *   - APPROVAL [<plan_id>]: deny all
 */

export interface EditPlanGroup {
  id:         string
  label:      string
  files:      string[]
  est_turns:  number
}

export interface EditPlan {
  plan_id:  string
  intent:   string
  groups:   EditPlanGroup[]
}

export interface EditGroupComplete {
  plan_id:   string
  group_id:  string
  summary?:  string
}

export interface EditPlanParseResult {
  text:                   string
  plans:                  EditPlan[]
  group_completes:        EditGroupComplete[]
}

const PLAN_FENCE_RE     = /```edit-plan\s*\n([\s\S]*?)```/g
const COMPLETE_FENCE_RE = /```edit-group-complete\s*\n([\s\S]*?)```/g

interface RawGroup { id?: unknown; label?: unknown; files?: unknown; est_turns?: unknown }
interface RawPlan  { plan_id?: unknown; intent?: unknown; groups?: unknown }
interface RawComplete { plan_id?: unknown; group_id?: unknown; summary?: unknown }

function validatePlan(raw: unknown): EditPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as RawPlan
  if (typeof r.plan_id !== 'string' || !r.plan_id.trim()) return null
  if (typeof r.intent  !== 'string' || !r.intent.trim())  return null
  if (!Array.isArray(r.groups) || r.groups.length === 0)  return null
  const groups: EditPlanGroup[] = []
  for (const g of r.groups as RawGroup[]) {
    if (!g || typeof g !== 'object')                                    return null
    if (typeof g.id    !== 'string' || !g.id.trim())                    return null
    if (typeof g.label !== 'string' || !g.label.trim())                 return null
    if (!Array.isArray(g.files))                                        return null
    const files = (g.files as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    if (files.length === 0)                                             return null
    const est = typeof g.est_turns === 'number' && g.est_turns > 0 ? g.est_turns : 1
    groups.push({ id: g.id.trim(), label: g.label.trim(), files, est_turns: est })
  }
  return { plan_id: r.plan_id.trim(), intent: r.intent.trim(), groups }
}

function validateComplete(raw: unknown): EditGroupComplete | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as RawComplete
  if (typeof r.plan_id  !== 'string' || !r.plan_id.trim())  return null
  if (typeof r.group_id !== 'string' || !r.group_id.trim()) return null
  const out: EditGroupComplete = { plan_id: r.plan_id.trim(), group_id: r.group_id.trim() }
  if (typeof r.summary === 'string' && r.summary.trim()) out.summary = r.summary.trim()
  return out
}

/**
 * Pull every `edit-plan` and `edit-group-complete` fenced JSON block out
 * of the assistant message. Malformed blocks are LEFT in the text so the
 * operator sees the agent's attempt (same convention as the sibling
 * parsers). Returns the cleaned text + both arrays.
 */
export function parseEditPlanBlocks(assistantText: string): EditPlanParseResult {
  const plans:           EditPlan[]            = []
  const group_completes: EditGroupComplete[]   = []
  let cleaned = assistantText.replace(PLAN_FENCE_RE, (match, jsonRaw: string) => {
    let parsed: unknown
    try { parsed = JSON.parse(jsonRaw) } catch { return match }
    const plan = validatePlan(parsed)
    if (!plan) return match
    plans.push(plan)
    return ''
  })
  cleaned = cleaned.replace(COMPLETE_FENCE_RE, (match, jsonRaw: string) => {
    let parsed: unknown
    try { parsed = JSON.parse(jsonRaw) } catch { return match }
    const complete = validateComplete(parsed)
    if (!complete) return match
    group_completes.push(complete)
    return ''
  })
  return { text: cleaned.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, ''), plans, group_completes }
}

/**
 * Build the reply string the EditPlanCard auto-sends when the operator
 * clicks Approve / Continue / Deny. Reuses the `APPROVAL [...]: ...`
 * format so the agent's next-turn read doesn't need a new parser.
 */
export type EditPlanReplyMode = 'approve' | 'continue' | 'deny'

export function buildEditPlanReply(
  plan_id:          string,
  mode:             EditPlanReplyMode,
  approvedGroupIds?: string[],
): string {
  if (mode === 'deny')     return `APPROVAL [${plan_id}]: deny all`
  if (mode === 'continue') return `APPROVAL [${plan_id}]: continue`
  const ids = approvedGroupIds ?? []
  if (ids.length === 0)    return `APPROVAL [${plan_id}]: deny all`
  return `APPROVAL [${plan_id}]: approve ${ids.join(',')}`
}

/**
 * Parse an operator's `APPROVAL [<plan_id>]: ...` reply back into the
 * structured intent. Used by the enqueue-side resume-hint builder so we
 * can tell which groups have been approved without re-running the UI's
 * approval state. Tolerant of whitespace/comma variants.
 */
export interface ParsedEditPlanReply {
  plan_id:           string
  mode:              EditPlanReplyMode
  approvedGroupIds:  string[]
}

const REPLY_RE = /APPROVAL\s+\[([^\]]+)\]:\s*(.+?)\s*$/m

export function parseEditPlanReply(text: string): ParsedEditPlanReply | null {
  const m = REPLY_RE.exec(text)
  if (!m) return null
  const plan_id = m[1].trim()
  const tail    = m[2].trim()
  if (/^deny\b/i.test(tail))     return { plan_id, mode: 'deny',     approvedGroupIds: [] }
  if (/^continue\b/i.test(tail)) return { plan_id, mode: 'continue', approvedGroupIds: [] }
  const approveMatch = /^approve\s+(.+)$/i.exec(tail)
  if (!approveMatch) return null
  const ids = approveMatch[1].split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
  if (ids.length === 0) return null
  return { plan_id, mode: 'approve', approvedGroupIds: ids }
}

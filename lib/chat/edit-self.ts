/**
 * lib/chat/edit-self.ts — `edit-self` fenced block parser + reply builder.
 *
 * Absorbed from Continual Harness (arXiv 2605.09998): "self-refining
 * component hierarchy" — the agent edits its own prompt / sub-agents /
 * skills / memory mid-cycle, with operator gates. Today Nexus updates
 * those four surfaces OUT-OF-BAND (engineer opens a PR by hand). This
 * block lets the agent propose mid-cycle self-modifications via the
 * same operator-gated typed-block grammar as edit-plan / approval-request.
 *
 * Difference vs edit-plan:
 * - `edit-plan` chunks a multi-turn EXTERNAL edit (the agent edits the
 *   product codebase). Resumable across turns.
 * - `edit-self` proposes a SELF-MODIFICATION to the agent's own spec /
 *   skill / hook. One-shot — operator approves, server materialises the
 *   change as a draft PR.
 *
 * Operator-gated loop pattern invariants (per AGENTS.md):
 *   - Operator MUST approve via `APPROVAL [<plan_id>]: approve g1,g2,...`
 *   - Draft PR only — never auto-merge.
 *   - Max 6 items per edit-self block — bigger means the plan should be two.
 *   - target ∈ { agent-spec, skill, hook, memory } — the four surfaces
 *     Continual Harness identified as first-class self-modification targets.
 *
 * Shape:
 *   ```edit-self
 *   {
 *     "plan_id":     "es-2026-05-24-001",
 *     "intent":      "Add retry on 503 to firecrawl_local skill",
 *     "target":      "skill",
 *     "target_slug": "firecrawl_local",
 *     "rationale":   "Observed 8× 503s in the last 24h scraping mailer-lite.com",
 *     "items": [
 *       {
 *         "id":             "g1",
 *         "label":          "Add 1-retry-with-backoff on 503 in lib/fetch.ts",
 *         "file_path":      ".claude/skills/firecrawl_local/lib/fetch.ts",
 *         "change_summary": "Wrap the fetch() in a single retry on 503/504 with exponential backoff (500ms → 1500ms)."
 *       },
 *       {
 *         "id":             "g2",
 *         "label":          "Update SKILL.md to mention the retry",
 *         "file_path":      ".claude/skills/firecrawl_local/SKILL.md",
 *         "change_summary": "Add 'retries once on 5xx' to the 'Notes' section."
 *       }
 *     ]
 *   }
 *   ```
 *
 * Operator reply (the EditSelfCard generates these):
 *   - APPROVAL [<plan_id>]: approve g1,g2     ← approve subset
 *   - APPROVAL [<plan_id>]: approve all       ← approve everything
 *   - APPROVAL [<plan_id>]: deny all          ← reject
 *
 * On `approve` the route at `/api/chat/edit-self/apply` creates a draft
 * PR with the proposed edits. NEVER auto-merges.
 */

export type EditSelfTarget = 'agent-spec' | 'skill' | 'hook' | 'memory'

export interface EditSelfItem {
  id:             string
  label:          string
  file_path:      string
  change_summary: string
}

export interface EditSelfPlan {
  plan_id:     string
  intent:      string
  target:      EditSelfTarget
  target_slug: string
  rationale?:  string
  items:       EditSelfItem[]
}

export interface EditSelfParseResult {
  text:  string
  plans: EditSelfPlan[]
}

const FENCE_RE     = /```edit-self\s*\n([\s\S]*?)```/g
const MAX_ITEMS    = 6
const VALID_TARGETS: EditSelfTarget[] = ['agent-spec', 'skill', 'hook', 'memory']

interface RawItem { id?: unknown; label?: unknown; file_path?: unknown; change_summary?: unknown }
interface RawPlan {
  plan_id?:     unknown
  intent?:      unknown
  target?:      unknown
  target_slug?: unknown
  rationale?:   unknown
  items?:       unknown
}

function isStrOrUndef(v: unknown): v is string | undefined {
  return v === undefined || (typeof v === 'string')
}

function validate(raw: unknown): EditSelfPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as RawPlan

  if (typeof r.plan_id     !== 'string' || !r.plan_id.trim())     return null
  if (typeof r.intent      !== 'string' || !r.intent.trim())      return null
  if (typeof r.target      !== 'string')                          return null
  if (typeof r.target_slug !== 'string' || !r.target_slug.trim()) return null
  if (!isStrOrUndef(r.rationale))                                 return null

  const target = r.target as EditSelfTarget
  if (!VALID_TARGETS.includes(target)) return null

  if (!Array.isArray(r.items) || r.items.length === 0)                          return null
  if ((r.items as unknown[]).length > MAX_ITEMS)                                return null

  const items: EditSelfItem[] = []
  for (const it of r.items as RawItem[]) {
    if (!it || typeof it !== 'object')                                          return null
    if (typeof it.id             !== 'string' || !it.id.trim())                 return null
    if (typeof it.label          !== 'string' || !it.label.trim())              return null
    if (typeof it.file_path      !== 'string' || !it.file_path.trim())          return null
    if (typeof it.change_summary !== 'string' || !it.change_summary.trim())     return null
    items.push({
      id:             it.id.trim(),
      label:          it.label.trim(),
      file_path:      it.file_path.trim(),
      change_summary: it.change_summary.trim(),
    })
  }

  return {
    plan_id:     r.plan_id.trim(),
    intent:      r.intent.trim(),
    target,
    target_slug: r.target_slug.trim(),
    rationale:   typeof r.rationale === 'string' ? r.rationale.trim() : undefined,
    items,
  }
}

/**
 * Pull every `edit-self` fenced JSON block out of the assistant message.
 * Malformed blocks LEFT in the text so the operator sees the agent's
 * attempt — same convention as edit-plan / manual-task parsers.
 */
export function parseEditSelfBlocks(assistantText: string): EditSelfParseResult {
  const plans: EditSelfPlan[] = []
  const cleaned = assistantText.replace(FENCE_RE, (match, jsonRaw: string) => {
    let parsed: unknown
    try { parsed = JSON.parse(jsonRaw) } catch { return match }
    const plan = validate(parsed)
    if (!plan) return match
    plans.push(plan)
    return ''
  })
  return {
    text:  cleaned.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, ''),
    plans,
  }
}

/**
 * Build the operator's reply string. Mirrors edit-plan's APPROVAL grammar
 * so the chat-side parser doesn't need a separate code path — the same
 * `APPROVAL [<plan_id>]: ...` syntax works for both block types.
 */
export type EditSelfReplyMode = 'approve' | 'deny'

export function buildEditSelfReply(
  plan_id:           string,
  mode:              EditSelfReplyMode,
  approvedItemIds?:  string[],
): string {
  if (mode === 'deny') return `APPROVAL [${plan_id}]: deny all`
  const ids = approvedItemIds ?? []
  if (ids.length === 0) return `APPROVAL [${plan_id}]: deny all`
  return `APPROVAL [${plan_id}]: approve ${ids.join(',')}`
}

const REPLY_RE = /APPROVAL\s+\[([^\]]+)\]:\s*(.+?)\s*$/m

export interface ParsedEditSelfReply {
  plan_id:          string
  mode:             EditSelfReplyMode
  approvedItemIds:  string[]
}

/**
 * Parse an operator's APPROVAL reply back into the structured intent.
 * Used by the /apply route to determine which items to materialise.
 * Distinguishes edit-self from edit-plan replies only by the plan_id
 * prefix (`es-...` vs `ep-...`) — callers should pass only replies that
 * came after a known edit-self block.
 */
export function parseEditSelfReply(text: string): ParsedEditSelfReply | null {
  const m = REPLY_RE.exec(text)
  if (!m) return null
  const plan_id = m[1].trim()
  const tail    = m[2].trim()
  if (/^deny\b/i.test(tail))    return { plan_id, mode: 'deny',    approvedItemIds: [] }
  const approveMatch = /^approve\s+(.+)$/i.exec(tail)
  if (!approveMatch)            return null
  const subset = approveMatch[1].trim()
  if (/^all$/i.test(subset))    return { plan_id, mode: 'approve', approvedItemIds: ['*'] }
  const ids = subset.split(',').map(s => s.trim()).filter(Boolean)
  return { plan_id, mode: 'approve', approvedItemIds: ids }
}

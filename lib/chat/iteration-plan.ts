/**
 * lib/chat/iteration-plan.ts — `iteration-plan` fenced block parser.
 *
 * Third member of the chat-block protocol family (sibling to approval-request
 * and manual-task). Emitted by the bug-hunt-loop agent at the start of every
 * iteration. The chat UI renders it as an "Iteration N — Approve to run" card.
 *
 * Internally it's exactly an `approval-request` with extra structure — once
 * we've extracted the inner ApprovalRequest, the operator's approve flow
 * (APPROVAL [<id>]:) works without changes.
 *
 * Shape:
 *   {
 *     "session_id":   "bh-2026-...-i3",
 *     "iteration":    3,
 *     "approval_id":  "bh-...-i3",
 *     "scope":        "static-audit",
 *     "intent":       "...",
 *     "estimated_plan_window_pct": 4.2,    // optional — for display only
 *     "estimated_codex_window_pct": 0,     // optional
 *     "branches_planned": ["fix/bug-hunt-i3/..."],
 *     "items": [ { "id": "1", "label": "...", "approved_by_default": true }, ... ]
 *   }
 */

import type { ApprovalRequest } from './approval'

export interface IterationPlan {
  session_id:                    string
  iteration:                     number
  scope:                         string
  intent:                        string
  estimated_plan_window_pct?:    number
  estimated_codex_window_pct?:   number
  branches_planned?:             string[]
  /** Underlying ApprovalRequest — passed straight to the existing card UI. */
  approval:                      ApprovalRequest
}

export interface IterationPlanParseResult {
  text:  string
  plans: IterationPlan[]
}

const FENCED_RE = /```iteration-plan\s*\n([\s\S]*?)```/g

interface RawIterationPlan {
  session_id?:                    unknown
  iteration?:                     unknown
  approval_id?:                   unknown
  scope?:                         unknown
  intent?:                        unknown
  estimated_plan_window_pct?:     unknown
  estimated_codex_window_pct?:    unknown
  branches_planned?:              unknown
  items?:                         unknown
  title?:                         unknown
}

interface RawItem { id?: unknown; label?: unknown; approved_by_default?: unknown }

function validateAndExtract(raw: unknown): IterationPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as RawIterationPlan
  if (typeof r.session_id  !== 'string' || !r.session_id.trim())  return null
  if (typeof r.iteration   !== 'number' || r.iteration < 1)       return null
  if (typeof r.approval_id !== 'string' || !r.approval_id.trim()) return null
  if (typeof r.scope       !== 'string' || !r.scope.trim())       return null
  if (typeof r.intent      !== 'string' || !r.intent.trim())      return null
  if (!Array.isArray(r.items) || r.items.length === 0)            return null
  const items: ApprovalRequest['items'] = []
  for (const it of r.items as RawItem[]) {
    if (!it || typeof it !== 'object') return null
    if (typeof it.id !== 'string' || !it.id.trim()) return null
    if (typeof it.label !== 'string' || !it.label.trim()) return null
    items.push({
      id:                   it.id,
      label:                it.label,
      approved_by_default:  it.approved_by_default !== false,
    })
  }
  const approval: ApprovalRequest = {
    title:        (typeof r.title === 'string' && r.title.trim()) ? r.title : `Iteration ${r.iteration} — ${r.scope}`,
    approval_id:  r.approval_id,
    items,
  }
  const plan: IterationPlan = {
    session_id: r.session_id.trim(),
    iteration:  r.iteration,
    scope:      r.scope.trim(),
    intent:     r.intent.trim(),
    approval,
  }
  if (typeof r.estimated_plan_window_pct  === 'number') plan.estimated_plan_window_pct  = r.estimated_plan_window_pct
  if (typeof r.estimated_codex_window_pct === 'number') plan.estimated_codex_window_pct = r.estimated_codex_window_pct
  if (Array.isArray(r.branches_planned))                plan.branches_planned           = (r.branches_planned as unknown[]).filter((s): s is string => typeof s === 'string')
  return plan
}

/**
 * Pull every `iteration-plan` fenced JSON block out of the assistant
 * message. Malformed / invalid blocks are LEFT in the text (render raw
 * so the operator sees the agent's attempt) — same convention as the
 * approval/manual-task parsers.
 */
export function parseIterationPlans(assistantText: string): IterationPlanParseResult {
  const plans: IterationPlan[] = []
  const cleaned = assistantText.replace(FENCED_RE, (match, jsonRaw: string) => {
    let parsed: unknown
    try { parsed = JSON.parse(jsonRaw) } catch { return match }
    const plan = validateAndExtract(parsed)
    if (!plan) return match
    plans.push(plan)
    return ''
  })
  return { text: cleaned.replace(/^\s+|\s+$/g, ''), plans }
}

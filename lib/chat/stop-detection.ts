/**
 * lib/chat/stop-detection.ts — detect when an operator's APPROVAL reply
 * targets a prior `iteration-plan` block whose `scope === 'stop'`.
 *
 * Background: the bug-hunt-loop agent emits an `iteration-plan` block
 * with `scope: 'stop'` to propose ending the session. The operator
 * replies `APPROVAL [<approval_id>]: approve 1` (item 1 is the
 * "End session — status=done" action by convention). Until this
 * helper landed, that reply was just text — the platform-chat enqueue
 * route fed it back into the agent which proposed ANOTHER iteration,
 * leaving the operator stuck approving stop after stop. The fix lives
 * in the enqueue route (see app/api/platform-chat/route.ts): if this
 * helper returns a match, short-circuit before dispatching the agent
 * and flip the bug-hunt session status to 'done' server-side.
 *
 * Scope discipline: this helper ONLY fires for plans with `scope: 'stop'`
 * AND when item "1" is in the approved set. Every other approval shape
 * — different scope, non-matching approval_id, deny-all, item 1 skipped
 * — returns null so existing iterate/audit/fix-pr flows are untouched.
 */

import type { ChatMessageRow } from '@/lib/chat/sessions'
import type { IterationPlan }  from '@/lib/chat/iteration-plan'

export interface ApprovedStopRequest {
  /** The iteration-plan whose approval matched. */
  plan:        IterationPlan
  /** The bug-hunt session that should be flipped to 'done'. */
  sessionId:   string
  /** Items the operator actually approved (for audit / logging). */
  approvedItemIds: string[]
}

/**
 * Internal — parse `APPROVAL [<id>]: ...` replies. Handles the three
 * canonical shapes:
 *   APPROVAL [id]: approve 1,2,3
 *   APPROVAL [id]: approve 1 (skip 2,3)
 *   APPROVAL [id]: deny all
 * Returns null when the text isn't an APPROVAL reply.
 *
 * Not exported because the edit-plan family has its own parser
 * (`parseEditPlanReply`) — keeping a separate one here lets us evolve
 * iteration-plan replies independently without leaking into edit-plan
 * resume logic.
 */
const REPLY_RE = /APPROVAL\s+\[([^\]]+)\]:\s*(.+?)\s*$/m

function parseIterationApprovalReply(text: string): { approvalId: string; approvedItemIds: string[] } | null {
  const m = REPLY_RE.exec(text)
  if (!m) return null
  const approvalId = m[1].trim()
  const tail       = m[2].trim()
  if (!approvalId) return null
  if (/^deny\b/i.test(tail)) return { approvalId, approvedItemIds: [] }
  // `approve 1,2 (skip 3)` → strip the parenthetical, then split the rest.
  // The `(skip ...)` clause is informational; only the leading list is the
  // approved set.
  const am = /^approve\s+([^()]+?)(?:\s*\(.*\))?\s*$/i.exec(tail)
  if (!am) return null
  const ids = am[1].split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
  if (ids.length === 0) return null
  return { approvalId, approvedItemIds: ids }
}

/**
 * Walk backwards through assistant messages looking for an iteration-plan
 * (in `metadata.iteration_plans`) whose `approval_id` matches the operator's
 * latest reply AND whose `scope === 'stop'` AND whose approved items
 * include item "1". Returns the match or null.
 *
 * `messages` should be the recent chat history in chronological order
 * (oldest first); the function reverses internally to find the newest
 * matching plan. `lastUserText` is the operator's most recent message
 * — typically the in-flight turn's `lastUser.content`.
 */
export function findApprovedStopRequest(
  messages: ChatMessageRow[],
  lastUserText: string,
): ApprovedStopRequest | null {
  const reply = parseIterationApprovalReply(lastUserText)
  if (!reply) return null
  if (!reply.approvedItemIds.includes('1')) return null

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    const meta = (m.metadata && typeof m.metadata === 'object')
      ? (m.metadata as { iteration_plans?: IterationPlan[] })
      : null
    const plans = meta?.iteration_plans
    if (!Array.isArray(plans) || plans.length === 0) continue
    for (const p of plans) {
      if (!p || typeof p !== 'object') continue
      if (p.scope !== 'stop') continue
      if (p.approval?.approval_id !== reply.approvalId) continue
      if (!p.session_id) continue
      return {
        plan:            p,
        sessionId:       p.session_id,
        approvedItemIds: reply.approvedItemIds,
      }
    }
  }
  return null
}

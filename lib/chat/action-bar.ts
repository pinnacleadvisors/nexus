/**
 * lib/chat/action-bar.ts — pick the "currently actionable" thing in a
 * chat session so the FloatingActionBar can render one canonical button
 * above the input.
 *
 * Why this exists: with edit-plan multi-turn flows, the EditPlanCard
 * that needs a Continue click can scroll out of view as the agent
 * works through groups. Operator shouldn't have to scroll up to the
 * card to click. The bar surfaces the same action just above the input.
 *
 * Priority (most-recent → most-urgent):
 *   1. edit-plan-continue   ← agent finished a group, waiting for next OK
 *   2. edit-plan-approve    ← agent proposed a plan, waiting for first OK
 *   3. approval-request     ← regular inline approval card
 *
 * Returns null when nothing's pending. The bar component hides in that
 * case.
 *
 * Shared between PlatformChat and BusinessChat so both surfaces stay in
 * UX lockstep.
 */

import type { ApprovalRequest } from './approval'
import type { EditPlan } from './edit-plan'
import type { EditPlanResolution } from '@/components/platform-chat/EditPlanCard'
import type { ApprovalResolution } from './approval-resolutions'

/** Minimum shape both PlatformChat.Message and BusinessChat.Message satisfy. */
export interface ChatMessageLike {
  role:                   'user' | 'assistant'
  approval_requests?:     ApprovalRequest[]
  approval_resolutions?:  Record<string, { approvedItemIds: string[]; deniedItemIds: string[] }>
  edit_plans?:            EditPlan[]
}

export type ChatAction =
  | { kind: 'edit-plan-continue'; plan: EditPlan; nextGroupId: string; nextGroupLabel: string; nextGroupFiles: string[] }
  | { kind: 'edit-plan-approve';  plan: EditPlan }
  | { kind: 'approval-request';   request: ApprovalRequest }

/**
 * Find the most-recent unresolved action across the message list. Walks
 * messages in reverse — the LAST assistant message wins. Within a single
 * message, edit-plans take priority over approval-requests because
 * edit-plans are usually emitted standalone while approval-requests can
 * coexist with prose.
 *
 * Returns null when no action is pending (idle chat) or when the most-
 * recent action is already resolved (everything approved + complete).
 */
export function pickPendingAction(
  messages: ChatMessageLike[],
  editPlanResolutions: Map<string, EditPlanResolution>,
  approvalResolutions: Map<string, ApprovalResolution> = new Map(),
): ChatAction | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue

    // 1. edit-plan-continue takes priority — there's an approved plan
    //    mid-flight and the operator's click drives the next group.
    for (const plan of m.edit_plans ?? []) {
      const res = editPlanResolutions.get(plan.plan_id)
      if (!res || res.denied) continue
      const incomplete = res.approvedGroupIds.filter(g => !res.completedGroupIds.includes(g))
      if (incomplete.length === 0) continue
      const next = plan.groups.find(g => incomplete.includes(g.id))
      if (!next) continue
      return {
        kind:           'edit-plan-continue',
        plan,
        nextGroupId:    next.id,
        nextGroupLabel: next.label,
        nextGroupFiles: next.files,
      }
    }

    // 2. edit-plan-approve — the agent emitted a plan but no groups have
    //    been approved yet.
    for (const plan of m.edit_plans ?? []) {
      const res = editPlanResolutions.get(plan.plan_id)
      if (res?.denied) continue
      if ((res?.approvedGroupIds.length ?? 0) > 0) continue
      return { kind: 'edit-plan-approve', plan }
    }

    // 3. approval-request — regular inline card. Prefer the history-DERIVED
    //    resolution (survives reload + re-emit); fall back to the message-local
    //    resolution set by handleApproval for the same-render-tick window before
    //    the APPROVAL reply lands in `messages`.
    for (const req of m.approval_requests ?? []) {
      if (approvalResolutions.get(req.approval_id)) continue
      if (m.approval_resolutions?.[req.approval_id]) continue
      return { kind: 'approval-request', request: req }
    }
  }
  return null
}

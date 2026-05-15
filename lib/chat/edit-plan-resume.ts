/**
 * lib/chat/edit-plan-resume.ts — walk recent chat history to detect an
 * in-progress edit-plan and build a system-prompt hint that re-anchors
 * the next turn on the right group.
 *
 * Called from the enqueue routes (platform-chat + business-chat) right
 * before the system prompt is assembled. If the operator has an active
 * edit-plan with approved-but-not-yet-completed groups, the agent gets:
 *
 *   ## ⏳ Resume edit-plan ep-2026-05-15-001
 *   Approved groups: g1, g2, g3
 *   Completed:       g1
 *   Next group:      g2 — "Poll route wiring"
 *   Files:           app/api/.../poll/route.ts, app/api/.../chat/poll/route.ts
 *   Edit ONLY g2's files this turn. End the turn with an
 *   `edit-group-complete` fenced JSON block, then ask the operator to continue.
 *
 * Aggregates state across messages: edit-plan blocks may appear in older
 * messages, group-completes accumulate, operator's APPROVAL replies set
 * approved groups. Latest plan wins on plan_id collision (re-emitted plan
 * replaces earlier one of the same id).
 */

import type { ChatMessageRow } from '@/lib/chat/sessions'
import { parseEditPlanReply, type EditPlan, type EditGroupComplete } from '@/lib/chat/edit-plan'

interface AggregatedState {
  plansById:        Map<string, EditPlan>             // plan_id -> last seen
  approvedByPlan:   Map<string, Set<string>>          // plan_id -> Set<group_id>
  completedByPlan:  Map<string, Set<string>>          // plan_id -> Set<group_id>
}

interface MessageMeta {
  edit_plans?:           EditPlan[]
  edit_group_completes?: EditGroupComplete[]
}

function aggregate(messages: ChatMessageRow[]): AggregatedState {
  const plansById:       Map<string, EditPlan>         = new Map()
  const approvedByPlan:  Map<string, Set<string>>      = new Map()
  const completedByPlan: Map<string, Set<string>>      = new Map()

  for (const m of messages) {
    if (m.role === 'assistant' || m.role === 'system') {
      const meta = (m.metadata && typeof m.metadata === 'object') ? (m.metadata as MessageMeta) : {}
      for (const p of meta.edit_plans ?? []) plansById.set(p.plan_id, p)
      for (const c of meta.edit_group_completes ?? []) {
        if (!completedByPlan.has(c.plan_id)) completedByPlan.set(c.plan_id, new Set())
        completedByPlan.get(c.plan_id)!.add(c.group_id)
      }
    } else if (m.role === 'user') {
      // The EditPlanCard auto-sends `APPROVAL [<plan_id>]: ...` strings.
      // We parse those out to know which groups the operator has approved
      // / asked to continue. Tolerant of free-form prose around the reply.
      const reply = parseEditPlanReply(m.content)
      if (reply && plansById.has(reply.plan_id)) {
        if (reply.mode === 'approve' && reply.approvedGroupIds.length > 0) {
          if (!approvedByPlan.has(reply.plan_id)) approvedByPlan.set(reply.plan_id, new Set())
          for (const id of reply.approvedGroupIds) approvedByPlan.get(reply.plan_id)!.add(id)
        }
        if (reply.mode === 'deny') {
          // Operator dropped this plan — clear approvals so no resume.
          approvedByPlan.delete(reply.plan_id)
        }
        // 'continue' carries no new approvals — it's the agent's cue, not state change.
      }
    }
  }

  return { plansById, approvedByPlan, completedByPlan }
}

/**
 * Build the resume-hint string for the next turn. Returns '' when nothing
 * is in progress. Picks the MOST RECENT edit-plan that still has
 * approved-but-incomplete groups.
 */
export function buildEditPlanResumeHint(messages: ChatMessageRow[]): string {
  const { plansById, approvedByPlan, completedByPlan } = aggregate(messages)
  if (plansById.size === 0) return ''

  // Iterate in reverse insertion order (most recent first).
  const planIdsByRecency = [...plansById.keys()].reverse()
  for (const planId of planIdsByRecency) {
    const plan      = plansById.get(planId)!
    const approved  = approvedByPlan.get(planId)  ?? new Set<string>()
    const completed = completedByPlan.get(planId) ?? new Set<string>()
    if (approved.size === 0) continue
    const pending = [...approved].filter(g => !completed.has(g))
    if (pending.length === 0) continue
    // Resume on the FIRST group in plan order that's pending — agents work
    // through the plan sequentially, not in operator's approve-click order.
    const nextGroup = plan.groups.find(g => pending.includes(g.id))
    if (!nextGroup) continue
    const completedList = completed.size > 0 ? [...completed].join(', ') : 'none yet'
    const approvedList  = [...approved].join(', ')
    return [
      '',
      '',
      `## ⏳ Resume edit-plan ${planId}`,
      '',
      `**Approved groups:** ${approvedList}`,
      `**Completed:** ${completedList}`,
      `**Next group:** ${nextGroup.id} — "${nextGroup.label}"`,
      `**Files to edit this turn:** ${nextGroup.files.join(', ')}`,
      '',
      `Edit ONLY ${nextGroup.id}'s files this turn. Do NOT redo completed groups.`,
      'End the turn with an `edit-group-complete` fenced JSON block once done:',
      '',
      '```edit-group-complete',
      `{ "plan_id": "${planId}", "group_id": "${nextGroup.id}", "summary": "<one line>" }`,
      '```',
      '',
      'Then ask the operator to continue (the EditPlanCard\'s "Continue" button sends `APPROVAL [<plan_id>]: continue`).',
      '',
    ].join('\n')
  }
  return ''
}

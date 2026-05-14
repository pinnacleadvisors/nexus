/**
 * lib/bug-hunt/termination.ts — termination heuristic for the bug-hunt loop.
 *
 * Centralises the "should this loop suggest stopping?" decision so both
 * the agent (via `/api/bug-hunt/[id]/should-terminate`) and the UI
 * (BugHuntView could surface a hint if we ever want it) agree on the
 * answer. The heuristic is a pure function of the session row +
 * findings + plan-window usage — no IO inside this module.
 *
 * Termination conditions (any one trips):
 *   - 2 consecutive 0-net-new-findings iterations
 *   - Plan-window session-share ≥ session's plan_window_share_pct
 *   - Codex-window session-share ≥ session's codex_window_share_pct
 *   - USD spent ≥ budget (only when force_plan_window=false)
 *   - iteration_count ≥ max_iterations - 1   (proactive stop suggestion
 *     so the operator has a chance to bump max_iterations)
 *   - All findings are in pr-opened / merged / wont-fix
 */

import type { BugHuntSessionRow, BugHuntFindingRow } from './sessions'
import type { PlanWindowUsage } from '@/lib/claw/plan-window'

export type TerminationReason =
  | 'no-new-findings'
  | 'plan-window-cap'
  | 'codex-window-cap'
  | 'usd-budget'
  | 'iteration-cap'
  | 'all-findings-resolved'

export interface TerminationDecision {
  shouldStop:  boolean
  reasons:     TerminationReason[]
  /** Single-line summary suitable for the agent's next iteration-plan body. */
  summary:     string
}

export interface TerminationInput {
  session:   BugHuntSessionRow
  findings:  BugHuntFindingRow[]
  maxUsage:  PlanWindowUsage
  proUsage:  PlanWindowUsage
}

/**
 * "Net new" findings per iteration — count rows whose iteration matches.
 * Returns array indexed by iteration (1-based). [0] is unused.
 */
function findingsPerIteration(findings: BugHuntFindingRow[], maxIter: number): number[] {
  const counts = new Array<number>(maxIter + 1).fill(0)
  for (const f of findings) {
    if (f.iteration >= 1 && f.iteration <= maxIter) counts[f.iteration]++
  }
  return counts
}

export function shouldTerminate(input: TerminationInput): TerminationDecision {
  const { session, findings, maxUsage, proUsage } = input
  const reasons: TerminationReason[] = []

  // 1. 2 consecutive iterations with 0 net-new findings
  if (session.iteration_count >= 2) {
    const counts = findingsPerIteration(findings, session.iteration_count)
    if (counts[session.iteration_count] === 0 && counts[session.iteration_count - 1] === 0) {
      reasons.push('no-new-findings')
    }
  }

  // 2. Plan-window session share at or above cap
  if (maxUsage.sessionSharePct >= session.plan_window_share_pct) {
    reasons.push('plan-window-cap')
  }

  // 3. Codex-window session share at or above cap (only meaningful if codex was used)
  if (proUsage.sessionWeightedTurns > 0 && proUsage.sessionSharePct >= session.codex_window_share_pct) {
    reasons.push('codex-window-cap')
  }

  // 4. USD fallback cap — only when force_plan_window is OFF
  if (!session.force_plan_window && session.spent_usd >= session.budget_usd) {
    reasons.push('usd-budget')
  }

  // 5. Iteration cap (proactive — one before the hard cap)
  if (session.iteration_count >= session.max_iterations - 1) {
    reasons.push('iteration-cap')
  }

  // 6. All findings already routed somewhere
  if (findings.length > 0 && findings.every(f => f.status !== 'open')) {
    reasons.push('all-findings-resolved')
  }

  return {
    shouldStop: reasons.length > 0,
    reasons,
    summary:    summarise(reasons, session, maxUsage, proUsage, findings.length),
  }
}

function summarise(
  reasons: TerminationReason[],
  s: BugHuntSessionRow,
  maxU: PlanWindowUsage,
  proU: PlanWindowUsage,
  totalFindings: number,
): string {
  if (reasons.length === 0) return 'Loop healthy — propose next iteration.'
  const bits = []
  bits.push(`iter ${s.iteration_count}/${s.max_iterations}`)
  bits.push(`max ${maxU.sessionSharePct.toFixed(0)}%/${s.plan_window_share_pct}%`)
  if (proU.sessionWeightedTurns > 0) bits.push(`codex ${proU.sessionSharePct.toFixed(0)}%/${s.codex_window_share_pct}%`)
  if (!s.force_plan_window) bits.push(`$${s.spent_usd.toFixed(2)}/$${s.budget_usd.toFixed(2)}`)
  return `Stop suggested (${reasons.join(', ')}): ${bits.join(' · ')} · ${totalFindings} total findings.`
}

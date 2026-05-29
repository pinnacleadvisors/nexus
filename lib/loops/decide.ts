/**
 * lib/loops/decide.ts — pure termination decision for a Loop.
 *
 * Given the Loop's bounds + current progress, decide what the loop-runner
 * should do next. Pure + side-effect-free so it's trivially testable and the
 * iteration-result endpoint stays thin.
 *
 *   stop           — caps hit, kill-switch fired, or status done/killed.
 *                    The runner ends the session.
 *   await-approval — status paused (operator intervened). The runner halts
 *                    and does NOT self-continue; operator resumes via PATCH.
 *   continue       — under all caps, status active. Run the next iteration.
 */

import type { Loop, LoopNextInstruction } from './types'

export interface DecideInputs {
  loop:              Pick<Loop, 'status' | 'iteration_cap' | 'time_cap_hours' | 'cost_cap_usd' | 'created_at'>
  /** Number of iterations already started (including the one just resolved). */
  iterationsSoFar:   number
  /** Cumulative USD attributed to the loop so far. */
  spentUsd:          number
  /** True when checkKillSwitch reported kill for the loop's business. */
  killSwitchFired?:  boolean
  now?:              Date
}

export interface DecideResult {
  instruction: LoopNextInstruction
  reason:      string
}

export function decideNextInstruction(input: DecideInputs): DecideResult {
  const { loop } = input
  const now = input.now ?? new Date()

  if (loop.status === 'done' || loop.status === 'killed') {
    return { instruction: 'stop', reason: `loop_status_${loop.status}` }
  }
  if (loop.status === 'paused') {
    return { instruction: 'await-approval', reason: 'loop_paused' }
  }
  if (input.killSwitchFired) {
    return { instruction: 'stop', reason: 'kill_switch' }
  }
  if (loop.iteration_cap !== null && loop.iteration_cap !== undefined && input.iterationsSoFar >= loop.iteration_cap) {
    return { instruction: 'stop', reason: 'iteration_cap_reached' }
  }
  if (loop.cost_cap_usd !== null && loop.cost_cap_usd !== undefined && input.spentUsd >= loop.cost_cap_usd) {
    return { instruction: 'stop', reason: 'cost_cap_reached' }
  }
  if (loop.time_cap_hours !== null && loop.time_cap_hours !== undefined) {
    const elapsedHours = (now.getTime() - new Date(loop.created_at).getTime()) / (1000 * 60 * 60)
    if (elapsedHours >= loop.time_cap_hours) {
      return { instruction: 'stop', reason: 'time_cap_reached' }
    }
  }
  return { instruction: 'continue', reason: 'under_caps' }
}

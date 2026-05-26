/**
 * lib/simulation/auto-approver.ts — heuristic decider for auto-pilot
 * simulation mode. Pure function; no LLM call; deterministic from
 * (event, policy) so replays produce identical outcomes.
 *
 * Three policies — pick the one that stress-tests the agent stack the
 * way the operator wants for this run:
 *
 *   - permissive: approve everything except gates marked `irreversible`.
 *                 Models "trusting operator" — good for end-to-end
 *                 happy-path coverage.
 *   - skeptical:  approve only if the payload has a non-empty
 *                 justification AND the gate isn't irreversible. Models
 *                 "careful operator" — exercises the reject branches.
 *   - random:     approve with probability 0.7, reject 0.3. Models
 *                 "noisy operator" — exercises both branches and lets
 *                 the engine surface "what % went through" stats.
 *
 * Why no LLM: the chaos harness must be free to run. A 30-sim-day run
 * with poisson(2) gate events / day → ~15-40 gate decisions per run.
 * Doing those via Claude would cost meaningful $$$ and would slow each
 * tick. Heuristics are exactly the right tool for "does the approve/
 * reject path work and how often does each fire under each policy".
 */

import type { SimEvent } from './timeline'

export type ApproverPolicy = 'permissive' | 'skeptical' | 'random'

export interface ApproverDecision {
  decision:  'approve' | 'reject'
  rationale: string
}

// Tiny seedable PRNG so a (run_seed, event_idx) pair reproduces the same
// random decision when the same run is re-graded.
function rngFor(seed: string): () => number {
  let h = 2166136261 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  }
  let state = h >>> 0
  return function (): number {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function decideApproval(
  event: SimEvent,
  policy: ApproverPolicy,
  /** Optional stable seed for replay — e.g. `${run_seed}:${event_idx}`. */
  seed?: string,
): ApproverDecision {
  if (event.kind !== 'approval_gate') {
    return { decision: 'approve', rationale: 'non-gate-event' }
  }
  const payload = event.payload as {
    gate_kind?:     string
    justification?: string
    irreversible?:  boolean
  }
  const irreversible    = Boolean(payload.irreversible)
  const hasJustification = typeof payload.justification === 'string'
    && payload.justification.trim().length > 0

  switch (policy) {
    case 'permissive':
      if (irreversible) {
        return {
          decision:  'reject',
          rationale: 'irreversible-default-reject-under-permissive',
        }
      }
      return { decision: 'approve', rationale: 'permissive-default-approve' }

    case 'skeptical':
      if (irreversible) {
        return {
          decision:  'reject',
          rationale: 'irreversible-rejected-under-skeptical',
        }
      }
      if (!hasJustification) {
        return {
          decision:  'reject',
          rationale: 'no-justification-rejected-under-skeptical',
        }
      }
      return { decision: 'approve', rationale: 'skeptical-justified-approve' }

    case 'random': {
      const rng = rngFor(seed ?? `${event.sim_day}:${event.sim_hour}:${payload.gate_kind ?? '?'}`)
      const roll = rng()
      if (roll < 0.7) {
        return { decision: 'approve', rationale: `random-approve-${roll.toFixed(3)}` }
      }
      return { decision: 'reject', rationale: `random-reject-${roll.toFixed(3)}` }
    }
  }
}

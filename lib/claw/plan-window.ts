/**
 * lib/claw/plan-window.ts — Claude Max + ChatGPT Pro plan-window math.
 *
 * Anthropic doesn't expose remaining quota over an API, so we declare a
 * ceiling per plan via env vars and measure consumption against it. The
 * bug-hunt loop reads these to decide whether the next iteration is
 * within its budgeted share of the rolling 5-hour window.
 *
 * Ceilings tunable via `MAX_PLAN_5H_TURNS_CEILING` + `PRO_PLAN_5H_TURNS_CEILING`
 * (see memory/platform/SECRETS.md for tuning recipe).
 */

import { listTurnsInWindow, type GatewayPlan, type GatewayTurnRow } from './gateway-turns'

const DEFAULT_MAX_CEILING = 150
const DEFAULT_PRO_CEILING = 100

export interface PlanWindowUsage {
  plan:                GatewayPlan
  ceiling:             number
  windowWeightedTurns: number     // total user consumption on this plan in the last 5h
  windowSharePct:      number     // windowWeightedTurns / ceiling * 100
  sessionWeightedTurns: number    // subset attributable to a sessionTag prefix
  sessionSharePct:     number     // sessionWeightedTurns / ceiling * 100
}

export function ceilingForPlan(plan: GatewayPlan): number {
  if (plan === 'claude-max') return Number(process.env.MAX_PLAN_5H_TURNS_CEILING ?? DEFAULT_MAX_CEILING)
  if (plan === 'codex-pro')  return Number(process.env.PRO_PLAN_5H_TURNS_CEILING ?? DEFAULT_PRO_CEILING)
  return Number.POSITIVE_INFINITY     // anthropic-api fallback isn't bounded by a plan window
}

/**
 * Per-model weight. Opus is the only one substantially heavier than
 * baseline Sonnet (5× Anthropic's published multiplier). Haiku is 0.25×.
 * Codex models default to 1× since the Pro plan tracks at-most-200-prompts/5h
 * symmetrically.
 */
export function weightForModel(model: string | null): number {
  const m = (model ?? '').toLowerCase()
  if (m.includes('opus'))   return 5
  if (m.includes('haiku'))  return 0.25
  if (m.includes('sonnet')) return 1
  if (m.includes('codex'))  return 1
  if (m.startsWith('gpt'))  return 1
  return 1
}

function sumWeighted(rows: GatewayTurnRow[]): number {
  let sum = 0
  for (const r of rows) sum += weightForModel(r.model)
  return sum
}

/**
 * Compute usage for a specific plan + optional sessionTag prefix.
 * Returns the same shape regardless of plan — the bug-hunt UI binds both
 * Max and Pro into the same component.
 */
export async function getPlanWindowUsage(
  userId: string,
  plan: GatewayPlan,
  sessionTagPrefix?: string,
): Promise<PlanWindowUsage> {
  const rows = await listTurnsInWindow(userId, plan, 5)
  const windowWeightedTurns = sumWeighted(rows)
  const sessionRows = sessionTagPrefix
    ? rows.filter(r => r.session_tag && r.session_tag.startsWith(sessionTagPrefix))
    : []
  const sessionWeightedTurns = sumWeighted(sessionRows)
  const ceiling = ceilingForPlan(plan)
  return {
    plan,
    ceiling,
    windowWeightedTurns,
    windowSharePct:       ceiling > 0 && Number.isFinite(ceiling) ? (windowWeightedTurns  / ceiling) * 100 : 0,
    sessionWeightedTurns,
    sessionSharePct:      ceiling > 0 && Number.isFinite(ceiling) ? (sessionWeightedTurns / ceiling) * 100 : 0,
  }
}

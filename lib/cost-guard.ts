/**
 * cost-guard — daily AI-spend caps + experiment kill-switch.
 *
 * Two daily-cap scopes, both enforced per call:
 *   1. user-level   USER_DAILY_USD_LIMIT          (default $25/day)
 *   2. business     USER_BUSINESS_DAILY_USD_LIMIT (default $10/day, only when businessSlug is set)
 *
 * The business cap fires first when applicable; user cap is the ceiling. Either trip
 * returns ok=false with the matching scope so the caller can return a precise 402.
 *
 * Plus an experiment kill-switch (`checkKillSwitch`) for autonomous business
 * experiments — fires on cumulative budget exhaustion or 7-day stagnation
 * (when the auto-pivot is also exhausted). Called by the solopreneur-tick
 * and codex-maintainer-tick cron routes BEFORE any LLM dispatch.
 */

import { createServerClient } from '@/lib/supabase'

const DEFAULT_USER_DAILY_USD     = 25
const DEFAULT_BUSINESS_DAILY_USD = 10

const SEVEN_DAYS_MS              = 7 * 24 * 60 * 60 * 1000
const STAGNATION_REVENUE_USD     = 5
const STAGNATION_SIGNUPS         = 50

export type CostCapScope = 'user' | 'business'

export interface CostCapResult {
  ok:        boolean
  spentUsd:  number
  capUsd:    number
  scope:     CostCapScope
}

export type KillReason =
  | 'budget_exhausted'
  | 'stagnation_pivot_exhausted'

export type KillSignal =
  | 'auto_pivot_eligible'

export interface KillSwitchInputs {
  budgetUsd:           number | null
  totalSpentUsd:       number
  last7dRevenueUsd:    number
  last7dSignups:       number
  pivotHistoryLength:  number
  firstProductLiveAt:  Date | null
  now?:                Date
}

export interface KillSwitchResult {
  kill:    boolean
  reason?: KillReason
  signal?: KillSignal
  details: KillSwitchInputs
}

function getCap(envName: string, fallback: number): number {
  const raw = process.env[envName]
  if (!raw) return fallback
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function startOfDayIso(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function assertUnderCostCap(
  userId: string,
  businessSlug?: string | null,
): Promise<CostCapResult> {
  const userCap = getCap('USER_DAILY_USD_LIMIT', DEFAULT_USER_DAILY_USD)
  const bizCap  = getCap('USER_BUSINESS_DAILY_USD_LIMIT', DEFAULT_BUSINESS_DAILY_USD)
  const db = createServerClient()
  if (!db) {
    return { ok: true, spentUsd: 0, capUsd: userCap, scope: 'user' }
  }

  try {
    if (businessSlug) {
      const bizQuery = (db.from('token_events' as never) as unknown as {
        select: (cols: string) => {
          eq: (c: string, v: string) => {
            eq: (c: string, v: string) => {
              gte: (c: string, v: string) => Promise<{ data: Array<{ cost_usd: number | null }> | null; error: { message: string } | null }>
            }
          }
        }
      }).select('cost_usd').eq('user_id', userId).eq('business_slug', businessSlug).gte('created_at', startOfDayIso())
      const bizResult = await bizQuery
      if (!bizResult.error) {
        const bizSpent = (bizResult.data ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0)
        if (bizSpent >= bizCap) {
          return { ok: false, spentUsd: bizSpent, capUsd: bizCap, scope: 'business' }
        }
      }
    }

    const { data } = await db
      .from('token_events')
      .select('cost_usd')
      .eq('user_id', userId)
      .gte('created_at', startOfDayIso())

    const rows = (data ?? []) as Array<{ cost_usd: number | null }>
    const spent = rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0)
    return { ok: spent < userCap, spentUsd: spent, capUsd: userCap, scope: 'user' }
  } catch {
    return { ok: true, spentUsd: 0, capUsd: userCap, scope: 'user' }
  }
}

/**
 * Pure decision logic — given the four signals (budget vs spend, 7d revenue,
 * 7d signups, pivot history), decide whether the experiment must hard-kill.
 *
 * Stagnation rules:
 *   - Triggered only when `firstProductLiveAt` is set AND ≥ 7 days have elapsed
 *     (timer anchors at "first product live", not "experiment created")
 *   - First stagnation (pivotHistoryLength === 0): kill=false + signal=auto_pivot_eligible
 *     — the agent reads the signal and proposes a pivot via the niche_pick gate
 *   - Second stagnation (pivotHistoryLength ≥ 1): kill=true reason=stagnation_pivot_exhausted
 *
 * Budget rule fires regardless of stagnation state and takes precedence.
 */
export function evaluateKillSwitch(inputs: KillSwitchInputs): KillSwitchResult {
  const now = inputs.now ?? new Date()

  if (inputs.budgetUsd !== null && inputs.totalSpentUsd >= inputs.budgetUsd) {
    return { kill: true, reason: 'budget_exhausted', details: inputs }
  }

  if (!inputs.firstProductLiveAt) {
    return { kill: false, details: inputs }
  }
  const sinceLiveMs = now.getTime() - inputs.firstProductLiveAt.getTime()
  if (sinceLiveMs < SEVEN_DAYS_MS) {
    return { kill: false, details: inputs }
  }

  const stagnating =
    inputs.last7dRevenueUsd < STAGNATION_REVENUE_USD &&
    inputs.last7dSignups    < STAGNATION_SIGNUPS

  if (!stagnating) {
    return { kill: false, details: inputs }
  }

  if (inputs.pivotHistoryLength === 0) {
    return { kill: false, signal: 'auto_pivot_eligible', details: inputs }
  }
  return { kill: true, reason: 'stagnation_pivot_exhausted', details: inputs }
}

/**
 * Async shell — fetches business + experiment_metrics rows, then delegates
 * to `evaluateKillSwitch`. Fail-open if the DB is unreachable (kill=false)
 * since callers shouldn't be blocked by infra outages — they can re-check
 * on the next tick. Unknown business slug also returns kill=false.
 */
export async function checkKillSwitch(businessSlug: string): Promise<KillSwitchResult> {
  const empty: KillSwitchInputs = {
    budgetUsd:          null,
    totalSpentUsd:      0,
    last7dRevenueUsd:   0,
    last7dSignups:      0,
    pivotHistoryLength: 0,
    firstProductLiveAt: null,
  }

  const db = createServerClient()
  if (!db) return { kill: false, details: empty }

  try {
    const { data: biz } = await db
      .from('business_operators')
      .select('money_model')
      .eq('slug', businessSlug)
      .maybeSingle()
    if (!biz) return { kill: false, details: empty }

    const mm = (biz as { money_model: Record<string, unknown> | null }).money_model ?? {}
    const budgetUsd = typeof mm.budget_usd === 'number' ? (mm.budget_usd as number) : null
    const pivotHistory = Array.isArray(mm.pivot_history) ? (mm.pivot_history as unknown[]) : []

    // experiment_metrics is migration 034 — not yet in generated Supabase types.
    // Use an untyped shim, same escape hatch as the token_events query above.
    type AnyQuery = {
      eq:   (c: string, v: string) => AnyQuery
      gte:  (c: string, v: string) => AnyQuery
      order: (c: string, opts: { ascending: boolean }) => AnyQuery
      limit: (n: number) => AnyQuery
      then:  Promise<{ data: unknown; error: unknown }>['then']
    }
    const exp = (db as unknown as {
      from: (t: string) => { select: (c: string) => AnyQuery }
    }).from('experiment_metrics')

    const sevenDaysAgoIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString()
    const [spendRes, revRes, signupRes, liveRes] = (await Promise.all([
      exp.select('payload').eq('business_slug', businessSlug).eq('kind', 'cash_spend'),
      exp.select('payload').eq('business_slug', businessSlug).eq('kind', 'revenue').gte('ts', sevenDaysAgoIso),
      exp.select('id').eq('business_slug', businessSlug).eq('kind', 'signup').gte('ts', sevenDaysAgoIso),
      exp.select('ts,payload').eq('business_slug', businessSlug).eq('kind', 'content_published').order('ts', { ascending: true }).limit(50),
    ])) as Array<{ data: unknown; error: unknown }>

    const sumUsd = (rows: unknown): number => {
      const arr = (rows ?? []) as Array<{ payload?: Record<string, unknown> | null }>
      return arr.reduce((s, r) => {
        const p = r.payload ?? {}
        const usd = typeof p.usd === 'number' ? (p.usd as number) : 0
        return s + usd
      }, 0)
    }

    const totalSpentUsd    = sumUsd(spendRes.data)
    const last7dRevenueUsd = sumUsd(revRes.data)
    const last7dSignups    = ((signupRes.data ?? []) as unknown[]).length

    const liveRows = (liveRes.data ?? []) as Array<{ ts: string; payload: Record<string, unknown> | null }>
    const firstLive = liveRows.find(r => r.payload && r.payload.live === true)
    const firstProductLiveAt = firstLive ? new Date(firstLive.ts) : null

    return evaluateKillSwitch({
      budgetUsd,
      totalSpentUsd,
      last7dRevenueUsd,
      last7dSignups,
      pivotHistoryLength: pivotHistory.length,
      firstProductLiveAt,
    })
  } catch {
    return { kill: false, details: empty }
  }
}

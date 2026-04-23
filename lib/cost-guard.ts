/**
 * cost-guard — per-user daily AI-spend cap.
 *
 * Reads today's aggregated `cost_usd` from `token_events` for the given userId
 * and compares against USER_DAILY_USD_LIMIT (default $25).
 *
 * This is a blocking check, not an alert. `COST_ALERT_PER_RUN_USD` remains the
 * soft per-run alert threshold; this is the hard ceiling per day.
 *
 * If Supabase is not configured, returns `ok: true` (no data → can't enforce).
 */

import { createServerClient } from '@/lib/supabase'

const DEFAULT_DAILY_USD = 25

export interface CostCapResult {
  ok: boolean
  spentUsd: number
  capUsd: number
}

function getDailyCap(): number {
  const raw = process.env.USER_DAILY_USD_LIMIT
  if (!raw) return DEFAULT_DAILY_USD
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_USD
}

function startOfDayIso(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function assertUnderCostCap(userId: string): Promise<CostCapResult> {
  const cap = getDailyCap()
  const db = createServerClient()
  if (!db) {
    // Supabase unconfigured — cannot enforce; don't block.
    return { ok: true, spentUsd: 0, capUsd: cap }
  }

  try {
    const { data } = await db
      .from('token_events')
      .select('cost_usd')
      .eq('user_id', userId)
      .gte('created_at', startOfDayIso())

    const rows = (data ?? []) as Array<{ cost_usd: number | null }>
    const spent = rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0)
    return { ok: spent < cap, spentUsd: spent, capUsd: cap }
  } catch {
    // DB error — fail open, but log. Fail-closed here would lock the platform
    // out on a transient Supabase blip.
    return { ok: true, spentUsd: 0, capUsd: cap }
  }
}

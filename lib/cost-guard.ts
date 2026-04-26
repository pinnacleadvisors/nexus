/**
 * cost-guard — daily AI-spend caps.
 *
 * Two scopes, both enforced per call:
 *   1. user-level   USER_DAILY_USD_LIMIT          (default $25/day)
 *   2. business     USER_BUSINESS_DAILY_USD_LIMIT (default $10/day, only when businessSlug is set)
 *
 * The business cap fires first when applicable; user cap is the ceiling. Either trip
 * returns ok=false with the matching scope so the caller can return a precise 402.
 *
 * Uses `token_events.cost_usd` aggregated since UTC midnight. When `business_slug`
 * column is missing or unset we fall back to user-only enforcement (graceful pre-migration).
 */

import { createServerClient } from '@/lib/supabase'

const DEFAULT_USER_DAILY_USD     = 25
const DEFAULT_BUSINESS_DAILY_USD = 10

export type CostCapScope = 'user' | 'business'

export interface CostCapResult {
  ok:        boolean
  spentUsd:  number
  capUsd:    number
  scope:     CostCapScope
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

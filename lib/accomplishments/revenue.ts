/**
 * lib/accomplishments/revenue.ts — all-time revenue rollup for the
 * Accomplishments read-model.
 *
 * Reuses the SAME revenue-truth extractor as app/api/dashboard/fleet/route.ts
 * (experiment_metrics kind='revenue', amount via payloadUsd) but with NO time
 * window — Accomplishments are all-time. Scoped to the operator through their
 * own businesses' slugs (revenue_events has no user_id/business_slug column, so
 * experiment_metrics is the scopable source, exactly as the fleet route uses).
 *
 * Pure read. Fail-soft: a missing DB / table returns zeroes so the page still
 * renders an empty board rather than erroring.
 */

import { createServerClient } from '@/lib/supabase'
import { listBusinessesForUser } from '@/lib/business/db'

/** Extract a USD amount from an experiment_metrics payload — mirrors the
 *  fleet route's payloadUsd so the two never drift on the revenue shape. */
function payloadUsd(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0
  const p = payload as Record<string, unknown>
  for (const c of [p.usd, p.amount_usd, p.amount]) {
    if (typeof c === 'number' && Number.isFinite(c)) return c
    if (typeof c === 'string') {
      const n = Number(c)
      if (Number.isFinite(n)) return n
    }
  }
  return 0
}

export interface AllTimeRevenue {
  combined:   number
  byNiche:    Record<string, number>
  byBusiness: Record<string, number>
}

export interface RevenueRollup {
  revenue:       AllTimeRevenue
  businessCount: number
  nicheCount:    number
}

interface MetricRow { business_slug: string; kind: string; payload: unknown }

export async function getAllTimeRevenue(userId: string): Promise<RevenueRollup> {
  const businesses  = await listBusinessesForUser(userId)
  const slugs       = businesses.map(b => b.slug)
  const nicheBySlug = new Map(businesses.map(b => [b.slug, b.niche]))

  const byBusiness: Record<string, number> = {}
  const byNiche:    Record<string, number> = {}
  let combined = 0

  const db = createServerClient()
  if (db && slugs.length > 0) {
    try {
      const res = await (db.from('experiment_metrics' as never) as unknown as {
        select: (c: string) => { in: (c: string, v: string[]) => { eq: (c: string, v: string) => Promise<{ data: MetricRow[] | null }> } }
      })
        .select('business_slug, kind, payload')
        .in('business_slug', slugs)
        .eq('kind', 'revenue')
      for (const row of res.data ?? []) {
        const usd = payloadUsd(row.payload)
        if (usd === 0) continue
        byBusiness[row.business_slug] = (byBusiness[row.business_slug] ?? 0) + usd
        const niche = nicheBySlug.get(row.business_slug) ?? 'unknown'
        byNiche[niche] = (byNiche[niche] ?? 0) + usd
        combined += usd
      }
    } catch {
      /* fail-soft — empty board beats a 500 */
    }
  }

  const nicheCount = new Set(businesses.map(b => b.niche)).size
  return { revenue: { combined, byNiche, byBusiness }, businessCount: businesses.length, nicheCount }
}

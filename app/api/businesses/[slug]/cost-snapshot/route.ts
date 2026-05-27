/**
 * GET  /api/businesses/[slug]/cost-snapshot — 7-day spend trend + today vs cap.
 * PATCH /api/businesses/[slug]/cost-snapshot — update the per-business daily cap.
 *
 * Backs the `BusinessCostWidget` on `/businesses/<slug>` (R3 of the UX
 * consultation). Operator sees:
 *   - Today's spend (sum of experiment_metrics rows with kind='cash_spend'
 *     since 00:00 in operator-local time)
 *   - Daily cap (business_operators.daily_cost_cap_cents OR inherited
 *     from USER_DAILY_USD_LIMIT)
 *   - 7-day spend trend (array of {date, spend_cents} buckets)
 *
 * The PATCH variant flips the cap. Operator sends `{daily_cost_cap_cents:
 * number | null}`. Setting null reverts to the inherited platform cap.
 *
 * Retry-storm safe: 200 + {ok: false} on transient errors.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 10

interface RouteCtx { params: Promise<{ slug: string }> }

interface ExperimentMetricRow {
  ts:      string
  payload: { usd?: number } | null
}

interface BusinessSnap {
  daily_cost_cap_cents: number | null
}

interface CostSnapshotBody {
  ok:                       boolean
  today_spend_cents:        number
  daily_cap_cents:          number | null
  cap_source:               'business' | 'platform-default' | 'none'
  trend_7d:                 Array<{ date: string; spend_cents: number }>
  fetched_at:               string
  error?:                   string
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** Default platform-wide cap in cents (mirrors USER_DAILY_USD_LIMIT env). */
function platformCapCents(): number | null {
  const raw = process.env.USER_DAILY_USD_LIMIT
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'biz:cost-snapshot' },
  })
  if ('response' in g) return g.response

  const { slug } = await ctx.params
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid_slug' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  // Load the business row (cap + ownership check).
  let business: BusinessSnap | null = null
  try {
    const r = await (db.from('business_operators' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: (BusinessSnap & { user_id: string }) | null }> } } }
    }).select('daily_cost_cap_cents, user_id').eq('slug', slug).eq('user_id', g.userId).maybeSingle()
    if (!r.data) return NextResponse.json({ ok: false, error: 'business_not_found_or_forbidden' })
    business = { daily_cost_cap_cents: r.data.daily_cost_cap_cents ?? null }
  } catch (err) {
    // The cap column may not exist on older deploys (migration 089 not yet
    // applied). Fall back to platform-default rather than 500.
    business = { daily_cost_cap_cents: null }
  }

  // Load the last 7 days of cash_spend rows.
  const sinceIso = new Date(Date.now() - 7 * ONE_DAY_MS).toISOString()
  let rows: ExperimentMetricRow[] = []
  try {
    const r = await (db.from('experiment_metrics' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { gte: (c: string, v: string) => Promise<{ data: ExperimentMetricRow[] | null }> } } }
    }).select('ts, payload').eq('business_slug', slug).eq('kind', 'cash_spend').gte('ts', sinceIso)
    rows = r.data ?? []
  } catch { /* silently empty */ }

  // Bucket by day (00:00 UTC). Operator-local-time bucketing is future work.
  const buckets = new Map<string, number>()
  for (let d = 0; d < 7; d++) {
    const day = new Date(Date.now() - (6 - d) * ONE_DAY_MS).toISOString().slice(0, 10)
    buckets.set(day, 0)
  }
  let todayCents = 0
  const todayKey = new Date().toISOString().slice(0, 10)
  for (const r of rows) {
    const day = r.ts.slice(0, 10)
    const usd = r.payload?.usd ?? 0
    const cents = Math.round(usd * 100)
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + cents)
    if (day === todayKey) todayCents += cents
  }
  const trend = Array.from(buckets.entries()).map(([date, spend_cents]) => ({ date, spend_cents }))

  // Resolve effective cap. Business cap overrides; else platform cap; else none.
  const dailyCapCents = business?.daily_cost_cap_cents ?? platformCapCents()
  const capSource: CostSnapshotBody['cap_source'] = business?.daily_cost_cap_cents != null
    ? 'business'
    : platformCapCents() != null ? 'platform-default' : 'none'

  const body: CostSnapshotBody = {
    ok:                true,
    today_spend_cents: todayCents,
    daily_cap_cents:   dailyCapCents,
    cap_source:        capSource,
    trend_7d:          trend,
    fetched_at:        new Date().toISOString(),
  }
  return NextResponse.json(body)
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 10, window: '1 m', prefix: 'biz:cost-cap:set' },
  })
  if ('response' in g) return g.response

  const { slug } = await ctx.params
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid_slug' })
  }

  const raw = await req.json().catch(() => ({})) as { daily_cost_cap_cents?: unknown }
  let cap: number | null = null
  if (raw.daily_cost_cap_cents === null) {
    cap = null
  } else if (typeof raw.daily_cost_cap_cents === 'number' && Number.isFinite(raw.daily_cost_cap_cents) && raw.daily_cost_cap_cents >= 0) {
    cap = Math.round(raw.daily_cost_cap_cents)
  } else {
    return NextResponse.json({ ok: false, error: 'invalid_cap', hint: 'Pass a non-negative integer in cents, or null to inherit the platform default.' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  try {
    const r = await (db.from('business_operators' as never) as unknown as {
      update: (row: Record<string, unknown>) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> } }
    }).update({ daily_cost_cap_cents: cap }).eq('slug', slug).eq('user_id', g.userId)
    if (r.error) {
      if (/column .*daily_cost_cap_cents.* does not exist/i.test(r.error.message)) {
        return NextResponse.json({
          ok:    false,
          error: 'migration_089_not_applied',
          hint:  'Apply supabase/migrations/089_business_daily_cost_cap.sql via `doppler run -- npm run migrate`.',
        })
      }
      return NextResponse.json({ ok: false, error: r.error.message })
    }
    return NextResponse.json({ ok: true, daily_cost_cap_cents: cap })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'unknown' })
  }
}

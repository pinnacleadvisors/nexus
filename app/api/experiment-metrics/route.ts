/**
 * GET /api/experiment-metrics
 *
 * Thin read-only window into the `experiment_metrics` table. Powers the
 * Mission Control dashboard's spend / revenue tiles (BentoMissionControl).
 * Before this route existed, the dashboard fetched
 * `/api/experiment-metrics?kind=cash_spend&since=...` and got a 404 —
 * the table existed (migration 034) but no list endpoint did, so the
 * `Spend (24h)` tile silently rendered $0.00 forever.
 *
 * Query params:
 *   kind          (optional) — filter by experiment_metrics.kind. Comma-
 *                              separated for multiple values.
 *   businessSlug  (optional) — filter by business_slug.
 *   since         (optional) — ISO timestamp; rows with ts ≥ since.
 *   until         (optional) — ISO timestamp; rows with ts < until.
 *   limit         (optional, default 200, max 1000)
 *
 * Response: 200 always (retry-storm rule — dashboard pollers retry on 5xx).
 *   { ok: true, rows: ExperimentMetricRow[] }
 *   { ok: false, error: 'supabase_unconfigured' | 'query_failed', rows: [] }
 *
 * Owner-gated: `ALLOWED_USER_IDS` check applies via the protected proxy
 * matcher. Rate-limit: 120/min per user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

interface MetricRow {
  id?:            string
  business_slug?: string | null
  kind?:          string
  payload?:       unknown
  ts?:            string
  created_at?:    string
}

export async function GET(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 120, window: '1 m', prefix: 'experiment-metrics' },
  })
  if ('response' in g) return g.response

  const db = createServerClient()
  if (!db) {
    return NextResponse.json({ ok: false, error: 'supabase_unconfigured', rows: [] })
  }

  const params       = req.nextUrl.searchParams
  const kindParam    = params.get('kind')
  const slugParam    = params.get('businessSlug')
  const sinceParam   = params.get('since')
  const untilParam   = params.get('until')
  const limitRaw     = parseInt(params.get('limit') ?? '200', 10)
  const limit        = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 200

  // experiment_metrics isn't in the generated Database type yet (added by
  // migration 034). Same untyped shim pattern lib/cost-guard.ts uses.
  type Query = {
    eq:    (c: string, v: string) => Query
    in:    (c: string, vs: string[]) => Query
    gte:   (c: string, v: string) => Query
    lt:    (c: string, v: string) => Query
    order: (c: string, o: { ascending: boolean }) => Query
    limit: (n: number) => Query
    then:  Promise<{ data: unknown; error: unknown }>['then']
  }
  let q: Query = ((db as unknown as {
    from: (t: string) => { select: (c: string) => Query }
  }).from('experiment_metrics')).select('id,business_slug,kind,payload,ts,created_at')

  if (kindParam) {
    const kinds = kindParam.split(',').map(s => s.trim()).filter(Boolean)
    q = kinds.length === 1 ? q.eq('kind', kinds[0]) : q.in('kind', kinds)
  }
  if (slugParam)  q = q.eq('business_slug', slugParam)
  if (sinceParam) q = q.gte('ts', sinceParam)
  if (untilParam) q = q.lt('ts', untilParam)

  q = q.order('ts', { ascending: false }).limit(limit)

  try {
    const res  = (await q) as { data: MetricRow[] | null; error: unknown }
    if (res.error) {
      return NextResponse.json(
        { ok: false, error: 'query_failed', rows: [] },
        { status: 200 },
      )
    }
    return NextResponse.json({ ok: true, rows: res.data ?? [] })
  } catch (err) {
    console.error('[/api/experiment-metrics] query failed:', err)
    return NextResponse.json(
      { ok: false, error: 'query_failed', rows: [] },
      { status: 200 },
    )
  }
}

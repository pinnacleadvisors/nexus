/**
 * GET /api/run-events
 *
 * Read-only window into `run_events`. Powers Mission Control's
 * HeartbeatTimeline ("last 24h activity") strip in BentoMissionControl —
 * which has been silent since the dashboard shipped because this endpoint
 * never existed. The table has been around since the run-controller A6
 * migrations; only the API surface was missing.
 *
 * Query params:
 *   runId        (optional) — filter by run id
 *   kind         (optional, csv) — filter by event kind
 *   businessSlug (optional) — filter by business_slug
 *   since        (optional) — ISO; created_at ≥ since
 *   until        (optional) — ISO; created_at < until
 *   limit        (optional, default 200, max 1000)
 *
 * Returns 200 always (retry-storm rule).
 *   { ok: true,  rows: RunEventRow[] }
 *   { ok: false, error: 'supabase_unconfigured' | 'query_failed', rows: [] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

interface RunEventRow {
  id?:            string
  run_id?:        string | null
  kind?:          string
  payload?:       unknown
  business_slug?: string | null
  created_at?:    string
}

export async function GET(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 120, window: '1 m', prefix: 'run-events' },
  })
  if ('response' in g) return g.response

  const db = createServerClient()
  if (!db) {
    return NextResponse.json({ ok: false, error: 'supabase_unconfigured', rows: [] })
  }

  const params     = req.nextUrl.searchParams
  const runId      = params.get('runId')
  const kindParam  = params.get('kind')
  const slug       = params.get('businessSlug')
  const since      = params.get('since')
  const until      = params.get('until')
  const limitRaw   = parseInt(params.get('limit') ?? '200', 10)
  const limit      = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 200

  // run_events: untyped shim because the table predates the latest
  // Supabase types regeneration. Same pattern lib/chat/system-prompt-business.ts
  // uses.
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
  }).from('run_events')).select('id,run_id,kind,payload,business_slug,created_at')

  if (runId) q = q.eq('run_id', runId)
  if (kindParam) {
    const kinds = kindParam.split(',').map(s => s.trim()).filter(Boolean)
    q = kinds.length === 1 ? q.eq('kind', kinds[0]) : q.in('kind', kinds)
  }
  if (slug)  q = q.eq('business_slug', slug)
  if (since) q = q.gte('created_at', since)
  if (until) q = q.lt('created_at',  until)

  q = q.order('created_at', { ascending: false }).limit(limit)

  try {
    const res = (await q) as { data: RunEventRow[] | null; error: unknown }
    if (res.error) {
      return NextResponse.json({ ok: false, error: 'query_failed', rows: [] }, { status: 200 })
    }
    return NextResponse.json({ ok: true, rows: res.data ?? [] })
  } catch (err) {
    console.error('[/api/run-events] query failed:', err)
    return NextResponse.json({ ok: false, error: 'query_failed', rows: [] }, { status: 200 })
  }
}

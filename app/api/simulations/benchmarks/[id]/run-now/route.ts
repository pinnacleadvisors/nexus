/**
 * POST /api/simulations/benchmarks/:id/run-now — manually trigger this
 * single benchmark instead of waiting for the daily cron.
 *
 * Useful after an intentional engine change to confirm zero drift (or
 * to set a baseline on a brand-new benchmark without waiting until 06:00).
 *
 * Returns the BenchmarkRunSummary inline. 60s maxDuration covers the
 * engine's ~25s/per-call budget × the 1-2 calls a 5-day benchmark needs.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { runOneBenchmark, type BenchmarkRow } from '@/lib/simulation/benchmark'

export const runtime = 'nodejs'
export const maxDuration = 60

interface RouteCtx { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 6, window: '1 m', prefix: 'sim:bench:run' },
  })
  if ('response' in g) return g.response

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const rowRes = await (db.from('simulation_benchmarks' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: BenchmarkRow | null }> } }
  }).select('*').eq('id', id).maybeSingle()
  if (!rowRes.data) return NextResponse.json({ ok: false, error: 'benchmark_not_found' })

  try {
    const out = await runOneBenchmark(db, rowRes.data)
    return NextResponse.json({ ok: true, summary: out })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

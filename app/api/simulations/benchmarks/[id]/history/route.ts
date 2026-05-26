/**
 * GET /api/simulations/benchmarks/:id/history — last 30 run-history
 * rows for a benchmark. Drives the inline sparkline on the admin page.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 15

interface RouteCtx { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'sim:bench:history' },
  })
  if ('response' in g) return g.response

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const res = await (db.from('simulation_benchmark_runs' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }> } } }
  }).select('id, drift_pct, sim_net_cents, failures, bootstrapped, alerted, ran_at')
    .eq('benchmark_id', id)
    .order('ran_at', { ascending: false })
    .limit(30)

  return NextResponse.json({
    ok:       !res.error,
    history:  (res.data ?? []).reverse(),   // chronological for chart
    error:    res.error?.message,
  })
}

/**
 * POST /api/simulations/benchmarks/:id/reset-baseline — null out baseline
 * fields so the next cron run becomes the new baseline.
 *
 * Use when the operator intentionally changed something (engine, persona
 * pool, business config) and wants to forgive existing drift.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 15

interface RouteCtx { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 10, window: '1 m', prefix: 'sim:bench:rebaseline' },
  })
  if ('response' in g) return g.response

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const res = await (db.from('simulation_benchmarks' as never) as unknown as {
    update: (r: unknown) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
  }).update({
    baseline_result:  null,
    baseline_run_id:  null,
    baseline_set_at:  null,
    last_drift_pct:   null,
    last_alert_at:    null,
    updated_at:       new Date().toISOString(),
  }).eq('id', id)
  if (res.error) return NextResponse.json({ ok: false, error: res.error.message })
  return NextResponse.json({ ok: true })
}

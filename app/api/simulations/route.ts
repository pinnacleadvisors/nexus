/**
 * POST /api/simulations — start a hyperbolic-chamber simulation run.
 * GET  /api/simulations  — list operator's recent runs (most recent first).
 *
 * Auth: operator only (Clerk session). 200 on transient failures
 * (retry-storm rule) — non-cron route but still honoured for UX.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { startRun } from '@/lib/simulation/engine'

export const runtime = 'nodejs'
export const maxDuration = 30

interface StartBody {
  business_slug?:        string
  mode?:                 'manual' | 'auto'
  compress_days?:        number
  wallclock_budget_sec?: number
  approver_policy?:      'permissive' | 'skeptical' | 'random'
  synthetic_voice?:      'template' | 'llm'
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 10, window: '1 m', prefix: 'sim:start' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as StartBody
  const business_slug = String(body.business_slug ?? '').trim()
  if (!business_slug) return NextResponse.json({ ok: false, error: 'business_slug required' })
  if (body.mode !== 'manual' && body.mode !== 'auto') {
    return NextResponse.json({ ok: false, error: 'mode must be manual or auto' })
  }
  const compress_days = Math.max(1, Math.min(365, Number(body.compress_days ?? 30)))
  const wallclock_budget_sec = Math.max(60, Math.min(86_400, Number(body.wallclock_budget_sec ?? 3_600)))

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const synthetic_voice = body.synthetic_voice === 'llm' ? 'llm' : 'template'

  const out = await startRun({
    db,
    userId:               g.userId,
    businessSlug:         business_slug,
    mode:                 body.mode,
    compress_days,
    wallclock_budget_sec,
    approver_policy:      body.approver_policy,
    synthetic_voice,
  })

  return NextResponse.json(out)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'sim:list' },
  })
  if ('response' in g) return g.response

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured', runs: [] })

  const url  = new URL(req.url)
  const slug = url.searchParams.get('business_slug')

  // Chained Supabase query — typed loosely because the project doesn't
  // generate full DB types yet (see Read in CLAUDE.md). Pattern matches
  // other API routes (e.g. inbox/list).
  let q = (db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => unknown
  }).select('id, business_slug, mode, compress_days, wallclock_budget_sec, status, current_event_idx, total_events, started_at, ended_at, result, created_at') as {
    eq:    (c: string, v: string) => typeof q
    order: (c: string, o: { ascending: boolean }) => typeof q
    limit: (n: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>
  }
  q = q.eq('user_id', g.userId)
  if (slug) q = q.eq('business_slug', slug)
  const res = await q.order('created_at', { ascending: false }).limit(20)
  return NextResponse.json({ ok: true, runs: res.data ?? [], error: res.error?.message })
}

/**
 * GET  /api/simulations/benchmarks — list every benchmark, newest first
 * POST /api/simulations/benchmarks — create a benchmark row
 *
 * Operator-only (Clerk auth). Benchmarks are global to the platform —
 * not per-user — but only operators in ALLOWED_USER_IDS can mutate.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 15

interface CreateBody {
  name?:                 string
  business_slug?:        string
  seed?:                 string
  compress_days?:        number
  wallclock_budget_sec?: number
  approver_policy?:      'permissive' | 'skeptical' | 'random'
  synthetic_voice?:      'template' | 'llm'
  drift_threshold_pct?:  number
}

const VALID_POLICY = new Set(['permissive', 'skeptical', 'random'])
const VALID_VOICE  = new Set(['template', 'llm'])

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'sim:bench:list' },
  })
  if ('response' in g) return g.response

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured', rows: [] })

  const res = await (db.from('simulation_benchmarks' as never) as unknown as {
    select: (c: string) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: { message: string } | null }> }
  }).select('*').order('created_at', { ascending: false })

  return NextResponse.json({ ok: true, rows: res.data ?? [], error: res.error?.message })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 10, window: '1 m', prefix: 'sim:bench:create' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as CreateBody
  const name          = String(body.name ?? '').trim()
  const business_slug = String(body.business_slug ?? '').trim()
  if (!name || !business_slug) {
    return NextResponse.json({ ok: false, error: 'name + business_slug required' })
  }
  if (!body.approver_policy || !VALID_POLICY.has(body.approver_policy)) {
    return NextResponse.json({ ok: false, error: 'invalid approver_policy' })
  }
  const voice = body.synthetic_voice ?? 'template'
  if (!VALID_VOICE.has(voice)) {
    return NextResponse.json({ ok: false, error: 'invalid synthetic_voice' })
  }
  const compress_days = Math.max(1, Math.min(365, Number(body.compress_days ?? 5)))
  const wallclock_budget_sec = Math.max(60, Math.min(86_400, Number(body.wallclock_budget_sec ?? 600)))
  const drift_threshold_pct = Math.max(0.1, Math.min(100, Number(body.drift_threshold_pct ?? 5)))
  const seed = String(body.seed ?? `bench-${business_slug}-${Date.now().toString(36)}`).trim()

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  // Verify business exists + is sim
  const bizRes = await (db.from('business_operators' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { simulation?: boolean } | null }> } }
  }).select('simulation').eq('slug', business_slug).maybeSingle()
  if (!bizRes.data) return NextResponse.json({ ok: false, error: 'business_not_found' })
  if (!bizRes.data.simulation) return NextResponse.json({ ok: false, error: 'business_is_not_a_simulation' })

  const ins = await (db.from('simulation_benchmarks' as never) as unknown as {
    insert: (r: unknown) => { select: (c: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } }
  }).insert({
    name, business_slug, seed,
    compress_days, wallclock_budget_sec,
    approver_policy: body.approver_policy,
    synthetic_voice: voice,
    drift_threshold_pct,
  }).select('id').single()
  if (ins.error) return NextResponse.json({ ok: false, error: ins.error.message })
  return NextResponse.json({ ok: true, id: ins.data?.id })
}

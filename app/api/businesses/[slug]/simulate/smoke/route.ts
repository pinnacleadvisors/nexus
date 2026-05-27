/**
 * POST /api/businesses/:slug/simulate/smoke
 * GET  /api/businesses/:slug/simulate/smoke?id=<run_id> — poll status
 *
 * Constrained "smoke" variant of the hyperbolic chamber. Picks tight
 * defaults so the smoke completes in a few minutes + spends pennies:
 *
 *   compress_days        = 14            (half-month, half the cost)
 *   wallclock_budget_sec = 600           (10 min hard cap)
 *   approver_policy      = 'skeptical'   (default — exercises the gate
 *                                          paths instead of rubber-stamping)
 *   synthetic_voice      = 'template'    (no LLM voicing → no LLM spend)
 *   mode                 = 'auto'        (no operator hand in the loop —
 *                                          the smoke runs unattended)
 *
 * Why this route exists separate from POST /api/simulations:
 *   - The graduate-preflight check `simulation_history` blocks graduation
 *     until at least one completed run exists. Forcing the operator to
 *     spin up a full chamber to clear that gate is friction.
 *   - The smoke gives a predictable, cheap pre-grad signal: "the basic
 *     loop works, no agent crashed, KPI deltas are not insane".
 *   - The wallclock cap + auto approver means the gate clears even if
 *     the operator stepped away.
 *
 * J4 from session 2026-05-27. Companion to the auto-provision graduate
 * chain (J3) — the smoke runs before graduate, provision runs after.
 *
 * Retry-storm safe (200 always).
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { startRun } from '@/lib/simulation/engine'

export const runtime = 'nodejs'
export const maxDuration = 30

interface RouteCtx { params: Promise<{ slug: string }> }

interface SmokeBody {
  /** Override the default 14-day compress. Capped to avoid runaway cost. */
  compress_days?:        number
  /** Override the 10-min wallclock cap. Capped at 30 min. */
  wallclock_budget_sec?: number
  /** 'template' (default — no LLM cost) or 'llm' (operator opt-in). */
  synthetic_voice?:      'template' | 'llm'
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 3, window: '5 m', prefix: 'biz:smoke:start' },
  })
  if ('response' in g) return g.response

  const { slug } = await ctx.params
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid_slug' })
  }

  const body = await req.json().catch(() => ({})) as SmokeBody
  // Smoke-tier caps — half the default chamber values.
  const compress_days = Math.max(7, Math.min(30, Number(body.compress_days ?? 14)))
  const wallclock_budget_sec = Math.max(120, Math.min(1_800, Number(body.wallclock_budget_sec ?? 600)))
  const synthetic_voice: 'template' | 'llm' = body.synthetic_voice === 'llm' ? 'llm' : 'template'

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  // Ownership check + must be a simulation business (we don't smoke prod
  // businesses — that's what real traffic is for).
  try {
    const r = await (db.from('business_operators' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { user_id: string; simulation: boolean | null } | null }> } }
    }).select('user_id, simulation').eq('slug', slug).maybeSingle()
    if (!r.data) return NextResponse.json({ ok: false, error: 'business_not_found' })
    if (r.data.user_id !== g.userId) return NextResponse.json({ ok: false, error: 'forbidden' })
    if (r.data.simulation === false) {
      return NextResponse.json({
        ok: false,
        error: 'business_already_graduated',
        hint: 'Smoke targets are simulation=true businesses only. This one is in real-money mode — fire a full chamber via /businesses/<slug>/simulate instead.',
      })
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'query_failed' })
  }

  const out = await startRun({
    db,
    userId:               g.userId,
    businessSlug:         slug,
    mode:                 'auto',
    compress_days,
    wallclock_budget_sec,
    approver_policy:      'skeptical',
    synthetic_voice,
  })

  return NextResponse.json({
    ok:           out.ok,
    run_id:       out.run_id,
    error:        out.error,
    smoke_params: { compress_days, wallclock_budget_sec, synthetic_voice, approver_policy: 'skeptical', mode: 'auto' },
  })
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'biz:smoke:status' },
  })
  if ('response' in g) return g.response

  const { slug } = await ctx.params
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid_slug' })
  }

  const url = new URL(req.url)
  const id  = url.searchParams.get('id')

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  if (id) {
    // Specific run status
    const r = await (db.from('simulation_runs' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { id: string; status: string; current_event_idx: number; total_events: number; started_at: string | null; ended_at: string | null; result: Record<string, unknown> | null } | null }> } } } }
    }).select('id, status, current_event_idx, total_events, started_at, ended_at, result').eq('id', id).eq('business_slug', slug).eq('user_id', g.userId).maybeSingle()
    return NextResponse.json({ ok: true, run: r.data })
  }

  // No id — return most recent smoke-shape run on this business (mode='auto'
  // + skeptical approver + compress ≤ 30). That's the smoke signature.
  const r = await (db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { lte: (c: string, v: number) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: Array<{ id: string; status: string; current_event_idx: number; total_events: number; created_at: string }> | null }> } } } } } }
  }).select('id, status, current_event_idx, total_events, created_at').eq('business_slug', slug).eq('user_id', g.userId).eq('mode', 'auto').lte('compress_days', 30).order('created_at', { ascending: false }).limit(1)
  return NextResponse.json({ ok: true, latest: (r.data ?? [])[0] ?? null })
}

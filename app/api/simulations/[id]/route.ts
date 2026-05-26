/**
 * GET /api/simulations/:id — fetch a run + its most recent events.
 *
 * Returns the run row plus the last 50 events for the UI to render the
 * console (current state, recent activity, pending gate if any).
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 15

interface RouteCtx { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 120, window: '1 m', prefix: 'sim:get' },
  })
  if ('response' in g) return g.response

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const runRes = await (db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> } } }
  }).select('*').eq('id', id).eq('user_id', g.userId).maybeSingle()
  if (runRes.error || !runRes.data) {
    return NextResponse.json({ ok: false, error: 'run_not_found' })
  }

  const evRes = await (db.from('simulation_events' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { order: (c: string, opts: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown[] | null }> } } }
  }).select('*').eq('run_id', id).order('created_at', { ascending: false }).limit(50)

  // Pending gate (if any) — for the manual-mode prompt
  const pendingGateRes = await (db.from('simulation_events' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { order: (c: string, opts: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown[] | null }> } } } } }
  }).select('*').eq('run_id', id).eq('kind', 'approval_gate').eq('approval_state', 'pending').order('created_at', { ascending: false }).limit(1)

  return NextResponse.json({
    ok:           true,
    run:          runRes.data,
    events:       evRes.data ?? [],
    pending_gate: (pendingGateRes.data ?? [])[0] ?? null,
  })
}

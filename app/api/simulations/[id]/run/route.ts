/**
 * POST /api/simulations/:id/run — run to completion (auto mode).
 *
 * Drains as many events as the engine's per-call budget (25s) allows,
 * then returns. If `final_status === 'running'`, caller re-POSTs to
 * drain the remainder. Auto-mode gates are decided by the heuristic
 * approver (lib/simulation/auto-approver.ts).
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { runToCompletion } from '@/lib/simulation/engine'

export const runtime = 'nodejs'
export const maxDuration = 60

interface RouteCtx { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 20, window: '1 m', prefix: 'sim:run' },
  })
  if ('response' in g) return g.response

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' })
  }
  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const ownRes = await (db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { id: string; mode: string } | null }> } } }
  }).select('id, mode').eq('id', id).eq('user_id', g.userId).maybeSingle()
  if (!ownRes.data) return NextResponse.json({ ok: false, error: 'run_not_found' })
  if (ownRes.data.mode !== 'auto') {
    return NextResponse.json({ ok: false, error: 'run_to_completion_requires_auto_mode' })
  }

  const out = await runToCompletion(db, id)
  return NextResponse.json(out)
}

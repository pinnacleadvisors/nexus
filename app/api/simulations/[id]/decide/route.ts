/**
 * POST /api/simulations/:id/decide — operator approves/rejects a pending
 * gate (manual mode). Body: { event_id, decision: 'approve'|'reject' }.
 *
 * Advances the engine's current_event_idx by 1 and flips status back to
 * 'running' so the next /tick processes the next event. The UI polls
 * /api/simulations/:id afterward for the refreshed state.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { decideManualGate } from '@/lib/simulation/engine'

export const runtime = 'nodejs'
export const maxDuration = 15

interface RouteCtx { params: Promise<{ id: string }> }

interface DecideBody { event_id?: string; decision?: 'approve' | 'reject' }

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'sim:decide' },
  })
  if ('response' in g) return g.response

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' })
  }
  const body = await req.json().catch(() => ({})) as DecideBody
  const event_id = String(body.event_id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(event_id)) {
    return NextResponse.json({ ok: false, error: 'invalid_event_id' })
  }
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return NextResponse.json({ ok: false, error: 'decision must be approve or reject' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const ownRes = await (db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { id: string } | null }> } } }
  }).select('id').eq('id', id).eq('user_id', g.userId).maybeSingle()
  if (!ownRes.data) return NextResponse.json({ ok: false, error: 'run_not_found' })

  const out = await decideManualGate(db, id, event_id, body.decision)
  return NextResponse.json(out)
}

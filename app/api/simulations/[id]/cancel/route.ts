/**
 * POST /api/simulations/:id/cancel — abort a running simulation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { cancelRun } from '@/lib/simulation/engine'

export const runtime = 'nodejs'
export const maxDuration = 15

interface RouteCtx { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 20, window: '1 m', prefix: 'sim:cancel' },
  })
  if ('response' in g) return g.response

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const ownRes = await (db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { id: string } | null }> } } }
  }).select('id').eq('id', id).eq('user_id', g.userId).maybeSingle()
  if (!ownRes.data) return NextResponse.json({ ok: false, error: 'run_not_found' })

  const out = await cancelRun(db, id)
  return NextResponse.json(out)
}

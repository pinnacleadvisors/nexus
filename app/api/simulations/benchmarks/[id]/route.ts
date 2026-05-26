/**
 * PATCH /api/simulations/benchmarks/:id — partial update (enabled flag,
 *   drift_threshold_pct, name).
 * DELETE /api/simulations/benchmarks/:id — remove a benchmark.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 15

interface RouteCtx { params: Promise<{ id: string }> }

interface PatchBody {
  enabled?:             boolean
  drift_threshold_pct?: number
  name?:                string
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'sim:bench:patch' },
  })
  if ('response' in g) return g.response

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' })
  }
  const body = await req.json().catch(() => ({})) as PatchBody
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.enabled === 'boolean') updates.enabled = body.enabled
  if (typeof body.drift_threshold_pct === 'number') {
    updates.drift_threshold_pct = Math.max(0.1, Math.min(100, body.drift_threshold_pct))
  }
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim()

  if (Object.keys(updates).length === 1) {
    // Only updated_at — caller passed no real changes
    return NextResponse.json({ ok: false, error: 'no_updates' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const res = await (db.from('simulation_benchmarks' as never) as unknown as {
    update: (r: unknown) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
  }).update(updates).eq('id', id)
  if (res.error) return NextResponse.json({ ok: false, error: res.error.message })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 10, window: '1 m', prefix: 'sim:bench:delete' },
  })
  if ('response' in g) return g.response

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' })
  }
  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const res = await (db.from('simulation_benchmarks' as never) as unknown as {
    delete: () => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
  }).delete().eq('id', id)
  if (res.error) return NextResponse.json({ ok: false, error: res.error.message })
  return NextResponse.json({ ok: true })
}

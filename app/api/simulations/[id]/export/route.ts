/**
 * GET /api/simulations/:id/export — download a run as portable JSON.
 *
 * Returns Content-Disposition: attachment so the browser saves it as
 * a file. The format is documented in lib/simulation/export.ts; bump
 * SCHEMA_VERSION there to evolve.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { exportRun } from '@/lib/simulation/export'

export const runtime = 'nodejs'
export const maxDuration = 15

interface RouteCtx { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'sim:export' },
  })
  if ('response' in g) return g.response

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const payload = await exportRun(db, g.userId, id)
  if (!payload) return NextResponse.json({ ok: false, error: 'run_not_found' })

  // Local timestamp in filename for human-friendliness (not for parsing).
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filename = `sim-${payload.run.business_slug}-${stamp}.json`

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type':        'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'no-store',
    },
  })
}

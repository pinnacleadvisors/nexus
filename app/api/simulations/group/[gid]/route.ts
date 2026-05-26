/**
 * GET /api/simulations/group/:gid — consolidated state of an A/B group.
 *
 * Returns every run in the group with its current progress + result.
 * UI uses this to render the comparison table in one fetch instead of
 * N parallel /api/simulations/:id requests.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { loadABGroup } from '@/lib/simulation/multi'

export const runtime = 'nodejs'
export const maxDuration = 15

interface RouteCtx { params: Promise<{ gid: string }> }

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 120, window: '1 m', prefix: 'sim:group' },
  })
  if ('response' in g) return g.response

  const { gid } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(gid)) {
    return NextResponse.json({ ok: false, error: 'invalid_gid' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const summary = await loadABGroup(db, g.userId, gid)
  if (!summary) return NextResponse.json({ ok: false, error: 'group_not_found' })
  return NextResponse.json({ ok: true, group: summary })
}

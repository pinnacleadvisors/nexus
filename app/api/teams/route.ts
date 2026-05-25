/**
 * GET /api/teams — list teams owned by the current user.
 *
 * Optional ?businessSlug=<slug> to scope to one business. When omitted,
 * returns every team across every business (used by the /teams admin
 * dashboard).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { listTeams } from '@/lib/teams/store'

export const runtime     = 'nodejs'
export const maxDuration = 10

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'teams:list' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const url          = new URL(req.url)
  const businessSlug = url.searchParams.get('businessSlug')

  // Treat empty string as "no filter" so the admin dashboard's default
  // unfiltered fetch doesn't surprise.
  const filter = businessSlug && businessSlug.length > 0 ? businessSlug : undefined
  const teams  = await listTeams(session.userId, filter)
  return NextResponse.json({ ok: true, teams })
}

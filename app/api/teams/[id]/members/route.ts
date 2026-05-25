/**
 * GET /api/teams/:id/members — list members of one team.
 *
 * Surface used by the /teams UI's per-team disclosure to render the
 * tool-budget-override editor.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { listTeamMembers, listTeams } from '@/lib/teams/store'

export const runtime     = 'nodejs'
export const maxDuration = 10

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { limit: 120, window: '1 m', prefix: 'teams:members:list' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  // Ownership check — make sure the requested team belongs to this user
  // before we return its member list. Done by intersecting the user's
  // teams with `id`.
  const teams = await listTeams(session.userId)
  if (!teams.find(t => t.id === id)) {
    return NextResponse.json({ ok: false, error: 'team not found' }, { status: 404 })
  }

  const members = await listTeamMembers(id)
  return NextResponse.json({ ok: true, members })
}

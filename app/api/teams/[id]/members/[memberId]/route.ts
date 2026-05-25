/**
 * PATCH /api/teams/:id/members/:memberId — update ecosystem_overrides / tool_budget_override.
 *
 * Body (both keys optional, at least one required):
 *   {
 *     ecosystemOverrides?: { <kind>: <adapter-name>, ... },   // sparse — keys you DON'T include stay as-is
 *     toolBudgetOverride?: string[] | null                    // null clears the override
 *   }
 *
 * The override pair is the role-level analogue of teams.ecosystem_bindings.
 * When a verb dispatches, the router checks `team_members.ecosystem_overrides`
 * FIRST, then falls back to `teams.ecosystem_bindings`.
 *
 * NOTE: this route REPLACES the bindings map (same shape as the team-level
 * PATCH route). The client sends the merged map; concurrent edits use
 * last-write-wins by design.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { updateTeamMember } from '@/lib/teams/store'

export const runtime     = 'nodejs'
export const maxDuration = 10

interface PatchBody {
  ecosystemOverrides?: Record<string, string>
  toolBudgetOverride?: string[] | null
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string; memberId: string }> }) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'teams:member:patch' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id, memberId } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id))       return NextResponse.json({ ok: false, error: 'invalid team id' }, { status: 400 })
  if (!/^[0-9a-f-]{36}$/i.test(memberId)) return NextResponse.json({ ok: false, error: 'invalid member id' }, { status: 400 })

  let body: PatchBody = {}
  try { body = await req.json() } catch { /* validate below */ }

  const patch: { ecosystemOverrides?: Record<string, string>; toolBudgetOverride?: string[] | null } = {}
  if (body.ecosystemOverrides && typeof body.ecosystemOverrides === 'object') {
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(body.ecosystemOverrides)) {
      if (typeof k === 'string' && typeof v === 'string') clean[k] = v
    }
    patch.ecosystemOverrides = clean
  }
  if (body.toolBudgetOverride !== undefined) {
    if (body.toolBudgetOverride === null) {
      patch.toolBudgetOverride = null
    } else if (Array.isArray(body.toolBudgetOverride)) {
      patch.toolBudgetOverride = body.toolBudgetOverride.filter(v => typeof v === 'string')
    } else {
      return NextResponse.json({ ok: false, error: 'toolBudgetOverride must be array or null' }, { status: 400 })
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400 })
  }

  const row = await updateTeamMember(session.userId, id, memberId, patch)
  if (!row) return NextResponse.json({ ok: false, error: 'member not found or update failed' }, { status: 200 })
  return NextResponse.json({ ok: true, member: row })
}

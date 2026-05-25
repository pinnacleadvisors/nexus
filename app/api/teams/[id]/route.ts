/**
 * PATCH  /api/teams/:id  — update status and/or ecosystem bindings.
 *
 * Body shape (both keys optional, at least one required):
 *   {
 *     status?:             "active" | "paused" | "archived",
 *     ecosystemBindings?:  Record<string, string>   // full map; sparse overrides not supported in v1
 *   }
 *
 * Rebinds replace the whole map. The /teams UI sends the existing map
 * with one entry mutated — explicit "I'm setting these bindings now",
 * not "patch a single key". Avoids merge ambiguity if multiple operators
 * rebind at once.
 *
 * Status transitions enforced by the underlying check constraint —
 * any value other than active/paused/archived returns 200 + ok:false.
 *
 * 200 + ok:false on transient failure (retry-storm safe).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { updateTeam, type TeamStatus } from '@/lib/teams/store'

export const runtime     = 'nodejs'
export const maxDuration = 10

interface PatchBody {
  status?:            string
  ecosystemBindings?: Record<string, string>
  /** Reassign org-chart parent. Pass null to detach. Set the field to "" to
   *  signal "leave unchanged" — undefined also leaves unchanged. */
  parentTeamId?:      string | null
}

const VALID_STATUSES: readonly TeamStatus[] = ['active', 'paused', 'archived']

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'teams:patch' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  let body: PatchBody = {}
  try { body = await req.json() } catch { /* validated below */ }

  const patch: { status?: TeamStatus; ecosystemBindings?: Record<string, string>; parentTeamId?: string | null } = {}
  if (typeof body.status === 'string') {
    if (!VALID_STATUSES.includes(body.status as TeamStatus)) {
      return NextResponse.json({ ok: false, error: `invalid status (must be one of ${VALID_STATUSES.join(', ')})` }, { status: 400 })
    }
    patch.status = body.status as TeamStatus
  }
  if (body.ecosystemBindings && typeof body.ecosystemBindings === 'object') {
    // Cheap sanity — keys must be plain strings, values likewise. A bad
    // value goes to the typed-result of the next dispatch via the registry
    // (returns capability_missing); we just refuse non-string at the edge.
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(body.ecosystemBindings)) {
      if (typeof k === 'string' && typeof v === 'string') clean[k] = v
    }
    patch.ecosystemBindings = clean
  }
  if (body.parentTeamId !== undefined) {
    if (body.parentTeamId === null) {
      patch.parentTeamId = null
    } else if (typeof body.parentTeamId === 'string' && /^[0-9a-f-]{36}$/i.test(body.parentTeamId)) {
      if (body.parentTeamId === id) {
        return NextResponse.json({ ok: false, error: 'team cannot be its own parent' }, { status: 400 })
      }
      patch.parentTeamId = body.parentTeamId
    } else {
      return NextResponse.json({ ok: false, error: 'parentTeamId must be a uuid or null' }, { status: 400 })
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400 })
  }

  const row = await updateTeam(session.userId, id, patch)
  if (!row) {
    return NextResponse.json({ ok: false, error: 'team not found or update failed' }, { status: 200 })
  }
  return NextResponse.json({ ok: true, team: row })
}

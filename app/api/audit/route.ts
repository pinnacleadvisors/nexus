/**
 * GET /api/audit — read recent audit log entries (server-side only)
 *
 * Query params:
 *   limit    — max rows (default 50)
 *   resource — filter by resource type ('task', 'agent', 'oauth', 'skill')
 *   action   — filter by action ('board.approve', 'claw.dispatch_phases', …)
 *   userId   — only honoured for owners (listed in ALLOWED_USER_IDS). Non-owners
 *              are force-filtered to their own userId.
 *
 * B5: requires auth(). Non-owner callers can only see their own audit rows;
 * owners (ALLOWED_USER_IDS) may query any user's rows.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getAuditLog } from '@/lib/audit'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export const runtime = 'nodejs'

function getAllowedUserIds(): Set<string> | null {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map(id => id.trim()).filter(Boolean))
}

function isOwner(userId: string): boolean {
  const allowed = getAllowedUserIds()
  // If no allowlist configured, every authenticated user is effectively the owner
  if (!allowed) return true
  return allowed.has(userId)
}

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'audit:read', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  const { searchParams } = new URL(req.url)
  const requested = searchParams.get('userId') ?? undefined

  // Force-filter: non-owners can only see their own rows.
  // Owners may pass a userId override, or leave unset to see everything.
  const filterUserId = isOwner(userId) ? requested : userId

  const entries = await getAuditLog({
    limit:    Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 500),
    resource: searchParams.get('resource') ?? undefined,
    action:   searchParams.get('action')   ?? undefined,
    userId:   filterUserId,
  })

  return NextResponse.json({ entries })
}

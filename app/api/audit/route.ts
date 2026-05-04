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
import { createServerClient } from '@/lib/supabase'

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

/**
 * POST /api/audit — toggle the `pinned` flag on an audit_log row.
 *
 * Body: { id: string, pinned: boolean }
 *
 * Owner-only (ALLOWED_USER_IDS). Pinned rows survive the 90-day prune
 * cron at /api/cron/audit-prune.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isOwner(userId)) return NextResponse.json({ error: 'owner only' }, { status: 403 })

  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'audit:pin', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  const body = await req.json().catch(() => ({})) as { id?: string; pinned?: boolean }
  if (!body.id || typeof body.pinned !== 'boolean') {
    return NextResponse.json({ error: 'body must be { id, pinned: bool }' }, { status: 400 })
  }
  const db = createServerClient()
  if (!db) return NextResponse.json({ error: 'no database configured' }, { status: 500 })

  // `pinned` column lands in migration 030 — until lib/database.types.ts is
  // regenerated we use the same escape hatch as lib/business/db.ts.
  type LooseUpdate = {
    update: (patch: Record<string, unknown>) => LooseUpdate
    eq:     (k: string, v: unknown) => Promise<{ error: { message: string } | null }>
  }
  const { error } = await (db.from('audit_log' as never) as unknown as LooseUpdate)
    .update({ pinned: body.pinned })
    .eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

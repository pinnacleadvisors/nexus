/**
 * /api/settings/coolify
 *
 * GET — return current kill-switch status + last N audit rows for the
 *       /settings/accounts Coolify panel.
 * POST — toggle the kill switch. Body: { revoke: true } to disable agent
 *        access, { revoke: false } to re-enable. Optional reason.
 *
 * Auth: Clerk + the same owner-allowlist gate (`isPlatformOwner`) the
 * page uses. Coolify access is platform-wide, so only the operator can
 * flip it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import {
  isKillSwitchActive,
  revokeKillSwitch,
  reactivateKillSwitch,
  listRecentAuditRows,
  recentWriteCount,
  RATE_LIMIT_WRITES_PER_MIN,
  RATE_LIMIT_WRITES_PER_HOUR,
} from '@/lib/coolify/audit'

export const runtime    = 'nodejs'
export const maxDuration = 10

function isPlatformOwner(userId: string): boolean {
  const raw = process.env.ALLOWED_USER_IDS?.trim()
  if (!raw) return true
  return raw.split(',').map(s => s.trim()).filter(Boolean).includes(userId)
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'settings:coolify:get' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized', code: 'unauthorized' }, { status: 401 })
  if (!isPlatformOwner(session.userId)) return NextResponse.json({ ok: false, error: 'platform-owner only', code: 'forbidden' }, { status: 403 })

  const [active, audit, minCount, hourCount] = await Promise.all([
    isKillSwitchActive(),
    listRecentAuditRows({ userId: session.userId, limit: 25 }),
    recentWriteCount({ userId: session.userId, sinceMs: 60_000 }),
    recentWriteCount({ userId: session.userId, sinceMs: 60 * 60_000 }),
  ])

  return NextResponse.json({
    ok:     true,
    status: active ? 'active' : 'revoked',
    rate_limits: {
      per_minute: { used: minCount,  max: RATE_LIMIT_WRITES_PER_MIN  },
      per_hour:   { used: hourCount, max: RATE_LIMIT_WRITES_PER_HOUR },
    },
    audit,
  })
}

interface Body {
  revoke?: boolean
  reason?: string
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'settings:coolify:post' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized', code: 'unauthorized' }, { status: 401 })
  if (!isPlatformOwner(session.userId)) return NextResponse.json({ ok: false, error: 'platform-owner only', code: 'forbidden' }, { status: 403 })

  let body: Body
  try { body = (await req.json()) as Body } catch {
    return NextResponse.json({ ok: false, error: 'invalid json body', code: 'invalid' }, { status: 400 })
  }
  if (typeof body.revoke !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'body.revoke must be boolean', code: 'invalid' }, { status: 400 })
  }

  const status = body.revoke
    ? await revokeKillSwitch({ revokedBy: session.userId, reason: body.reason })
    : await reactivateKillSwitch()

  if (!status) {
    return NextResponse.json({ ok: false, error: 'failed to update kill switch', code: 'internal' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, status })
}

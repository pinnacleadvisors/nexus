/**
 * GET  /api/kill-switches    — list all switches with current state
 * POST /api/kill-switches    — toggle a switch (owner-only)
 *
 * Body: { key: KillSwitchKey, enabled: boolean }
 *
 * Owner enforcement: ALLOWED_USER_IDS allowlist. If unset, every authed
 * user is treated as the owner (single-tenant default).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { audit } from '@/lib/audit'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { listSwitches, setSwitch, KILL_SWITCH_KEYS, type KillSwitchKey } from '@/lib/kill-switches'

export const runtime = 'nodejs'

function getAllowedUserIds(): Set<string> | null {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map(id => id.trim()).filter(Boolean))
}

function isOwner(userId: string): boolean {
  const allowed = getAllowedUserIds()
  if (!allowed) return true
  return allowed.has(userId)
}

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isOwner(userId)) return NextResponse.json({ error: 'owner only' }, { status: 403 })

  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'killswitches:read', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  const switches = await listSwitches()
  return NextResponse.json({ switches })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isOwner(userId)) return NextResponse.json({ error: 'owner only' }, { status: 403 })

  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'killswitches:write', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  const body = await req.json().catch(() => ({})) as { key?: string; enabled?: boolean }
  if (!body.key || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'body must be { key, enabled: bool }' }, { status: 400 })
  }
  if (!KILL_SWITCH_KEYS.includes(body.key as KillSwitchKey)) {
    return NextResponse.json({ error: `unknown switch: ${body.key}` }, { status: 400 })
  }

  const updated = await setSwitch(body.key as KillSwitchKey, body.enabled, userId)
  if (!updated) return NextResponse.json({ error: 'failed to persist toggle' }, { status: 500 })

  audit(req, {
    action:     'kill_switch.flip',
    resource:   'kill_switches',
    resourceId: body.key,
    userId,
    metadata:   { key: body.key, enabled: body.enabled },
  })

  return NextResponse.json({ ok: true, switch: updated })
}

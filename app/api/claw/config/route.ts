/**
 * /api/claw/config — OpenClaw gateway URL + hook-token storage.
 *
 * B10: values are persisted in the encrypted `user_secrets` table (kind=openclaw)
 * when Supabase is configured. For backward compat (and for unauthenticated
 * dev setups), we still write a short-lived cookie as a fallback — but the DB
 * is the source of truth when present.
 *
 * Callers (e.g. /api/chat, /api/claw/*) should read via `resolveClawConfig()`
 * which tries env → DB → cookie in that order.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { setSecret, getSecrets, deleteSecrets } from '@/lib/user-secrets'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { checkCsrf } from '@/lib/csrf'
import { audit } from '@/lib/audit'

const COOKIE_NAME = 'nexus_claw_cfg'
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // Shortened from 90 days → 7 days post-DB-migration
}

/** POST /api/claw/config — save gateway URL + hook token (DB primary, cookie fallback) */
export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req)
  if (csrf) return csrf

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'claw-cfg', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  const { gatewayUrl, hookToken } = await req.json()
  if (!gatewayUrl || !hookToken) {
    return NextResponse.json({ error: 'gatewayUrl and hookToken are required' }, { status: 400 })
  }

  const url = String(gatewayUrl).trim()
  const tok = String(hookToken).trim()

  // Primary: encrypted DB storage. Returns false silently if Supabase is unset.
  const dbOk = await Promise.all([
    setSecret(userId, 'openclaw', 'gatewayUrl', url),
    setSecret(userId, 'openclaw', 'hookToken',  tok),
  ])

  const storedIn = dbOk.every(Boolean) ? 'db' : 'cookie'
  const res = NextResponse.json({ ok: true, storedIn })

  // Transition period: write the cookie too so existing readers (chat, claw/chat,
  // claw/status, build/dispatch, webhooks/claw) keep working until they are
  // migrated to read from `user_secrets`. A follow-up commit will flip them and
  // this fallback will be removed.
  const payload = JSON.stringify({ gatewayUrl: url, hookToken: tok })
  res.cookies.set(COOKIE_NAME, payload, COOKIE_OPTS)

  audit(req, { action: 'claw.config.set', resource: 'claw', userId, metadata: { url, storage: dbOk.every(Boolean) ? 'db' : 'cookie' } })
  return res
}

/** GET /api/claw/config — returns whether a config exists (never returns the token) */
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (userId) {
    const secrets = await getSecrets(userId, 'openclaw')
    if (secrets.gatewayUrl) {
      return NextResponse.json({ configured: true, gatewayUrl: secrets.gatewayUrl, storedIn: 'db' })
    }
  }
  // Fallback to cookie for unauthenticated or pre-migration sessions
  const cookie = req.cookies.get(COOKIE_NAME)
  if (!cookie) return NextResponse.json({ configured: false })
  try {
    const { gatewayUrl } = JSON.parse(cookie.value)
    return NextResponse.json({ configured: true, gatewayUrl, storedIn: 'cookie' })
  } catch {
    return NextResponse.json({ configured: false })
  }
}

/** DELETE /api/claw/config — remove the stored config (both DB and cookie) */
export async function DELETE(req: NextRequest) {
  const csrf = checkCsrf(req)
  if (csrf) return csrf

  const { userId } = await auth()
  if (userId) await deleteSecrets(userId, 'openclaw')

  const res = NextResponse.json({ ok: true })
  res.cookies.delete(COOKIE_NAME)

  if (userId) audit(req, { action: 'claw.config.delete', resource: 'claw', userId })
  return res
}

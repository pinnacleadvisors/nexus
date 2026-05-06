/**
 * POST /api/connected-accounts/init
 *
 * Starts a Composio OAuth flow for a connected platform.
 *
 * Body:
 *   { platform: string, businessSlug?: string }
 *
 * Returns:
 *   { redirectUrl: string }   — open this in the browser to begin OAuth
 *
 * Behaviour:
 *   - Validates platform against lib/oauth/providers.ts
 *   - Calls Composio's initiateConnection
 *   - Sets an HTTP-only `caconnect_state` cookie carrying
 *     { userId, businessSlug, platform, nonce } for the callback to verify
 *   - Returns the Composio-hosted redirect URL
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { initiateConnection, ComposioError } from '@/lib/composio/client'
import { getProvider } from '@/lib/oauth/providers'
import { isBusinessSlug } from '@/lib/claw/business-client'

export const runtime = 'nodejs'

interface InitBody {
  platform?:     string
  businessSlug?: string | null
}

const STATE_COOKIE = 'caconnect_state'
const STATE_TTL_S  = 600 // 10 min

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'connected-accounts:init' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: InitBody
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (typeof body.platform !== 'string' || !body.platform) {
    return NextResponse.json({ error: 'platform required' }, { status: 400 })
  }
  const provider = getProvider(body.platform)
  if (!provider) {
    return NextResponse.json({ error: 'unknown platform' }, { status: 400 })
  }
  const businessSlug = body.businessSlug?.trim() || null
  if (businessSlug && !isBusinessSlug(businessSlug)) {
    return NextResponse.json({ error: 'invalid businessSlug' }, { status: 400 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  const redirectUri = `${appUrl}/api/connected-accounts/callback`
  const nonce = crypto.randomUUID()

  let result
  try {
    result = await initiateConnection({
      integrationId: provider.integrationId,
      state: nonce,
      redirectUri,
      metadata: {
        nexusUserId:     session.userId,
        nexusPlatform:   provider.id,
        nexusBusiness:   businessSlug,
      },
    })
  } catch (err) {
    const status  = err instanceof ComposioError ? err.status  : 502
    const message = err instanceof Error          ? err.message : 'composio init failed'
    audit(req, {
      action:   'connected_accounts.init',
      resource: 'composio_connection',
      userId:   session.userId,
      metadata: { platform: provider.id, businessSlug, error: message, status },
    })
    return NextResponse.json({ error: message }, { status: status >= 400 && status < 600 ? status : 502 })
  }

  audit(req, {
    action:    'connected_accounts.init',
    resource:  'composio_connection',
    userId:    session.userId,
    metadata:  { platform: provider.id, businessSlug, connectionId: result.connectionId },
  })

  const res = NextResponse.json({ redirectUrl: result.redirectUrl })
  res.cookies.set(STATE_COOKIE, JSON.stringify({
    userId:       session.userId,
    businessSlug,
    platform:     provider.id,
    nonce,
    connectionId: result.connectionId,
  }), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path:     '/',
    maxAge:   STATE_TTL_S,
  })
  return res
}

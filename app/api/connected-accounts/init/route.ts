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
 *   - Resolves COMPOSIO_AUTH_CONFIG_<TOOLKIT_SLUG> env var (each toolkit
 *     needs an Auth Config created once in the Composio dashboard).
 *   - Calls Composio's POST /api/v3/connected_accounts/link
 *   - Sets an HTTP-only `caconnect_state` cookie carrying
 *     { userId, businessSlug, platform, nonce, connectedAccountId } for the
 *     callback to verify
 *   - Returns the Composio-hosted redirect URL
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { createConnectionLink, getAuthConfigId, ComposioError } from '@/lib/composio/client'
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

  const authConfigId = getAuthConfigId(provider.toolkitSlug)
  if (!authConfigId) {
    return NextResponse.json({
      error: `No Composio Auth Config for ${provider.name}. Create one at app.composio.dev → Auth Configs → New, choose toolkit "${provider.toolkitSlug}", then set env COMPOSIO_AUTH_CONFIG_${provider.toolkitSlug}=<auth_config_id>.`,
    }, { status: 503 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  const nonce  = crypto.randomUUID()
  // Embed the nonce in callback_url so Composio passes it back via query.
  // The callback verifies it against the cookie value below.
  const callbackUrl = new URL('/api/connected-accounts/callback', appUrl)
  callbackUrl.searchParams.set('nonce', nonce)

  let result
  try {
    result = await createConnectionLink({
      authConfigId,
      userId:        session.userId,
      callbackUrl:   callbackUrl.toString(),
    })
  } catch (err) {
    const status  = err instanceof ComposioError ? err.status  : 502
    const message = err instanceof Error          ? err.message : 'composio link create failed'
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
    metadata:  { platform: provider.id, businessSlug, connectedAccountId: result.connectedAccountId, linkToken: result.linkToken.slice(0, 8) + '…' },
  })

  const res = NextResponse.json({ redirectUrl: result.redirectUrl })
  res.cookies.set(STATE_COOKIE, JSON.stringify({
    userId:             session.userId,
    businessSlug,
    platform:           provider.id,
    nonce,
    connectedAccountId: result.connectedAccountId,
  }), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path:     '/',
    maxAge:   STATE_TTL_S,
  })
  return res
}

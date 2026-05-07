/**
 * GET /api/connected-accounts/callback
 *
 * Composio's redirect target after the user authorises a third-party app.
 *
 * Query params (sent by Composio):
 *   state               - the nonce we set in initiate()
 *   connectedAccountId  - Composio's id for the resulting connection
 *   status              - "success" | "failed"
 *   error?              - failure detail
 *
 * Behaviour:
 *   - Reads our `caconnect_state` HTTP-only cookie set by /init
 *   - Verifies the cookie's nonce matches Composio's state param
 *   - Inserts a connected_accounts row
 *   - Redirects to /settings/accounts with success/error toast param
 */

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

const STATE_COOKIE = 'caconnect_state'

interface StateCookie {
  userId:       string
  businessSlug: string | null
  platform:     string
  nonce:        string
  connectionId: string
}

function parseStateCookie(raw: string | undefined): StateCookie | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as Partial<StateCookie>
    if (typeof obj.userId === 'string' && typeof obj.platform === 'string' && typeof obj.nonce === 'string') {
      return {
        userId:       obj.userId,
        businessSlug: typeof obj.businessSlug === 'string' ? obj.businessSlug : null,
        platform:     obj.platform,
        nonce:        obj.nonce,
        connectionId: typeof obj.connectionId === 'string' ? obj.connectionId : '',
      }
    }
    return null
  } catch {
    return null
  }
}

function settingsRedirect(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL('/settings/accounts', req.url)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = NextResponse.redirect(url)
  // Clear the state cookie regardless of outcome
  res.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}

export async function GET(req: NextRequest) {
  // Even on failures we redirect — only rate-limit to blunt enumeration.
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'connected-accounts:callback' })
  if (!rl.success) return rateLimitResponse(rl)

  const url                = new URL(req.url)
  // We round-trip the nonce through Composio's `callback_url` query param,
  // so it appears here as `nonce`. (Composio's v3 link flow doesn't have a
  // dedicated `state` field — older docs called it `state` but the new API
  // doesn't accept it; embedding in callback_url is the canonical workaround.)
  const stateParam         = url.searchParams.get('nonce') ?? url.searchParams.get('state')
  const connectedAccountId = url.searchParams.get('connected_account_id') ?? url.searchParams.get('connectedAccountId') ?? url.searchParams.get('connection_id')
  const status             = url.searchParams.get('status') ?? 'success'
  const errorParam         = url.searchParams.get('error')

  const cookieRaw = req.cookies.get(STATE_COOKIE)?.value
  const cookie    = parseStateCookie(cookieRaw)

  if (!cookie) {
    audit(req, { action: 'connected_accounts.callback', resource: 'composio_connection', metadata: { reason: 'missing_state_cookie' } })
    return settingsRedirect(req, { error: 'session expired — please retry' })
  }

  if (!stateParam || stateParam !== cookie.nonce) {
    audit(req, {
      action:   'connected_accounts.callback',
      resource: 'composio_connection',
      userId:   cookie.userId,
      metadata: { reason: 'state_mismatch', received: stateParam ? '<set>' : '<missing>' },
    })
    return settingsRedirect(req, { error: 'invalid state — please retry' })
  }

  if (status !== 'success' || !connectedAccountId) {
    audit(req, {
      action:   'connected_accounts.callback',
      resource: 'composio_connection',
      userId:   cookie.userId,
      metadata: { reason: 'oauth_failed', platform: cookie.platform, error: errorParam, status },
    })
    return settingsRedirect(req, { error: errorParam || 'OAuth was cancelled' })
  }

  const db = createServerClient()
  if (!db) {
    return settingsRedirect(req, { error: 'database not configured' })
  }

  // Upsert: if an active row already exists for (user, business, platform), revoke it first.
  const update = await (db.from('connected_accounts' as never) as unknown as {
    update: (patch: Record<string, unknown>) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string | null) => {
          eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>
        }
      }
    }
  }).update({ status: 'revoked' })
    .eq('user_id', cookie.userId)
    .eq('business_slug', cookie.businessSlug)
    .eq('status', 'active')

  if (update.error) {
    return settingsRedirect(req, { error: 'database error — please retry' })
  }

  const insert = await (db.from('connected_accounts' as never) as unknown as {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
  }).insert({
    user_id:             cookie.userId,
    business_slug:       cookie.businessSlug,
    platform:            cookie.platform,
    composio_account_id: connectedAccountId,
    status:              'active',
    metadata:            { connectionId: cookie.connectionId },
  })

  if (insert.error) {
    audit(req, {
      action:   'connected_accounts.callback',
      resource: 'composio_connection',
      userId:   cookie.userId,
      metadata: { reason: 'insert_failed', platform: cookie.platform, error: insert.error.message },
    })
    return settingsRedirect(req, { error: 'failed to save connection — please retry' })
  }

  audit(req, {
    action:    'connected_accounts.callback',
    resource:  'composio_connection',
    userId:    cookie.userId,
    metadata:  { platform: cookie.platform, businessSlug: cookie.businessSlug, composioAccountId: connectedAccountId },
  })

  return settingsRedirect(req, { connected: cookie.platform })
}

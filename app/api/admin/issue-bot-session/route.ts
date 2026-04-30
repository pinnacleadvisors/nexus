/**
 * POST /api/admin/issue-bot-session
 *
 * Mints a Clerk sign-in ticket the qa-runner (or any other automation) can
 * redeem to obtain a real browser session as the bot user. The ticket is
 * one-time-use and expires in 1 hour by default. After redemption, the bot
 * has a normal Clerk session cookie — `proxy.ts` sees a real `auth()` userId,
 * audit logs route to the bot user, and the existing access controls just
 * work.
 *
 * Auth model: HMAC-SHA256 of the body using `BOT_ISSUER_SECRET`. Same shape
 * as services/claude-gateway expects (`X-Nexus-Signature: sha256=<hex>` +
 * `X-Nexus-Timestamp: <ms>`). Bearer auth alone is not enough — HMAC binds
 * the request body to the signature so a captured token can't be replayed
 * with a different `userId`.
 *
 * Why a separate issuer endpoint and not "just give the runner a cookie":
 *   - Cookies expire and refresh quietly fails in headless Chromium.
 *   - Tickets are scoped, time-bound, and audit-logged by Clerk.
 *   - Rotation is one Doppler write — no manual cookie capture.
 *
 * Bot user must:
 *   1. Exist in Clerk (`qa-bot@<your-domain>`) — created in the Clerk dashboard.
 *   2. Be in `ALLOWED_USER_IDS` so proxy.ts lets the bot through.
 *   3. Match `BOT_CLERK_USER_ID` env var.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

const TICKET_LIFETIME_SECONDS = 60 * 60 // 1 h
const MAX_TIMESTAMP_DRIFT_MS  = 5 * 60 * 1000 // 5 min — protects against replay

interface IssueBody {
  userId: string
}

interface IssueResponse {
  ok:      true
  ticket:  string
  url:     string
  expires: number
}

interface ErrorResponse {
  ok:    false
  error: string
}

export async function POST(req: NextRequest): Promise<NextResponse<IssueResponse | ErrorResponse>> {
  const secret = process.env.BOT_ISSUER_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'issuer_not_configured' }, { status: 503 })
  }

  const sigHeader = req.headers.get('x-nexus-signature') ?? ''
  const tsHeader  = req.headers.get('x-nexus-timestamp') ?? ''
  const ts        = Number.parseInt(tsHeader, 10)
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
    return NextResponse.json({ ok: false, error: 'stale_or_missing_timestamp' }, { status: 401 })
  }

  const bodyText = await req.text()
  const expected = 'sha256=' + createHmac('sha256', secret).update(bodyText).digest('hex')
  if (!constantTimeEqual(sigHeader, expected)) {
    return NextResponse.json({ ok: false, error: 'bad_signature' }, { status: 401 })
  }

  let parsed: IssueBody
  try {
    parsed = JSON.parse(bodyText) as IssueBody
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const requestedId = parsed.userId
  const allowedBotId = process.env.BOT_CLERK_USER_ID
  if (!allowedBotId) {
    return NextResponse.json({ ok: false, error: 'bot_user_not_configured' }, { status: 503 })
  }
  if (requestedId !== allowedBotId) {
    return NextResponse.json({ ok: false, error: 'userId_not_allowlisted' }, { status: 403 })
  }

  let ticket: { token: string; url?: string }
  try {
    const client = await clerkClient()
    ticket = await client.signInTokens.createSignInToken({
      userId:           requestedId,
      expiresInSeconds: TICKET_LIFETIME_SECONDS,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: `clerk_error: ${msg}` }, { status: 502 })
  }

  // Construct the redemption URL. Clerk's create-sign-in-token returns a
  // `url` field on most plans; if missing, build the canonical form so callers
  // never have to. The redirect target is the dashboard root — change via
  // ?redirect_url=… when needed.
  const url = ticket.url
    ?? `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/sign-in?__clerk_ticket=${encodeURIComponent(ticket.token)}`

  return NextResponse.json({
    ok:      true,
    ticket:  ticket.token,
    url,
    expires: Date.now() + TICKET_LIFETIME_SECONDS * 1000,
  })
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

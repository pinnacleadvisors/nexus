/**
 * Bot identity helpers. The autonomous QA runner (and any future automation
 * that needs to call the Nexus API without a browser session) authenticates
 * against API routes via two patterns:
 *
 *   1. **Bearer token** — `Authorization: Bearer <BOT_API_TOKEN>` on direct
 *      HTTP calls. Returns the bot's Clerk user_id from `BOT_CLERK_USER_ID`.
 *      Use this on routes that need an identity but don't need a browser
 *      session (e.g. `POST /api/runs` from the runner).
 *
 *   2. **Clerk sign-in ticket** — issued by `POST /api/admin/issue-bot-session`,
 *      redeemed by visiting the returned URL. Produces a real Clerk session
 *      cookie. Used by Playwright fixtures that need to render protected
 *      pages as the bot user.
 *
 * Both patterns require:
 *   - `BOT_CLERK_USER_ID` is in Doppler `ALLOWED_USER_IDS`. If the bearer
 *     leaks, the proxy.ts allowlist still blocks every other Vercel deploy.
 *   - The bot user exists in Clerk and was created from the Clerk dashboard
 *     (not via the bot itself — chicken/egg).
 *
 * NEVER:
 *   - Use the human owner's userId for the bot. Audit trails get muddled and
 *     a bot leak means a leaked human identity.
 *   - Reuse `BOT_API_TOKEN` for `BOT_ISSUER_SECRET`. They protect different
 *     surfaces (HTTP API vs ticket issuer) and rotation needs are different.
 */

import { NextRequest } from 'next/server'

/**
 * Inspect an incoming request for the bot bearer token. When valid, returns
 * the bot's Clerk user_id so downstream `auth()` consumers see a uniform
 * identity. Returns `null` for any other request — the caller is expected to
 * fall back to Clerk's `auth()` for human sessions.
 *
 * Uses constant-time comparison to avoid timing attacks.
 */
export function authBotToken(req: NextRequest | Request): string | null {
  const expected = process.env.BOT_API_TOKEN
  const botUserId = process.env.BOT_CLERK_USER_ID
  if (!expected || !botUserId) return null

  const header = req.headers.get('authorization') ?? ''
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  if (!token) return null

  if (!constantTimeEqual(token, expected)) return null
  return botUserId
}

/**
 * Resolve the request identity in this order: human Clerk session → bot bearer
 * token → null. Most API routes should call this instead of bare `auth()`
 * when they need to also accept the bot.
 *
 * Pass `clerkUserId` from `auth()` so this helper stays independent of the
 * Clerk SDK (server-runtime quirks: `auth()` only works inside server contexts).
 */
export function resolveCallerUserId(
  req: NextRequest | Request,
  clerkUserId: string | null | undefined,
): string | null {
  if (clerkUserId) return clerkUserId
  return authBotToken(req)
}

/**
 * Returns true when the resolved caller is the bot user. Useful for routes
 * that need to scope mutations to a `qa-bot` namespace (e.g. test runs that
 * shouldn't pollute real data).
 */
export function isBotCaller(userId: string | null): boolean {
  if (!userId) return false
  const botUserId = process.env.BOT_CLERK_USER_ID
  return Boolean(botUserId) && userId === botUserId
}

/**
 * Constant-time string comparison. Prevents inferring secret length / prefix
 * from response timing. Returns false immediately on length mismatch — that
 * leak is acceptable since lengths are public per the deployment.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

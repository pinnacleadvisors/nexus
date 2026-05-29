/**
 * lib/auth/resolve-user.ts — resilient Clerk auth() for server components.
 *
 * `auth()` from @clerk/nextjs/server does NOT simply return `{ userId: null }`
 * when the Clerk middleware context is missing — it THROWS. The context is
 * missing whenever:
 *   - Clerk is half-configured (publishable key set, secret key missing) —
 *     proxy.ts:102 passes the request straight through with NextResponse.next()
 *   - clerkMiddleware() throws (bad keys / domain not whitelisted / Clerk API
 *     unreachable) and proxy.ts:117 catches it and falls through
 *   - a transient Clerk outage
 *
 * A server component that calls `await auth()` unguarded then 500s the whole
 * page on any of the above — turning a "bounce to sign-in" into a hard error.
 * Owner-only pages (/audit, /inbox, /issues, …) were doing exactly this.
 *
 * This helper centralises the try/catch so every page degrades identically.
 * IMPORTANT: callers must `redirect()` on a null return OUTSIDE any try/catch
 * of their own — Next's redirect() throws NEXT_REDIRECT, which MUST propagate.
 * Since this helper returns (never throws) and the caller's redirect is in the
 * page body (not wrapped), that invariant holds:
 *
 *   const userId = await resolveUserIdSafe()
 *   if (!userId) redirect('/sign-in')
 *
 * Mirrors the inline pattern already proven in app/(protected)/teams/page.tsx.
 */

import { auth } from '@clerk/nextjs/server'

/** Returns the authenticated Clerk user id, or null when auth can't be
 *  resolved. Never throws. */
export async function resolveUserIdSafe(): Promise<string | null> {
  try {
    const { userId } = await auth()
    return userId ?? null
  } catch {
    return null
  }
}

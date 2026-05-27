import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'

/**
 * Read LOCAL_MODE at module load. When true, the operator is running
 * Nexus as a personal-OS install (single-user localhost) and Clerk is
 * intentionally skipped. See task_plan-desktop-app.md Phase 2.
 *
 * Inlined here (not via lib/platform/local-mode.ts) so the proxy stays
 * dependency-free — middleware runs in the Edge runtime and importing
 * heavyweight server helpers would bloat it.
 */
function isLocalMode(): boolean {
  const v = (process.env.LOCAL_MODE ?? process.env.NEXUS_LOCAL_MODE ?? '').toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

// SECURITY: `app/(protected)/layout.tsx` does NOT call `auth()` — every
// page under the route group relies on this middleware matcher for its
// auth gate. Every directory under `app/(protected)/` MUST appear here,
// or its pages leak unauthenticated. Audited 2026-05-27 against the full
// directory listing. The `check:topology` script + a Playwright spec
// verify drift doesn't reintroduce gaps.
const isProtectedRoute = createRouteMatcher([
  // Original gated set
  '/dashboard(.*)',
  '/forge(.*)',
  '/board(.*)',
  '/tools(.*)',
  '/build(.*)',
  '/graph(.*)',
  '/swarm(.*)',
  // First defense-in-depth wave (ADR 003) — these existed in the route
  // group but relied on the layout for auth; added to the matcher when
  // a leak was identified pre-prod.
  '/idea(.*)',
  '/idea-library(.*)',
  '/learn(.*)',
  '/settings(.*)',
  '/signals(.*)',
  '/manage-platform(.*)',
  // Second defense-in-depth wave (2026-05-27 audit) — every route group
  // member below this comment was previously unguarded. A curl to
  // `/businesses` returned 200 with rendered data + business slugs.
  // Closing the gap now AND adding /api/audit + cron-health.
  '/agents(.*)',
  '/approvals(.*)',
  '/audit(.*)',
  '/automation-library(.*)',
  '/businesses(.*)',
  '/cron-health(.*)',
  '/inbox(.*)',
  '/issues(.*)',
  '/memory(.*)',
  '/org(.*)',
  '/simulate(.*)',
  '/teams(.*)',
])

// Owner-only allowlist: comma-separated Clerk user IDs (e.g. "user_abc,user_xyz").
// When set, any authenticated user NOT in this list is redirected to sign-in.
// Leave unset to allow all authenticated users (useful when inviting a team later).
function getAllowedUserIds(): Set<string> | null {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map(id => id.trim()).filter(Boolean))
}

// Pre-build the Clerk handler once at module load.
// Clerk does NOT validate the publishable key here — only on first request.
const _clerk = clerkMiddleware(async (auth, req) => {
  if (!isProtectedRoute(req)) return
  const session = await auth()
  if (!session.userId) {
    return Response.redirect(new URL('/sign-in', req.url))
  }
  // Enforce owner-only allowlist when configured
  const allowed = getAllowedUserIds()
  if (allowed && !allowed.has(session.userId)) {
    return Response.redirect(new URL('/sign-in', req.url))
  }
})

export default async function proxy(req: NextRequest, event: NextFetchEvent) {
  // LOCAL_MODE — personal-OS install. Skip Clerk entirely; treat every
  // request as the single local operator. The layout + api routes that
  // call auth() return a sentinel user_id ('local-operator', see
  // lib/platform/local-mode.ts) instead of crashing.
  if (isLocalMode()) {
    return NextResponse.next()
  }

  // If Clerk is not configured at all, pass through cleanly.
  // The layout will render the "Setup Required" page.
  //
  // Gate on BOTH keys. Half-configured (publishable set, secret missing) is
  // the failure mode that produces the "auth() called but clerkMiddleware
  // not detected" crash in page.tsx: clerkMiddleware needs the secret key
  // to validate sessions and throws here when it's missing, the catch below
  // swallows it, async-local-storage never gets set, and the page render
  // then trips Clerk's middleware-detection guard.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    return NextResponse.next()
  }

  // Wrap in try/catch: Clerk can throw if the domain isn't whitelisted in the
  // Clerk dashboard, if keys are wrong, or if the Clerk API is unreachable.
  // A crash here produces a raw edge-runtime stream with no Content-Type,
  // which combined with X-Content-Type-Options: nosniff causes browsers to
  // download the response as a file instead of rendering it.
  try {
    return await _clerk(req, event)
  } catch (err) {
    // Log so the next "Clerk auth() not detected" Sentry alert has a paired
    // root-cause line in the function logs instead of silent fallthrough.
    console.error('[proxy] clerkMiddleware threw — falling through to next():', err instanceof Error ? err.message : err)
    return NextResponse.next()
  }
}

export const config = {
  matcher: [
    // Skip Next.js internals, all static files, AND the Vercel log drain.
    // The drain is a high-volume HMAC-authenticated webhook (see route.ts);
    // Clerk does nothing for it and adds ~338MB middleware memory per call.
    // See AGENTS.md "Webhook self-amplification checklist".
    '/((?!_next|api/vercel/log-drain|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes EXCEPT the Vercel log drain (HMAC-auth, no Clerk).
    // Two parser quirks: (a) `(?!` immediately after `/(` is rejected — wrap
    // it in an outer group; (b) inner capturing groups inside that outer group
    // are also rejected, so `(api|trpc)` and `(.*)` must be non-capturing.
    '/((?!api/vercel/log-drain)(?:api|trpc).*)',
  ],
}

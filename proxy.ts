import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/forge(.*)',
  '/board(.*)',
  '/tools(.*)',
  '/build(.*)',
  '/graph(.*)',
  '/swarm(.*)',
  // Defense-in-depth — these pages live under app/(protected)/ and rely on the
  // route-group layout for auth, but we still middleware-gate them so a future
  // page added to the group without explicit `auth()` in its layout never
  // leaks. See docs/adr/003-protected-route-matcher.md for the rationale.
  '/idea(.*)',
  '/idea-library(.*)',
  '/learn(.*)',
  '/settings(.*)',
  '/signals(.*)',
  '/manage-platform(.*)',
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
  // If Clerk is not configured at all, pass through cleanly.
  // The layout will render the "Setup Required" page.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return NextResponse.next()
  }

  // Wrap in try/catch: Clerk can throw if the domain isn't whitelisted in the
  // Clerk dashboard, if keys are wrong, or if the Clerk API is unreachable.
  // A crash here produces a raw edge-runtime stream with no Content-Type,
  // which combined with X-Content-Type-Options: nosniff causes browsers to
  // download the response as a file instead of rendering it.
  try {
    return await _clerk(req, event)
  } catch {
    return NextResponse.next()
  }
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}

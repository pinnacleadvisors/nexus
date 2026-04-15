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
])

// Pre-build the Clerk handler once at module load.
// Clerk does NOT validate the publishable key here — only on first request.
const _clerk = clerkMiddleware(async (auth, req) => {
  if (!isProtectedRoute(req)) return
  const session = await auth()
  if (!session.userId) {
    return Response.redirect(new URL('/', req.url))
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

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

export default async function Page() {
  // Guard against the case where this page runs but clerkMiddleware did not.
  // Happens when proxy.ts caught a clerkMiddleware throw (logged there) and
  // fell through to NextResponse.next() — without this try/catch, every such
  // request emits a Sentry "auth() called but clerkMiddleware not detected"
  // error. Redirecting to /sign-in degrades gracefully instead.
  let userId: string | null = null
  try {
    const session = await auth()
    userId = session.userId
  } catch {
    // intentional: fall through to the sign-in redirect below
  }
  redirect(userId ? '/dashboard' : '/sign-in')
}

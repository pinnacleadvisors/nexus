/**
 * CSRF protection — verifies that mutation requests (POST/PUT/PATCH/DELETE)
 * originate from the same host as the application.
 *
 * Strategy: Origin header check (double-submit is not needed since all mutations
 * go through the AI SDK or fetch() with explicit headers, not HTML forms).
 *
 * Exempt routes (HMAC-verified externally):
 *   - /api/webhooks/*  — Stripe, OpenClaw — verified via HMAC signature
 *   - /api/inngest     — Inngest signing key
 *   - /api/oauth/*     — OAuth redirect flows
 */

import { NextRequest, NextResponse } from 'next/server'

// Routes that should skip CSRF checking (external webhooks / OAuth flows)
const CSRF_EXEMPT_PREFIXES = [
  '/api/webhooks/',
  '/api/inngest',
  '/api/oauth/',
]

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Returns a 403 response if the request fails CSRF validation, otherwise null. */
export function checkCsrf(req: NextRequest): NextResponse | null {
  // Safe methods are always allowed
  if (SAFE_METHODS.has(req.method)) return null

  const pathname = new URL(req.url).pathname

  // Exempt routes
  if (CSRF_EXEMPT_PREFIXES.some(p => pathname.startsWith(p))) return null

  const origin  = req.headers.get('origin')
  const referer = req.headers.get('referer')

  // Allow requests with no Origin (e.g. server-to-server, curl during dev)
  if (!origin && !referer) return null

  const appHost = req.headers.get('host') ?? ''
  const appUrl  = process.env.NEXT_PUBLIC_APP_URL

  // Build set of allowed origins
  const allowed = new Set<string>()
  if (appHost) {
    allowed.add(`http://${appHost}`)
    allowed.add(`https://${appHost}`)
  }
  if (appUrl) allowed.add(appUrl.replace(/\/$/, ''))
  // Always allow localhost in development
  allowed.add('http://localhost:3000')
  allowed.add('http://localhost:3001')

  // Check Origin header
  if (origin) {
    const normalised = origin.replace(/\/$/, '')
    if (!allowed.has(normalised)) {
      return NextResponse.json({ error: 'CSRF: invalid origin' }, { status: 403 })
    }
  }

  // Check Referer as secondary signal when Origin is absent
  if (!origin && referer) {
    const refUrl = new URL(referer)
    const refOrigin = `${refUrl.protocol}//${refUrl.host}`
    const normalised = refOrigin.replace(/\/$/, '')
    if (!allowed.has(normalised)) {
      return NextResponse.json({ error: 'CSRF: invalid referer' }, { status: 403 })
    }
  }

  return null
}

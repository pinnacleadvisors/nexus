/**
 * POST /api/health/cron/run
 *
 * Owner-only manual trigger for any of the configured Vercel cron jobs. The
 * Health panel hits this endpoint with `{ path: '/api/cron/<name>' }` and we:
 *
 *   1. Verify the caller is in `ALLOWED_USER_IDS` (owner-only).
 *   2. Whitelist the requested path against the same CRONS list the Health
 *      panel reads from — no arbitrary fetches.
 *   3. Make an internal POST to the target cron route, supplying
 *      `Authorization: Bearer ${CRON_SECRET}` so the target route's auth
 *      gate accepts us as if Vercel itself had fired the cron. Owner-session
 *      auth on cron routes is uneven; the bearer is universal.
 *   4. Forward the target's response (status + body) back to the panel.
 *
 * Why a meta-route? The cron routes have varied auth schemes (some accept
 * owner sessions, others HMAC, others only CRON_SECRET). Calling them
 * directly from the browser would require the panel to know each route's
 * scheme. This route hides that — every cron is invokable through one
 * uniform owner-authenticated POST.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

export const runtime = 'nodejs'
export const maxDuration = 60

// Whitelist mirrors the CRONS array in /api/health/cron/route.ts. Adding a
// new cron requires updating BOTH places.
const ALLOWED_PATHS = new Set<string>([
  '/api/cron/signal-review',
  '/api/cron/rebuild-graph-hq',
  '/api/cron/sync-memory?reconcile=1',
  '/api/cron/post-deploy-smoke',
  '/api/cron/sync-learning-cards',
  '/api/cron/sweep-orphan-cards',
])

interface RunBody {
  path?: string
}

async function authorize(): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const a = await auth()
  if (!a.userId) return { ok: false, status: 401, error: 'unauthorized' }
  const allowed = (process.env.ALLOWED_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
  if (allowed.length > 0 && !allowed.includes(a.userId)) {
    return { ok: false, status: 403, error: 'forbidden' }
  }
  return { ok: true }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const authz = await authorize()
    if (!authz.ok) {
      return NextResponse.json({ ok: false, error: authz.error }, { status: authz.status })
    }

    const body = (await req.json().catch(() => ({}))) as RunBody
    const path = body.path?.trim()
    if (!path || !ALLOWED_PATHS.has(path)) {
      return NextResponse.json({
        ok:    false,
        error: 'invalid path; pick one from the whitelist',
        whitelist: Array.from(ALLOWED_PATHS),
      }, { status: 400 })
    }

    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return NextResponse.json({
        ok:    false,
        error: 'CRON_SECRET unset — manual cron triggers require this env var',
      }, { status: 503 })
    }

    // Internal call to the target cron. `req.nextUrl.origin` resolves to the
    // current deploy's origin (preview URL or production), so this works on
    // every deployment without baking in a hostname.
    const targetUrl = `${req.nextUrl.origin}${path}`
    const start = Date.now()
    let upstream: Response
    try {
      upstream = await fetch(targetUrl, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${cronSecret}`,
          'Content-Type':  'application/json',
        },
        body: '{}',
      })
    } catch (err) {
      return NextResponse.json({
        ok:    false,
        error: `Internal fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        targetUrl,
      }, { status: 502 })
    }

    const duration = Date.now() - start
    const text = await upstream.text()
    let parsed: unknown = text
    try { parsed = JSON.parse(text) } catch { /* leave as text */ }

    return NextResponse.json({
      ok:           upstream.ok,
      status:       upstream.status,
      duration_ms:  duration,
      response:     parsed,
      targetPath:   path,
    }, { status: upstream.ok ? 200 : 502 })
  } catch (err) {
    return NextResponse.json({
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}

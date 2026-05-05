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

// Whitelist mirrors the CRONS array in /api/health/cron/route.ts. Each cron's
// route exposes either GET, POST, or both, and some require a query string —
// we map the bare path the UI sends to the right method+query here so a single
// "Run now" button works for every cron without the UI knowing the schemes.
//
// Adding a new cron requires updating BOTH this map AND the CRONS list in
// /api/health/cron/route.ts.
interface PathConfig { method: 'POST' | 'GET'; query?: string }
const PATH_CONFIG = new Map<string, PathConfig>([
  ['/api/cron/signal-review',       { method: 'POST' }],
  ['/api/cron/rebuild-graph-hq',    { method: 'POST' }],
  // sync-memory's POST is a GitHub webhook (HMAC-signed); the manual reconcile
  // path is GET ?reconcile=1 with bearer auth.
  ['/api/cron/sync-memory',         { method: 'GET', query: 'reconcile=1' }],
  ['/api/cron/post-deploy-smoke',   { method: 'POST' }],
  ['/api/cron/sync-learning-cards', { method: 'POST' }],
  ['/api/cron/sweep-orphan-cards',  { method: 'POST' }],
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
    const config = path ? PATH_CONFIG.get(path) : undefined
    if (!path || !config) {
      return NextResponse.json({
        ok:    false,
        error: 'invalid path; pick one from the whitelist',
        whitelist: Array.from(PATH_CONFIG.keys()),
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
    const targetUrl = `${req.nextUrl.origin}${path}${config.query ? `?${config.query}` : ''}`
    const start = Date.now()
    const init: RequestInit = {
      method:  config.method,
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
        'Content-Type':  'application/json',
      },
    }
    // Only POST routes get a body. GET routes (sync-memory reconcile) must
    // omit it — fetch with method GET + a body is invalid in undici.
    if (config.method === 'POST') init.body = '{}'

    let upstream: Response
    try {
      upstream = await fetch(targetUrl, init)
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

    // Always return 200 from the meta-route when the inner request completed,
    // even if the cron itself returned a 4xx/5xx. The upstream HTTP code is
    // surfaced in the body so the UI can render a precise error message
    // ("upstream returned 503: qa_runner_not_configured") without the browser
    // flooding the console with network errors. The meta-route only returns
    // !2xx for its own failures (auth, missing CRON_SECRET, fetch threw).
    return NextResponse.json({
      ok:           upstream.ok,
      status:       upstream.status,
      duration_ms:  duration,
      response:     parsed,
      targetPath:   path,
      method:       config.method,
    })
  } catch (err) {
    return NextResponse.json({
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}

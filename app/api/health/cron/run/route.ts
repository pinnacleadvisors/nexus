/**
 * POST /api/health/cron/run
 *
 * Owner-only manual trigger for any of the configured Vercel cron jobs. The
 * Health panel hits this endpoint with `{ path: '/api/cron/<name>' }` and we:
 *
 *   1. Verify the caller is in `ALLOWED_USER_IDS` (owner-only).
 *   2. Whitelist the requested path against the same CRONS list the Health
 *      panel reads from — no arbitrary fetches.
 *   3. Invoke the target cron's exported handler IN PROCESS with a synthetic
 *      `Authorization: Bearer ${CRON_SECRET}` request, so the target route's
 *      auth gate accepts us as if Vercel itself had fired the cron.
 *   4. Forward the target's response (status + body) back to the panel.
 *
 * Why in-process and not `fetch(${origin}/api/cron/...)` ?
 *   On a deployment with Vercel Deployment Protection enabled, an HTTPS request
 *   from one Vercel function back to the same deployment is treated as an
 *   external visitor and rejected at the edge with a bodyless 401 — long
 *   before our cron handler runs. It also costs an extra TLS round-trip and
 *   counts against function-seconds twice. Static-importing each cron's
 *   handler and calling it directly removes the edge from the path entirely.
 *
 * Why a meta-route at all? The cron routes have varied auth schemes (some
 * accept owner sessions, others HMAC, others only CRON_SECRET). The Health
 * panel calling them directly would need to know each route's scheme. This
 * route hides that — every cron is invokable through one uniform owner POST.
 *
 * Adding a new cron requires updating BOTH the CRON_HANDLERS map below AND
 * the CRONS list in /api/health/cron/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

import { POST as signalReviewPOST }     from '@/app/api/cron/signal-review/route'
import { POST as rebuildGraphHqPOST }   from '@/app/api/cron/rebuild-graph-hq/route'
import { GET  as syncMemoryGET }        from '@/app/api/cron/sync-memory/route'
import { POST as postDeploySmokePOST }  from '@/app/api/cron/post-deploy-smoke/route'
import { POST as syncLearningCardsPOST } from '@/app/api/cron/sync-learning-cards/route'
import { POST as sweepOrphanCardsPOST } from '@/app/api/cron/sweep-orphan-cards/route'

export const runtime = 'nodejs'
export const maxDuration = 60

type CronHandler = (req: NextRequest) => Promise<Response> | Response

interface CronConfig {
  /** HTTP method our synthetic request should use (matches what the cron expects). */
  method:  'POST' | 'GET'
  /** Querystring (without the leading `?`) appended to the synthetic request URL. */
  query?:  string
  /** The route module's exported handler. */
  handler: CronHandler
}

const CRON_HANDLERS = new Map<string, CronConfig>([
  ['/api/cron/signal-review',       { method: 'POST', handler: signalReviewPOST     as CronHandler }],
  ['/api/cron/rebuild-graph-hq',    { method: 'POST', handler: rebuildGraphHqPOST   as CronHandler }],
  // sync-memory's POST is a GitHub webhook (HMAC-signed); the manual reconcile
  // path is GET ?reconcile=1 with bearer auth — that's what we wire up.
  ['/api/cron/sync-memory',         { method: 'GET',  query: 'reconcile=1', handler: syncMemoryGET as CronHandler }],
  ['/api/cron/post-deploy-smoke',   { method: 'POST', handler: postDeploySmokePOST  as CronHandler }],
  ['/api/cron/sync-learning-cards', { method: 'POST', handler: syncLearningCardsPOST as CronHandler }],
  ['/api/cron/sweep-orphan-cards',  { method: 'POST', handler: sweepOrphanCardsPOST as CronHandler }],
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

/**
 * Build a NextRequest the cron handler will treat as if it came from Vercel
 * cron itself: same origin, correct method/query, bearer-tokened. Body is
 * `{}` for POST and absent for GET (undici rejects bodies on GET).
 */
function buildSyntheticRequest(
  parent: NextRequest,
  path:   string,
  config: CronConfig,
  bearer: string,
): NextRequest {
  const url = new URL(`${path}${config.query ? `?${config.query}` : ''}`, parent.nextUrl.origin)
  // NextRequest's constructor accepts a slightly stricter init than DOM
  // RequestInit (e.g. `signal` cannot be null). Build the underlying Request
  // first, then wrap.
  const baseInit: { method: string; headers: HeadersInit; body?: string } = {
    method:  config.method,
    headers: {
      'Authorization': `Bearer ${bearer}`,
      'Content-Type':  'application/json',
    },
  }
  if (config.method === 'POST') baseInit.body = '{}'
  return new NextRequest(new Request(url, baseInit))
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const authz = await authorize()
    if (!authz.ok) {
      return NextResponse.json({ ok: false, error: authz.error }, { status: authz.status })
    }

    const body = (await req.json().catch(() => ({}))) as RunBody
    const path = body.path?.trim()
    const config = path ? CRON_HANDLERS.get(path) : undefined
    if (!path || !config) {
      return NextResponse.json({
        ok:    false,
        error: 'invalid path; pick one from the whitelist',
        whitelist: Array.from(CRON_HANDLERS.keys()),
      }, { status: 400 })
    }

    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return NextResponse.json({
        ok:    false,
        error: 'CRON_SECRET unset — manual cron triggers require this env var',
      }, { status: 503 })
    }

    const synth = buildSyntheticRequest(req, path, config, cronSecret)
    const start = Date.now()
    let upstream: Response
    try {
      upstream = await config.handler(synth)
    } catch (err) {
      return NextResponse.json({
        ok:    false,
        error: `Cron handler threw: ${err instanceof Error ? err.message : String(err)}`,
        targetPath: path,
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
    // !2xx for its own failures (auth, missing CRON_SECRET, handler threw).
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

/**
 * POST /api/cron/post-deploy-smoke
 *
 * Vercel cron entry point for the autonomous QA loop. Fires shortly after a
 * production deploy (Vercel cron schedule defined in `vercel.json`) and
 * webhook-pings the qa-runner service on Coolify so Playwright can run the
 * Tier 1 smoke spec against the live deployment.
 *
 * Why a thin trigger:
 *   - Playwright + headless Chromium do NOT reliably run inside a Vercel
 *     function — the runtime can't ship the browser binaries and times out
 *     at 60 s. The qa-runner box has the binaries, the network, and the
 *     plan budget.
 *   - Returning fast keeps Vercel cron happy. The runner responds 202 and
 *     processes async; results land via `/api/workflow-feedback` and the
 *     gateway dispatch logs.
 *
 * Auth:
 *   - Vercel cron sends `Authorization: Bearer <CRON_SECRET>` automatically;
 *     in production we accept that. In dev (or for manual triggers) we also
 *     allow the bot bearer token via `authBotToken`.
 *   - The outbound webhook to qa-runner is HMAC-signed with
 *     `QA_RUNNER_HMAC_SECRET` so the runner refuses anything else.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createHmac } from 'node:crypto'
import { authBotToken } from '@/lib/auth/bot'

export const runtime = 'nodejs'
export const maxDuration = 30

interface CronBody {
  baseUrl?:      string
  deploymentId?: string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorised(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const webhookUrl = process.env.QA_RUNNER_WEBHOOK_URL
  const hmacSecret = process.env.QA_RUNNER_HMAC_SECRET
  if (!webhookUrl || !hmacSecret) {
    return NextResponse.json({ ok: false, error: 'qa_runner_not_configured' }, { status: 503 })
  }

  let payload: CronBody = {}
  try { payload = (await req.json()) as CronBody } catch { /* GET-style triggers send empty body */ }

  const baseUrl = payload.baseUrl
    ?? process.env.QA_RUNNER_BASE_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? ''

  if (!baseUrl) {
    return NextResponse.json({ ok: false, error: 'no_base_url' }, { status: 400 })
  }

  const body = JSON.stringify({
    baseUrl,
    deploymentId: payload.deploymentId ?? process.env.VERCEL_DEPLOYMENT_ID ?? null,
  })
  const timestamp = Date.now().toString()
  const signature = 'sha256=' + createHmac('sha256', hmacSecret).update(body).digest('hex')

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'X-Nexus-Signature': signature,
      'X-Nexus-Timestamp': timestamp,
    },
    body,
  }).catch(err => {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 502,
    })
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return NextResponse.json({
      ok:    false,
      error: `qa_runner_${res.status}`,
      detail: text.slice(0, 500),
    }, { status: 502 })
  }

  return NextResponse.json({ ok: true, dispatched: true, baseUrl })
}

// Vercel cron sends GET by default. Mirror to POST for consistency.
export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req)
}

function isAuthorised(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  const header = req.headers.get('authorization') ?? ''
  if (cronSecret && header === `Bearer ${cronSecret}`) return true
  // Manual triggers (local dev) — bot token works too. The bot user is in
  // ALLOWED_USER_IDS so this is owner-equivalent without exposing the cron
  // secret to the runner box.
  if (authBotToken(req)) return true
  return false
}

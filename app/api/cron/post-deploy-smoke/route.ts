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
  const authVerdict = checkAuth(req)
  if (!authVerdict.ok) {
    // Non-secret-leaking diagnostic. The operator hitting a 401 in a
    // cron-job.org dashboard log can now tell which auth path failed
    // (CRON_SECRET unset → wrong header from caller → bot token tried &
    // failed) without grepping production logs.
    return NextResponse.json(
      { ok: false, error: 'unauthorized', reason: authVerdict.reason },
      { status: 401 },
    )
  }

  const webhookUrl = process.env.QA_RUNNER_WEBHOOK_URL
  const hmacSecret = process.env.QA_RUNNER_HMAC_SECRET
  if (!webhookUrl || !hmacSecret) {
    // qa-runner service is optional. When it isn't deployed yet (no
    // QA_RUNNER_WEBHOOK_URL in Doppler) the cron should no-op rather than
    // log a recurring 503. Health panel + Vercel cron treat 200 as healthy;
    // the `skipped` flag tells operators why nothing happened.
    return NextResponse.json({
      ok:      true,
      skipped: true,
      reason:  'qa_runner_not_configured',
      hint:    'Set QA_RUNNER_WEBHOOK_URL + QA_RUNNER_HMAC_SECRET in Doppler to enable post-deploy smoke. See services/qa-runner/README.md.',
    })
  }

  let payload: CronBody = {}
  try { payload = (await req.json()) as CronBody } catch { /* GET-style triggers send empty body */ }

  const baseUrl = payload.baseUrl
    ?? process.env.QA_RUNNER_BASE_URL
    ?? process.env.NEXUS_BASE_URL
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

type AuthVerdict =
  | { ok: true;  reason: 'cron_secret' | 'bot_token' }
  | { ok: false; reason: 'cron_secret_unset_and_bot_token_invalid' | 'cron_secret_set_but_header_mismatch' | 'no_authorization_header' }

/**
 * Returns a structured verdict so the 401 response can tell the operator
 * WHICH auth path failed without leaking the secret. 2026-05-24 — the
 * `qa-runner-401-rca` atom (mocs/autonomous-qa) documents the typical
 * failure modes this surfaces.
 */
function checkAuth(req: NextRequest): AuthVerdict {
  const cronSecret = process.env.CRON_SECRET
  const header     = req.headers.get('authorization') ?? ''

  if (cronSecret && header === `Bearer ${cronSecret}`) {
    return { ok: true, reason: 'cron_secret' }
  }
  // Manual triggers (local dev) — bot token works too. The bot user is in
  // ALLOWED_USER_IDS so this is owner-equivalent without exposing the cron
  // secret to the runner box.
  if (authBotToken(req)) {
    return { ok: true, reason: 'bot_token' }
  }

  // Diagnostic: tell the operator which auth path failed. Never leaks the
  // secret value — only whether the env var is set + whether the header
  // arrived at all.
  if (!header) {
    return { ok: false, reason: 'no_authorization_header' }
  }
  if (!cronSecret) {
    return { ok: false, reason: 'cron_secret_unset_and_bot_token_invalid' }
  }
  return { ok: false, reason: 'cron_secret_set_but_header_mismatch' }
}

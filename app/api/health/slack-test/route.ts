/**
 * POST /api/health/slack-test
 *
 * Manual webhook diagnostic for the Health view. Fires a test message to
 * `NEXUS_SLACK_WEBHOOK_URL` and returns the response so the operator can
 * see exactly WHY their loops aren't surfacing — connection refused,
 * 404 (webhook revoked), 200 but message never landed in the channel
 * (workspace-side filter), or "URL not configured" if Doppler is missing
 * the var entirely.
 *
 * NOT polled — only called when the operator clicks "Test Slack now" in
 * the Health view, so it never spams the workspace.
 *
 * Owner-only — same `isPlatformOwner` gate as /api/settings/coolify.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export const runtime    = 'nodejs'
export const maxDuration = 15

function isPlatformOwner(userId: string): boolean {
  const raw = process.env.ALLOWED_USER_IDS?.trim()
  if (!raw) return true
  return raw.split(',').map(s => s.trim()).filter(Boolean).includes(userId)
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 5, window: '1 m', prefix: 'health:slack-test' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized', code: 'unauthorized' }, { status: 401 })
  if (!isPlatformOwner(session.userId)) return NextResponse.json({ ok: false, error: 'platform-owner only', code: 'forbidden' }, { status: 403 })

  const url = process.env.NEXUS_SLACK_WEBHOOK_URL?.trim()
  if (!url) {
    return NextResponse.json({
      ok:        true,
      result:    'not_configured',
      message:   'NEXUS_SLACK_WEBHOOK_URL is not set in Doppler. Add it and redeploy Vercel.',
    })
  }

  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        text: `🛠 Nexus Health check — webhook test fired at ${new Date().toISOString()} by ${session.userId.slice(-6)}. If you see this in the channel, the webhook is working.`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = await res.text().catch(() => '')
    return NextResponse.json({
      ok:           true,
      result:       res.ok ? 'success' : 'rejected',
      http_status:  res.status,
      response_body: body.slice(0, 500),
      duration_ms:  Date.now() - t0,
      message: res.ok
        ? 'Slack accepted the webhook (HTTP 200). Check the configured channel — the message should be there. If it isn\'t, the workspace may be filtering or the webhook posts to a different channel.'
        : res.status === 404
          ? 'Slack returned 404 — the webhook was deleted or revoked. Recreate it in Slack: Apps → Incoming Webhooks → Add to Channel, then update Doppler.'
          : res.status === 403
            ? 'Slack returned 403 — the workspace or channel may have been removed. Re-install the app in the new workspace.'
            : `Slack rejected the message with HTTP ${res.status}. Inspect response_body for the underlying error code.`,
    })
  } catch (err) {
    return NextResponse.json({
      ok:          true,
      result:      'network_error',
      duration_ms: Date.now() - t0,
      message: `Network error fetching webhook: ${err instanceof Error ? err.message : String(err)}. Most common: the webhook URL is malformed (no protocol, trailing whitespace) or DNS resolution failed (Cloudflare blocking the Vercel egress).`,
    })
  }
}

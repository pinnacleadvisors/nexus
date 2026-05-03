/**
 * GET/POST /api/cron/webhook-probe
 *
 * Every 6 hours. Probes each active business's Slack webhook URL with a
 * verification message and updates webhook_last_verified_at /
 * webhook_last_error so the /manage-platform Health Panel surfaces dead
 * channels before the next 04:00 UTC operator dispatch silently fails.
 *
 * Self-improvement loop 7.4 in task_plan-ux-security-onboarding.md.
 *
 * Auth: bearer CRON_SECRET OR Clerk owner.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { listActiveBusinesses, recordWebhookVerify } from '@/lib/business/db'
import { postVerification } from '@/lib/slack/client'
import { recordCronRun } from '@/lib/cron/record'

export const runtime = 'nodejs'
export const maxDuration = 60

function isCronAuthed(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`
}

async function probeAll(): Promise<{ probed: number; ok: number; failed: number; skipped: number }> {
  const businesses = await listActiveBusinesses()
  let okCount = 0, failed = 0, skipped = 0
  for (const biz of businesses) {
    if (!biz.slack_webhook_url) { skipped++; continue }
    const result = await postVerification(biz.slack_webhook_url, biz.name)
    await recordWebhookVerify(biz.slug, result)
    if (result.ok) okCount++; else failed++
  }
  return { probed: businesses.length, ok: okCount, failed, skipped }
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthed(req)) {
    const a = await auth()
    if (!a.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const allowed = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (allowed.length > 0 && !allowed.includes(a.userId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }
  try {
    const result = await recordCronRun('webhook-probe', () => probeAll())
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle

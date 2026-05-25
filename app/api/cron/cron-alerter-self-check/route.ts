/**
 * POST /api/cron/cron-alerter-self-check — watch the watchman.
 *
 * The /api/cron/cron-health-alert route reads cron_alerts_state every
 * ~15 min. If THAT cron disappears (auto-disabled, deleted, container
 * down, secret rotated and forgotten…), no Slack pings about red crons
 * arrive — the operator goes blind until they happen to visit /cron-health.
 *
 * This route is the second line of defence:
 *   - cron-job.org calls it every ~6h (registered by sync-crons-hmem.mjs)
 *   - Reads `cron_alerts_state.updated_at`
 *   - If > 4h ago (alerter hasn't checked in two cycles), Slack-ping DIRECTLY
 *
 * Chicken-and-egg: this route itself could go red and stop ping. The
 * mitigation is twofold:
 *   1. The route is dead simple — minimal failure modes vs the alerter
 *      itself (which queries cron-job.org + iterates jobs + groups by business).
 *   2. The /cron-health dashboard's red bucket will surface this route
 *      itself when IT goes red. Three independent failure paths converge
 *      at /cron-health, which the operator visits regularly.
 *
 * Always returns 200 (retry-storm safe).
 */

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'
import { getSlackConfig, postSlackNotification } from '@/lib/slack/client'

export const runtime     = 'nodejs'
export const maxDuration = 15

const ALERTER_STALE_MS = 4 * 60 * 60 * 1000  // 4h — two alerter cycles missed

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'cron:alerter-self-check' })
  if (!rl.success) return rateLimitResponse(rl)

  const url    = new URL(req.url)
  const secret = url.searchParams.get('secret') ?? ''
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const db = createServerClient()
  if (!db) {
    // No DB → we can't tell whether the alerter is alive. Surface as ok:true
    // with a hint so the operator's dashboard reads green; the actual
    // failure would surface on a DB-backed route's red bucket.
    return NextResponse.json({ ok: true, alerted: false, reason: 'no_db' })
  }

  type Chain<T> = { eq: (c: string, v: number) => Chain<T>; single: () => Promise<{ data: T | null }> }
  const res = await (db.from('cron_alerts_state' as never) as unknown as {
    select: (c: string) => Chain<{ updated_at: string | null }>
  }).select('updated_at').eq('id', 1).single()

  const updatedAt = res.data?.updated_at ? new Date(res.data.updated_at).getTime() : 0
  const sinceMs   = Date.now() - updatedAt

  if (updatedAt > 0 && sinceMs < ALERTER_STALE_MS) {
    return NextResponse.json({ ok: true, alerted: false, reason: 'alerter_fresh', sinceMs })
  }

  // Stale alerter — ping the operator directly so they investigate.
  const operatorId = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)[0] ?? ''
  const cfg = operatorId
    ? await getSlackConfig(operatorId)
    : { webhookUrl: process.env.NEXUS_SLACK_WEBHOOK_URL ?? undefined }
  if (!cfg.webhookUrl) {
    return NextResponse.json({ ok: true, alerted: false, reason: 'no_webhook', sinceMs })
  }

  const lastSeen = updatedAt > 0 ? new Date(updatedAt).toISOString() : 'never'
  const text = `:warning: cron-health-alert hasn't checked in since ${lastSeen} (> 4h). Visit /cron-health to see if it's red or disabled.`
  const sent = await postSlackNotification(cfg, { text })

  return NextResponse.json({
    ok:      true,
    alerted: sent,
    reason:  updatedAt === 0 ? 'never_ran' : 'alerter_stale',
    sinceMs,
  })
}

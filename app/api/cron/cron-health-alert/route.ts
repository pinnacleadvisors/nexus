/**
 * POST /api/cron/cron-health-alert — Slack ping when any Nexus cron is red.
 *
 * Triggered every ~15 min by cron-job.org. Reads /api/cron-health/status
 * via internal fetch, computes the red-set, and Slack-pings ONLY when:
 *   1. The red-set's TITLES changed since the previous run, OR
 *   2. It's been ≥ 4h since the previous alert (re-reminder).
 *
 * Dedup state lives in `cron_alerts_state` (migration 066) — a single
 * row holding the last red-titles snapshot + last alert timestamp.
 *
 * Solves the 2026-05-25 post-deploy-smoke incident class: cron-job.org's
 * own "your job has been disabled" email arrives only AFTER ~26 failed
 * runs (~4 days for an every-15-min job). This route pings within 15 min
 * of the first red — operator can re-enable from /cron-health.
 *
 * Auth: ?secret=<CRON_SECRET> (same pattern as the H-Mem crons).
 * Returns 200 + structured payload always (retry-storm safe).
 */

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'
import { getSlackConfig, postSlackNotification } from '@/lib/slack/client'

export const runtime     = 'nodejs'
export const maxDuration = 30

const REMIND_AFTER_MS = 4 * 60 * 60 * 1000   // 4h re-reminder window

interface CronStatus {
  job_id:  number
  title:   string
  enabled: boolean
  health:  'green' | 'yellow' | 'red' | 'unknown'
}

interface AlertState {
  id:              number
  last_red_titles: string[]
  last_alert_at:   string | null
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'cron:cron-health-alert' })
  if (!rl.success) return rateLimitResponse(rl)

  const url    = new URL(req.url)
  const secret = url.searchParams.get('secret') ?? ''
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  // Pull current state from our own dashboard route. The dashboard route
  // is owner-gated, but we authenticate as the service via a bearer that
  // matches our internal admin convention (MEMORY_HQ_TOKEN). When the
  // gate doesn't accept that, fall through to the cron-job.org API
  // directly so this route doesn't depend on the dashboard route's auth.
  const status = await fetchCronStatus(req)
  if (!status.ok) {
    return NextResponse.json({ ok: false, error: status.error, alerted: false }, { status: 200 })
  }

  const redJobs    = status.jobs.filter(j => !j.enabled || j.health === 'red')
  const redTitles  = redJobs.map(j => j.title).sort()

  // Read previous state.
  const db = createServerClient()
  if (!db) {
    // No DB — alert unconditionally if there's red. Dedup degrades gracefully.
    if (redTitles.length === 0) return NextResponse.json({ ok: true, alerted: false, reason: 'no_red' })
    await sendAlert(redJobs)
    return NextResponse.json({ ok: true, alerted: true, reason: 'no_db_fallback', red_count: redTitles.length })
  }

  type Chain<T> = { eq: (c: string, v: number) => Chain<T>; single: () => Promise<{ data: T | null }> }
  const prev = await (db.from('cron_alerts_state' as never) as unknown as { select: (c: string) => Chain<AlertState> })
    .select('id, last_red_titles, last_alert_at').eq('id', 1).single()
  const prevTitles = prev.data?.last_red_titles ?? []
  const prevAlertAt = prev.data?.last_alert_at ? new Date(prev.data.last_alert_at).getTime() : 0

  // Decide whether to alert.
  const titlesChanged = JSON.stringify(prevTitles.sort()) !== JSON.stringify(redTitles)
  const sinceLastAlert = Date.now() - prevAlertAt
  const reminderDue   = redTitles.length > 0 && sinceLastAlert >= REMIND_AFTER_MS

  if (redTitles.length === 0) {
    // Healthy — only update state, no alert.
    await persistState(db, [], prev.data?.last_alert_at ?? null)
    return NextResponse.json({ ok: true, alerted: false, reason: 'no_red' })
  }
  if (!titlesChanged && !reminderDue) {
    // Same red-set as last time and within the 4h window — stay quiet.
    return NextResponse.json({ ok: true, alerted: false, reason: 'dedup', sinceLastAlertMs: sinceLastAlert })
  }

  const sent = await sendAlert(redJobs)
  await persistState(db, redTitles, sent ? new Date().toISOString() : (prev.data?.last_alert_at ?? null))

  return NextResponse.json({
    ok:        true,
    alerted:   sent,
    red_count: redTitles.length,
    reason:    titlesChanged ? 'titles_changed' : 'reminder_due',
  })
}

async function fetchCronStatus(req: NextRequest): Promise<{ ok: true; jobs: CronStatus[] } | { ok: false; error: string }> {
  // The dashboard route is owner-only — to avoid auth headaches, call
  // cron-job.org directly here (same logic as the dashboard route).
  const apiKey = process.env.CRONJOB_ORG_API_KEY
  if (!apiKey) return { ok: false, error: 'CRONJOB_ORG_API_KEY not set' }
  try {
    const res = await fetch('https://api.cron-job.org/jobs', {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { ok: false, error: `cron-job.org ${res.status}` }
    const data = await res.json() as { jobs?: Array<{ jobId: number; title: string; enabled: boolean; lastStatus?: number }> }
    const jobs: CronStatus[] = (data.jobs ?? [])
      .filter(j => typeof j.title === 'string' && j.title.startsWith('Nexus:'))
      .map(j => {
        const ls = j.lastStatus ?? 0
        let health: 'green' | 'yellow' | 'red' | 'unknown' = 'unknown'
        if (!j.enabled) health = 'red'
        else if (ls === 0) health = 'unknown'
        else if (ls >= 500) health = 'red'
        else if (ls >= 400) health = 'yellow'
        else health = 'green'
        return { job_id: j.jobId, title: j.title, enabled: j.enabled, health }
      })
    return { ok: true, jobs }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'cron-job.org call failed' }
  }
}

async function sendAlert(redJobs: CronStatus[]): Promise<boolean> {
  // v8: per-user Slack via getSlackConfig — picks up the operator's
  // user_secrets webhookUrl + channel override first, falls back to
  // NEXUS_SLACK_WEBHOOK_URL. The CRON_SECRET-gated route runs without
  // a Clerk session, so use the FIRST entry from ALLOWED_USER_IDS as
  // the "operator" identity (mirrors /api/webhooks/slack's fallback).
  const operatorId = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)[0] ?? ''
  const cfg = operatorId
    ? await getSlackConfig(operatorId)
    : { webhookUrl: process.env.NEXUS_SLACK_WEBHOOK_URL ?? undefined }
  if (!cfg.webhookUrl) return false
  const lines = redJobs.map(j => `• ${j.enabled ? 'red' : 'DISABLED'}: ${j.title.replace(/^Nexus:\s*/, '')}`).join('\n')
  const text  = `:rotating_light: ${redJobs.length} Nexus cron(s) need attention:\n${lines}\nRe-enable / debug at /cron-health.`
  return await postSlackNotification(cfg, { text })
}

async function persistState(db: ReturnType<typeof createServerClient>, redTitles: string[], lastAlertAt: string | null): Promise<void> {
  if (!db) return
  await (db.from('cron_alerts_state' as never) as unknown as {
    update: (u: Record<string, unknown>) => { eq: (c: string, v: number) => Promise<{ error?: unknown }> }
  }).update({ last_red_titles: redTitles, last_alert_at: lastAlertAt, updated_at: new Date().toISOString() })
   .eq('id', 1)
}

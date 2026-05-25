/**
 * GET /api/cron-health/status — operator dashboard data for cron-job.org.
 *
 * Calls cron-job.org's REST API to list every "Nexus: " job + its last
 * status / next run, then returns a normalised payload the /cron-health
 * page renders. Solves the "26 failed runs before disable email" problem
 * by surfacing failures in our own UI well before the auto-disable.
 *
 * Owner-only — uses ALLOWED_USER_IDS gate (mirrors /api/admin/*).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export const runtime     = 'nodejs'
export const maxDuration = 15

interface CronJobOrgJob {
  jobId:         number
  enabled:       boolean
  title:         string
  url:           string
  lastStatus?:   number      // HTTP status of last run; 0 = never run
  lastDuration?: number
  lastExecution?: number     // unix seconds
  nextExecution?: number
  saveResponses?: boolean
}

interface CronStatus {
  job_id:           number
  title:            string
  enabled:          boolean
  /** v9 — current URL on cron-job.org, surfaced so the operator can edit
   *  it inline from /cron-health without running the sync script. Secret
   *  query param IS included; the dashboard renders it scrubbed. */
  url:              string
  last_status:      number
  last_status_text: 'ok' | 'fail' | 'never_run'
  last_execution:   string | null     // ISO
  next_execution:   string | null
  health:           'green' | 'yellow' | 'red' | 'unknown'
}

function isOwner(userId: string | null | undefined): boolean {
  if (!userId) return false
  const raw = process.env.ALLOWED_USER_IDS?.trim()
  if (!raw) return true
  return raw.split(',').map(s => s.trim()).filter(Boolean).includes(userId)
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'cron-health:status' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!isOwner(session.userId)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const apiKey = process.env.CRONJOB_ORG_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      ok:     false,
      error:  'CRONJOB_ORG_API_KEY not configured — cron health dashboard requires it.',
    }, { status: 200 })
  }

  try {
    const res = await fetch('https://api.cron-job.org/jobs', {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `cron-job.org returned ${res.status}` }, { status: 200 })
    }
    const data = await res.json() as { jobs?: CronJobOrgJob[] }
    const nexusJobs = (data.jobs ?? []).filter(j => typeof j.title === 'string' && j.title.startsWith('Nexus:'))
    const status: CronStatus[] = nexusJobs.map(j => normalise(j))
    // Sort: disabled first, then red/yellow/unknown, then green.
    status.sort((a, b) => orderKey(a) - orderKey(b))
    return NextResponse.json({ ok: true, jobs: status, total: status.length })
  } catch (e) {
    return NextResponse.json({
      ok:    false,
      error: e instanceof Error ? e.message : 'cron-job.org call failed',
    }, { status: 200 })
  }
}

function normalise(j: CronJobOrgJob): CronStatus {
  const lastStatus = j.lastStatus ?? 0
  const lastStatusText: 'ok' | 'fail' | 'never_run' =
    lastStatus === 0 ? 'never_run' : (lastStatus >= 200 && lastStatus < 400 ? 'ok' : 'fail')

  // Health bucket logic:
  //   red    — disabled OR last run was 5xx
  //   yellow — last run was 4xx (route returns ok:false with status — caller decided)
  //   green  — last run 200–399
  //   unknown — never run yet
  let health: 'green' | 'yellow' | 'red' | 'unknown' = 'unknown'
  if (!j.enabled) health = 'red'
  else if (lastStatus === 0) health = 'unknown'
  else if (lastStatus >= 500) health = 'red'
  else if (lastStatus >= 400) health = 'yellow'
  else health = 'green'

  return {
    job_id:           j.jobId,
    title:            j.title,
    enabled:          j.enabled,
    url:              j.url ?? '',
    last_status:      lastStatus,
    last_status_text: lastStatusText,
    last_execution:   j.lastExecution ? new Date(j.lastExecution * 1000).toISOString() : null,
    next_execution:   j.nextExecution ? new Date(j.nextExecution * 1000).toISOString() : null,
    health,
  }
}

function orderKey(s: CronStatus): number {
  if (!s.enabled)        return 0  // disabled first
  if (s.health === 'red')    return 1
  if (s.health === 'yellow') return 2
  if (s.health === 'unknown') return 3
  return 4
}

/**
 * GET /api/health/cron
 *
 * Owner-only snapshot of every configured Vercel cron job — its schedule,
 * last invocation time, last HTTP status, and a green/amber/red verdict.
 *
 * Source of truth for the cron list is `vercel.json`; we mirror it here so
 * the endpoint is deterministic without parsing JSON at runtime. When a new
 * cron is added to `vercel.json`, append it to `CRONS` below as well.
 *
 * Last-run data comes from the `log_events` mirror that the Vercel log-drain
 * fills (see migration 022). Each cron path appears as a row whenever Vercel
 * invokes it. We query the most recent row per route — `status >= 500` is
 * "red", `status >= 400` is "amber", `status < 400` (or null with a fresh
 * timestamp) is "green". A missing entry within 2× the schedule period is
 * "amber"; older than 4× is "red".
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

interface CronSpec {
  path:           string
  schedule:       string  // 5-field cron expression
  description:    string
  expectedAfterMs: number  // 2× the period — amber threshold
  redAfterMs:     number   // 4× the period — red threshold
}

// Mirrors vercel.json. Keep in sync.
const CRONS: CronSpec[] = [
  {
    path:           '/api/cron/signal-review',
    schedule:       '0 8 * * *',
    description:    'LLM council reviews accepted signals',
    expectedAfterMs: 48 * 60 * 60_000,
    redAfterMs:     96 * 60 * 60_000,
  },
  {
    path:           '/api/cron/rebuild-graph-hq',
    schedule:       '0 */6 * * *',
    description:    'Rebuild memory-hq graph + indexes',
    expectedAfterMs: 12 * 60 * 60_000,
    redAfterMs:     24 * 60 * 60_000,
  },
  {
    path:           '/api/cron/sync-memory',
    schedule:       '0 4 * * *',
    description:    'Reconcile mol_* mirror from memory-hq tree',
    expectedAfterMs: 48 * 60 * 60_000,
    redAfterMs:     96 * 60 * 60_000,
  },
  {
    path:           '/api/cron/post-deploy-smoke',
    schedule:       '*/30 * * * *',
    description:    'Smoke-test critical routes after each deploy window',
    expectedAfterMs: 60 * 60_000,
    redAfterMs:     2 * 60 * 60_000,
  },
  {
    path:           '/api/cron/sync-learning-cards',
    schedule:       '0 5 * * *',
    description:    'Materialise flashcards from molecular memory atoms',
    expectedAfterMs: 48 * 60 * 60_000,
    redAfterMs:     96 * 60 * 60_000,
  },
  {
    path:           '/api/cron/sweep-orphan-cards',
    schedule:       '30 4 * * *',
    description:    'Delete Kanban cards whose parent idea/run was deleted',
    expectedAfterMs: 48 * 60 * 60_000,
    redAfterMs:     96 * 60 * 60_000,
  },
]

interface CronStatus {
  path:           string
  schedule:       string
  description:    string
  lastRunAt:      string | null
  lastStatus:     number | null
  ageMinutes:     number | null
  verdict:        'green' | 'amber' | 'red' | 'unknown'
  detail:         string
}

async function authorize(): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const a = await auth()
  if (!a.userId) return { ok: false, status: 401, error: 'unauthorized' }
  const allowed = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (allowed.length > 0 && !allowed.includes(a.userId)) {
    return { ok: false, status: 403, error: 'forbidden' }
  }
  return { ok: true }
}

async function statusForCron(spec: CronSpec, db: ReturnType<typeof createServerClient>): Promise<CronStatus> {
  // Strip any querystring on the route — log_events stores the path component.
  const routePath = spec.path.split('?')[0]
  let row: { created_at: string; status: number | null } | null = null
  if (db) {
    const res = await (db as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            order: (col: string, opts: { ascending: boolean }) => {
              limit: (n: number) => {
                maybeSingle: () => Promise<{ data: { created_at: string; status: number | null } | null }>
              }
            }
          }
        }
      }
    }).from('log_events')
      .select('created_at,status')
      .eq('route', routePath)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    row = res.data
  }

  if (!row) {
    return {
      path:        spec.path,
      schedule:    spec.schedule,
      description: spec.description,
      lastRunAt:   null,
      lastStatus:  null,
      ageMinutes:  null,
      verdict:     'unknown',
      detail:      'No log_events row yet — either log drain is not wired or the cron has never run.',
    }
  }

  const ageMs      = Date.now() - new Date(row.created_at).getTime()
  const ageMinutes = Math.round(ageMs / 60_000)

  let verdict: CronStatus['verdict'] = 'green'
  let detail   = `Last run ${ageMinutes}m ago${row.status ? ` (HTTP ${row.status})` : ''}`

  if (row.status && row.status >= 500) {
    verdict = 'red'
    detail  = `Last run ${ageMinutes}m ago returned ${row.status} — investigate logs`
  } else if (row.status && row.status >= 400) {
    verdict = 'amber'
    detail  = `Last run ${ageMinutes}m ago returned ${row.status}`
  } else if (ageMs > spec.redAfterMs) {
    verdict = 'red'
    detail  = `No invocation in the last ${Math.round(ageMs / 60 / 60_000)}h — cron may be disabled`
  } else if (ageMs > spec.expectedAfterMs) {
    verdict = 'amber'
    detail  = `Last run was ${Math.round(ageMs / 60 / 60_000)}h ago — overdue`
  }

  return {
    path:        spec.path,
    schedule:    spec.schedule,
    description: spec.description,
    lastRunAt:   row.created_at,
    lastStatus:  row.status,
    ageMinutes,
    verdict,
    detail,
  }
}

export async function GET() {
  const authz = await authorize()
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status })

  const db = createServerClient()
  const jobs: CronStatus[] = []
  for (const spec of CRONS) {
    jobs.push(await statusForCron(spec, db))
  }

  const summary = {
    green:   jobs.filter(j => j.verdict === 'green').length,
    amber:   jobs.filter(j => j.verdict === 'amber').length,
    red:     jobs.filter(j => j.verdict === 'red').length,
    unknown: jobs.filter(j => j.verdict === 'unknown').length,
  }

  return NextResponse.json({ ok: true, summary, jobs })
}

export async function POST(_req: NextRequest) {
  return GET()
}

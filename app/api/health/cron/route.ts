/**
 * GET /api/health/cron
 *
 * Returns the latest run state for every known Vercel cron, drawn from the
 * log_events rows written by `lib/cron/record.ts::recordCronRun`. The
 * `/manage-platform` health panel polls this every 30 s.
 *
 * Auth: Clerk owner session (ALLOWED_USER_IDS allowlist) OR bot bearer.
 *
 * Response shape:
 *   { jobs: [{ name, route, lastRunAt, lastStatus, lastError, ageMinutes,
 *              expectedWindowMin, isStale, isFailing }] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { resolveCallerUserId } from '@/lib/auth/bot'
import { createServerClient } from '@/lib/supabase'
import { KNOWN_CRONS } from '@/lib/cron/record'

export const runtime = 'nodejs'

interface CronJobStatus {
  name:              string
  route:             string
  lastRunAt:         string | null
  lastStatus:        number | null
  lastLevel:         string | null
  lastDurationMs:    number | null
  lastMessagePreview: string | null
  ageMinutes:        number | null
  expectedWindowMin: number
  isStale:           boolean
  isFailing:         boolean
}

export async function GET(req: NextRequest) {
  const a = await auth()
  const userId = resolveCallerUserId(req, a.userId)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const allowed = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (allowed.length > 0 && !allowed.includes(userId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const sb = createServerClient()
  if (!sb) {
    return NextResponse.json({ jobs: [], reason: 'supabase_unconfigured' })
  }

  const now = Date.now()
  const jobs: CronJobStatus[] = []

  for (const cron of KNOWN_CRONS) {
    const route = `/api/cron/${cron.name}`
    // Newest row, regardless of status, so we can surface failure too.
    const resp = await (sb as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (c: string, v: string) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: Array<{
                created_at: string; level: string; status: number | null
                duration_ms: number | null; message: string | null
              }> | null }>
            }
          }
        }
      }
    }).from('log_events')
      .select('created_at, level, status, duration_ms, message')
      .eq('route', route)
      .order('created_at', { ascending: false })
      .limit(1)

    const last = (resp.data ?? [])[0] ?? null
    const lastRunAt = last?.created_at ?? null
    const ageMinutes = lastRunAt
      ? Math.floor((now - new Date(lastRunAt).getTime()) / 60_000)
      : null

    const isStale = lastRunAt === null
      ? true
      : (ageMinutes ?? 0) > cron.expectedWindowMin
    const isFailing = last?.level === 'error'

    jobs.push({
      name:              cron.name,
      route,
      lastRunAt,
      lastStatus:        last?.status ?? null,
      lastLevel:         last?.level ?? null,
      lastDurationMs:    last?.duration_ms ?? null,
      lastMessagePreview: last?.message ? last.message.slice(0, 200) : null,
      ageMinutes,
      expectedWindowMin: cron.expectedWindowMin,
      isStale,
      isFailing,
    })
  }

  return NextResponse.json({ jobs, generatedAt: new Date().toISOString() })
}

/**
 * GET /api/views/calendar?scope=<scope>
 *
 * Returns the next ~20 upcoming events for the scope: tasks with a due_at,
 * future scheduled run_events (when present), plus the next firing of any
 * static cron the operator should know about. Used by the Calendar panel
 * in the Views dropdown.
 *
 * Sources merged:
 *   1. operator_tasks WHERE due_at >= now()           (Manual to-dos)
 *   2. run_events WHERE status='scheduled' AND ...    (operator runs)
 *   3. A small built-in "system crons" snapshot       (idle scale-down,
 *      digest, rebuild-graph) — not persisted; lets the operator see
 *      the rhythm of the platform.
 *
 * MVP — keeps logic simple. Pagination / filters left for later if the
 * panel ever grows beyond a single scroll.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'
import { isBusinessSlug } from '@/lib/claw/business-client'

export const runtime    = 'nodejs'
export const maxDuration = 10

function validScope(s: string | null): s is string {
  if (!s) return false
  if (s === 'admin') return true
  if (s.startsWith('business:')) return isBusinessSlug(s.slice('business:'.length))
  return false
}

interface TaskRow      { id: string; title: string; due_at: string; done: boolean }
interface RunEventRow  { id: string; business_slug: string | null; phase: string | null; status: string; created_at: string }

interface Chain<T> {
  eq:    (c: string, v: unknown) => Chain<T>
  in:    (c: string, v: string[]) => Chain<T>
  is:    (c: string, v: unknown) => Chain<T>
  gte:   (c: string, v: unknown) => Chain<T>
  order: (c: string, opts: { ascending: boolean }) => Chain<T>
  limit: (n: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
}

export interface CalendarEntry {
  id:      string
  kind:    'task' | 'run' | 'cron'
  title:   string
  at:      string          // ISO 8601
  detail?: string
  href?:   string          // optional click-through
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'views:calendar' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const scope = new URL(req.url).searchParams.get('scope')
  if (!validScope(scope)) return NextResponse.json({ ok: false, error: 'invalid scope' }, { status: 400 })

  const db = createServerClient()
  const entries: CalendarEntry[] = []
  const nowIso = new Date().toISOString()

  if (db) {
    // 1) Tasks with a due_at in the future
    const tasksRes = await (db.from('operator_tasks' as never) as unknown as { select: (c: string) => Chain<TaskRow> })
      .select('id, title, due_at, done')
      .eq('user_id', session.userId)
      .eq('scope', scope)
      .eq('done', false)
      .gte('due_at', nowIso)
      .order('due_at', { ascending: true })
      .limit(20)
    for (const t of tasksRes.data ?? []) {
      entries.push({
        id:    `task-${t.id}`,
        kind:  'task',
        title: t.title,
        at:    t.due_at,
      })
    }

    // 2) Recent run_events — these aren't strictly upcoming, but the
    //    operator wants to see the cadence. Filter to last 24h forward
    //    when status='scheduled'; otherwise show "last fired N min ago".
    const runScope = scope === 'admin' ? null : scope.slice('business:'.length)
    let runsQ = (db.from('run_events' as never) as unknown as { select: (c: string) => Chain<RunEventRow> })
      .select('id, business_slug, phase, status, created_at')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString())
    runsQ = runScope === null ? runsQ.is('business_slug', null) : runsQ.eq('business_slug', runScope)
    const runsRes = await runsQ.order('created_at', { ascending: false }).limit(10)
    for (const r of runsRes.data ?? []) {
      entries.push({
        id:    `run-${r.id}`,
        kind:  'run',
        title: `${r.phase ?? 'run'} (${r.status})`,
        at:    r.created_at,
        detail: r.business_slug ?? 'platform',
      })
    }
  }

  // 3) Static system crons — give the operator the next firing of each.
  // These run regardless of scope, but we tag them so the user sees them
  // as a "platform rhythm" rather than per-business.
  if (scope === 'admin') {
    const inMins = (n: number) => new Date(Date.now() + n * 60_000).toISOString()
    entries.push(
      { id: 'cron-scale-down', kind: 'cron', title: 'Idle container scale-down', at: inMins(30), detail: 'every 30 min' },
      { id: 'cron-digest',     kind: 'cron', title: 'Daily ops digest',         at: inMins(60 * 6), detail: 'every 6h' },
      { id: 'cron-graph',      kind: 'cron', title: 'Memory graph rebuild',    at: inMins(60 * 6), detail: 'every 6h' },
    )
  }

  entries.sort((a, b) => a.at.localeCompare(b.at))
  return NextResponse.json({ ok: true, entries: entries.slice(0, 20) })
}

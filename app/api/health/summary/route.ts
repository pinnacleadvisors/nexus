/**
 * GET /api/health/summary
 *
 * Failure-visibility surface for the Health view (PR #192). Aggregates:
 *   1. Recent run_events with payload.status='error' (last 24h, top 25)
 *      grouped by payload.phase so the operator sees WHERE failures cluster.
 *   2. Cron-route activity from runs.cursor.cron_route (last-success +
 *      last-error timestamps per route).
 *   3. Slack delivery config presence (webhook URL set? signing secret set?).
 *      Real webhook test is gated to POST /api/health/slack-test so a
 *      polling GET doesn't spam Slack.
 *   4. Experiment_metrics rows of kind 'kill_switch_check', 'gate_*' from
 *      the last 24h — surfaces cost-guard kills + approval-gate denials.
 *
 * Scope: when query string has ?business=<slug>, results are filtered to
 * that business's run_events / experiments. Default = admin-wide.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'

export const runtime    = 'nodejs'
export const maxDuration = 15

interface RunEventRow {
  id:         string
  run_id:     string
  kind:       string
  payload:    Record<string, unknown>
  created_at: string
}

interface RunRow {
  id:         string
  user_id:    string
  phase:      string
  status:     string
  cursor:     Record<string, unknown>
  updated_at: string
}

interface MetricRow {
  id:           string
  kind:         string
  business_slug: string | null
  numeric_value: number | null
  string_value:  string | null
  metadata:      Record<string, unknown>
  created_at:   string
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'health:summary' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized', code: 'unauthorized' }, { status: 401 })
  const userId = session.userId

  const url = new URL(req.url)
  const businessSlug = url.searchParams.get('business')?.trim() || null

  const db = createServerClient()
  const since24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString()

  // Slack config — env vars only. Don't fire a webhook here; that's the
  // explicit POST endpoint's job. We just say "the URL is present" / not.
  const slack = {
    webhookConfigured: !!process.env.NEXUS_SLACK_WEBHOOK_URL,
    signingConfigured: !!process.env.NEXUS_SLACK_SIGNING_SECRET,
  }

  let recentEvents:  Array<RunEventRow & { run?: RunRow }> = []
  const errorsByPhase: Record<string, { count: number; latest: string; latestMessage: string | null }> = {}
  let cronStatus:    Array<{ route: string; last_run?: string; last_error?: string; last_error_message?: string }> = []
  let costGuard:     MetricRow[] = []

  if (db) {
    try {
      // 1. Recent error events. payload.status='error' is the convention used
      //    across the codebase (cron handlers, dispatch helpers, n8n bridge).
      //    We filter to runs the user owns by joining on runs.user_id.
      type Chain<T> = {
        eq:    (c: string, v: unknown) => Chain<T>
        gte:   (c: string, v: unknown) => Chain<T>
        order: (c: string, o: { ascending: boolean }) => Chain<T>
        limit: (n: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
      }
      type RawJoined = RunEventRow & { runs?: { user_id: string; phase: string; status: string; cursor: Record<string, unknown>; updated_at: string } }
      const eventsQ = (db.from('run_events' as never) as unknown as { select: (c: string) => Chain<RawJoined> })
        .select('id, run_id, kind, payload, created_at, runs!inner(user_id, phase, status, cursor, updated_at)')
        .eq('runs.user_id', userId)
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(50)
      const eventsR = await eventsQ
      const allRows = (eventsR.data ?? []) as RawJoined[]

      // 2. Filter to error events client-side (PostgREST JSON-key filtering
      //    on jsonb columns is awkward; the result set is small enough to
      //    post-process). Group by phase for the heatmap.
      for (const row of allRows) {
        const status = row.payload?.status as string | undefined
        const phase  = (row.payload?.phase as string | undefined) ?? row.kind
        const message = row.payload?.message as string | undefined
        if (status === 'error' || row.kind.endsWith('.failed') || row.kind === 'error') {
          if (businessSlug && row.payload?.business_slug !== businessSlug) continue
          if (!errorsByPhase[phase]) errorsByPhase[phase] = { count: 0, latest: row.created_at, latestMessage: message ?? null }
          errorsByPhase[phase].count += 1
        }
      }

      // 3. Recent events list — return top 25 errors with the joined run data
      //    so the UI can click through. Business-scoped when ?business=<slug>.
      recentEvents = allRows
        .filter(row => {
          const status = row.payload?.status as string | undefined
          const isError = status === 'error' || row.kind.endsWith('.failed') || row.kind === 'error'
          if (!isError) return false
          if (businessSlug && row.payload?.business_slug !== businessSlug) return false
          return true
        })
        .slice(0, 25)
        .map(row => ({
          id:         row.id,
          run_id:     row.run_id,
          kind:       row.kind,
          payload:    row.payload,
          created_at: row.created_at,
          run:        row.runs ? { id: row.run_id, user_id: row.runs.user_id, phase: row.runs.phase, status: row.runs.status, cursor: row.runs.cursor, updated_at: row.runs.updated_at } : undefined,
        }))

      // 4. Cron routes — derived from run_events where kind starts with 'cron.'
      //    or where payload.source is a cron route. We aggregate last
      //    success + last error per route.
      const cronMap = new Map<string, { last_run?: string; last_error?: string; last_error_message?: string }>()
      for (const row of allRows) {
        const source = (row.payload?.source as string | undefined) ?? ''
        const route  = source.startsWith('/api/cron/') ? source : null
        if (!route) continue
        const slot = cronMap.get(route) ?? {}
        const status = row.payload?.status as string | undefined
        if (status === 'error' || row.kind.endsWith('.failed')) {
          if (!slot.last_error || slot.last_error < row.created_at) {
            slot.last_error = row.created_at
            slot.last_error_message = (row.payload?.message as string | undefined) ?? undefined
          }
        } else {
          if (!slot.last_run || slot.last_run < row.created_at) slot.last_run = row.created_at
        }
        cronMap.set(route, slot)
      }
      cronStatus = [...cronMap.entries()].map(([route, v]) => ({ route, ...v }))

      // 5. Cost-guard / kill-switch / gate signals — drawn from experiment_metrics.
      type MetricChain<T> = Chain<T>
      const metricsQ = (db.from('experiment_metrics' as never) as unknown as { select: (c: string) => MetricChain<MetricRow> })
        .select('id, kind, business_slug, numeric_value, string_value, metadata, created_at')
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(50)
      const metricsR = await metricsQ
      const allMetrics = (metricsR.data ?? []) as MetricRow[]
      costGuard = allMetrics
        .filter(m => m.kind === 'kill_switch_check' || m.kind.startsWith('gate_') || m.kind === 'cost_guard_tripped')
        .filter(m => !businessSlug || m.business_slug === businessSlug)
        .slice(0, 20)
    } catch (e) {
      // Don't fail the whole response — partial data is still useful for
      // the operator. The UI surfaces the empty list as "no recent errors".
      // eslint-disable-next-line no-console
      console.error('[health/summary]', e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({
    ok: true,
    scope: businessSlug ? `business:${businessSlug}` : 'admin',
    slack,
    errors_by_phase: errorsByPhase,
    recent_events:   recentEvents,
    cron_status:     cronStatus,
    cost_guard:      costGuard,
    fetched_at:      new Date().toISOString(),
  })
}

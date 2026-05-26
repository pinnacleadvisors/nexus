/**
 * lib/approvals/system-alerts.ts — three additional sources feeding the
 * /inbox + /dashboard aggregator (PR #370).
 *
 *   1. cron-alert         — recently red crons (from cron_alerts_state)
 *   2. stalled-run        — long-running rows in `runs` / `simulation_runs`
 *   3. budget-incident    — recent kill_switch_check rows where kill=true
 *
 * Each loader is independent and fail-soft — a transient DB error returns
 * `[]` and logs a warn so the inbox still loads.
 *
 * Output shape mirrors the existing FleetPendingItem so the inbox UI can
 * render alongside chat-emitted + operator-task rows. The `approval`
 * field is a synthesised, action-less stub (items=[]) — the UI uses
 * `kind` to render system alerts as info banners rather than approval
 * cards.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApprovalRequest } from '@/lib/chat/approval'
import type { FleetPendingItem } from './fleet'

// Re-exported from fleet.ts ApprovalKind union — but extending it there
// would couple two files. Instead, we pass kind strings directly; the
// existing union is widened in fleet.ts.

const STALLED_RUN_HOURS  = 4
const BUDGET_INCIDENT_DAYS = 7

function synth(title: string, id: string): ApprovalRequest {
  return { title, approval_id: id, items: [] }
}

// ── 1. Cron alerts ──────────────────────────────────────────────────────────

interface CronAlertsStateRow {
  last_red_titles: string[]
  last_alert_at:   string | null
  updated_at:      string
}

export async function loadCronAlerts(db: SupabaseClient): Promise<FleetPendingItem[]> {
  try {
    const res = await (db.from('cron_alerts_state' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: number) => { maybeSingle: () => Promise<{ data: CronAlertsStateRow | null }> } }
    }).select('last_red_titles, last_alert_at, updated_at').eq('id', 1).maybeSingle()
    const row = res.data
    if (!row || !row.last_red_titles || row.last_red_titles.length === 0) return []

    return row.last_red_titles.map((title, i) => ({
      scope:         'admin',
      scope_label:   'Platform',
      kind:          'cron-alert' as const,
      session_id:    `cron:${title}`,
      session_title: `Cron failing: ${title}`,
      message_id:    `cron-${i}:${row.updated_at}`,
      created_at:    row.last_alert_at ?? row.updated_at,
      approval:      synth(`Cron failing: ${title}`, `cron-alert:${title}`),
    }))
  } catch (err) {
    console.warn('[system-alerts] cron_alerts_state read failed:', err instanceof Error ? err.message : err)
    return []
  }
}

// ── 2. Stalled runs ─────────────────────────────────────────────────────────

interface SimRunStalledRow {
  id:            string
  business_slug: string
  mode:          string
  started_at:    string
}

interface RunStalledRow {
  id:           string
  business_id:  string | null
  title:        string | null
  created_at:   string
  status:       string
}

export async function loadStalledRuns(db: SupabaseClient, userId: string): Promise<FleetPendingItem[]> {
  const cutoff = new Date(Date.now() - STALLED_RUN_HOURS * 60 * 60 * 1000).toISOString()
  const items:  FleetPendingItem[] = []

  // Simulation runs stalled in running/paused for > STALLED_RUN_HOURS
  try {
    const res = await (db.from('simulation_runs' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { in: (c: string, vs: string[]) => { lt: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: SimRunStalledRow[] | null }> } } } } }
    }).select('id, business_slug, mode, started_at')
      .eq('user_id', userId)
      .in('status', ['running', 'paused'])
      .lt('started_at', cutoff)
      .order('started_at', { ascending: true })
      .limit(20)
    for (const r of res.data ?? []) {
      items.push({
        scope:         `business:${r.business_slug}`,
        scope_label:   r.business_slug,
        kind:          'stalled-run' as const,
        session_id:    `sim-run:${r.id}`,
        session_title: `Stalled sim run (${r.mode}, ${STALLED_RUN_HOURS}h+)`,
        message_id:    `stalled-sim:${r.id}`,
        created_at:    r.started_at,
        approval:      synth(`Stalled simulation: ${r.business_slug}`, `stalled-sim:${r.id}`),
      })
    }
  } catch (err) {
    console.warn('[system-alerts] simulation_runs stalled query failed:', err instanceof Error ? err.message : err)
  }

  // Legacy `runs` table — same idea
  try {
    const res = await (db.from('runs' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { lt: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: RunStalledRow[] | null }> } } } } }
    }).select('id, business_id, title, created_at, status')
      .eq('user_id', userId)
      .eq('status', 'running')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(20)
    for (const r of res.data ?? []) {
      items.push({
        scope:         r.business_id ? `business:${r.business_id}` : 'admin',
        scope_label:   r.business_id ?? 'Platform',
        kind:          'stalled-run' as const,
        session_id:    `run:${r.id}`,
        session_title: r.title ?? `Stalled run (${STALLED_RUN_HOURS}h+)`,
        message_id:    `stalled-run:${r.id}`,
        created_at:    r.created_at,
        approval:      synth(r.title ?? `Stalled run`, `stalled-run:${r.id}`),
      })
    }
  } catch (err) {
    // The legacy `runs` table may not exist on every deploy — silent.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[system-alerts] runs table not queryable:', err instanceof Error ? err.message : err)
    }
  }

  return items
}

// ── 3. Budget incidents ─────────────────────────────────────────────────────

interface ExperimentMetricsKillRow {
  id:              string
  business_slug:   string | null
  payload:         { usd?: number; cap_usd?: number; source?: string; reason?: string; kill?: boolean } | null
  created_at:      string
}

export async function loadBudgetIncidents(db: SupabaseClient, userId: string): Promise<FleetPendingItem[]> {
  const cutoff = new Date(Date.now() - BUDGET_INCIDENT_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // experiment_metrics has user_id only on some rows (per-business records);
  // some platform-wide kills are not user-scoped. We filter to rows where
  // user_id matches OR business_slug owned by this user. To keep this
  // self-contained, pull all kill_switch_check rows in the window and let
  // the caller filter — but constrain by user_id (and add fallback below).
  try {
    const res = await (db.from('experiment_metrics' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { gte: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: ExperimentMetricsKillRow[] | null }> } } } } }
    }).select('id, business_slug, payload, created_at')
      .eq('user_id', userId)
      .eq('kind', 'kill_switch_check')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(20)
    const rows = (res.data ?? []).filter(r => Boolean(r.payload?.kill))

    return rows.map(r => ({
      scope:         r.business_slug ? `business:${r.business_slug}` : 'admin',
      scope_label:   r.business_slug ?? 'Platform',
      kind:          'budget-incident' as const,
      session_id:    `budget:${r.id}`,
      session_title: `Budget kill: ${r.payload?.reason ?? 'cap exceeded'} ($${(r.payload?.usd ?? 0).toFixed(2)}/$${(r.payload?.cap_usd ?? 0).toFixed(2)})`,
      message_id:    `budget-incident:${r.id}`,
      created_at:    r.created_at,
      approval:      synth(`Budget kill on ${r.business_slug ?? 'platform'}`, `budget-incident:${r.id}`),
    }))
  } catch (err) {
    console.warn('[system-alerts] experiment_metrics kill query failed:', err instanceof Error ? err.message : err)
    return []
  }
}

// ── Aggregator helper ───────────────────────────────────────────────────────

export async function loadAllSystemAlerts(db: SupabaseClient, userId: string): Promise<FleetPendingItem[]> {
  const [crons, stalled, budget] = await Promise.all([
    loadCronAlerts(db),
    loadStalledRuns(db, userId),
    loadBudgetIncidents(db, userId),
  ])
  return [...crons, ...stalled, ...budget]
}

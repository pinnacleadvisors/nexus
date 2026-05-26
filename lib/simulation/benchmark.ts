/**
 * lib/simulation/benchmark.ts — drift-alarm runner (v2-D, PR #368).
 *
 * Daily cron (app/api/cron/simulation-benchmark) calls runBenchmarks()
 * which:
 *   1. Pulls every enabled simulation_benchmarks row.
 *   2. For each: creates a sim run with the row's FIXED seed + policy.
 *   3. Drains the run to completion (auto-mode + uses the engine's
 *      runToCompletion in a loop until done, bounded by 5min wallclock).
 *   4. Grades the result.
 *   5. First run for a benchmark → store as baseline.
 *   6. Subsequent runs → diff against baseline; if |drift| >
 *      drift_threshold_pct, post a Slack alert (rate-limited via
 *      last_alert_at to avoid spam on sustained drift).
 *
 * If there are zero benchmarks at cron time, self-bootstraps a default
 * one targeting the canonical SIMULATION_BENCHMARK_BUSINESS_SLUG (env)
 * or 'sim-saas-01' (fallback). The first run becomes the baseline.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { startRun, runToCompletion } from './engine'
import { postSlackNotification, getSlackConfig } from '@/lib/slack/client'

const BENCHMARK_WALLCLOCK_BUDGET_MS = 5 * 60 * 1000          // 5 min total per benchmark
const BENCHMARK_OWNER_USER_ID       = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)[0] ?? ''
const ALERT_COOLDOWN_MS             = 12 * 60 * 60 * 1000    // 12 h between repeat alerts on sustained drift

export interface BenchmarkRow {
  id:                   string
  name:                 string
  business_slug:        string
  seed:                 string
  compress_days:        number
  wallclock_budget_sec: number
  approver_policy:      'permissive' | 'skeptical' | 'random'
  synthetic_voice:      'template' | 'llm'
  drift_threshold_pct:  number
  baseline_result:      Record<string, unknown> | null
  baseline_run_id:      string | null
  last_alert_at:        string | null
}

export interface BenchmarkRunSummary {
  name:        string
  status:      'done' | 'failed' | 'skipped'
  run_id?:     string
  drift_pct?:  number
  alerted?:    boolean
  bootstrapped?: boolean
  error?:      string
}

export interface RunBenchmarksResult {
  ok:        boolean
  results:   BenchmarkRunSummary[]
}

// ── helpers ──────────────────────────────────────────────────────────────────

function getMetric(result: unknown, key: string): number {
  if (typeof result !== 'object' || result === null) return 0
  const v = (result as Record<string, number | undefined>)[key]
  return typeof v === 'number' ? v : 0
}

function driftPct(baseline: number, current: number): number {
  if (baseline === 0) return current === 0 ? 0 : 100
  return ((current - baseline) / Math.abs(baseline)) * 100
}

function combinedDriftPct(baseline: unknown, current: unknown): number {
  // Weighted: sim_net_cents 60% (primary), failures 25%, approvals_total 15%.
  // Returns the WORST single-axis drift so any one regression triggers.
  const netD       = driftPct(getMetric(baseline, 'sim_net_cents'), getMetric(current, 'sim_net_cents'))
  const failuresD  = driftPct(getMetric(baseline, 'failures'),       getMetric(current, 'failures'))
  const approvalsD = driftPct(
    getMetric((baseline as Record<string, unknown>)?.approvals, 'approved') +
      getMetric((baseline as Record<string, unknown>)?.approvals, 'auto_approved'),
    getMetric((current  as Record<string, unknown>)?.approvals, 'approved') +
      getMetric((current  as Record<string, unknown>)?.approvals, 'auto_approved'),
  )
  return [netD, failuresD, approvalsD].reduce((worst, d) => Math.abs(d) > Math.abs(worst) ? d : worst, 0)
}

async function bootstrapDefaultBenchmark(db: SupabaseClient): Promise<BenchmarkRow | null> {
  const targetSlug = process.env.SIMULATION_BENCHMARK_BUSINESS_SLUG?.trim() || 'sim-saas-01'
  const bizRes = await (db.from('business_operators' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { slug: string; simulation?: boolean } | null }> } }
  }).select('slug, simulation').eq('slug', targetSlug).maybeSingle()
  if (!bizRes.data || !bizRes.data.simulation) return null

  const seed = `bench-${targetSlug}-canonical-v1`
  const insRes = await (db.from('simulation_benchmarks' as never) as unknown as {
    insert: (r: unknown) => { select: (c: string) => { single: () => Promise<{ data: BenchmarkRow | null }> } }
  }).insert({
    name:                 `canonical-${targetSlug}`,
    business_slug:        targetSlug,
    seed,
    compress_days:        5,                 // small + fast — full run < 60s
    wallclock_budget_sec: 600,
    approver_policy:      'permissive',
    synthetic_voice:      'template',
    drift_threshold_pct:  5.00,
  }).select('*').single()
  return insRes.data
}

export async function runOneBenchmark(db: SupabaseClient, b: BenchmarkRow): Promise<BenchmarkRunSummary> {
  if (!BENCHMARK_OWNER_USER_ID) {
    return { name: b.name, status: 'skipped', error: 'no_owner_user_id_in_env' }
  }

  // Insert a fresh simulation_runs row using the BENCHMARK'S FIXED seed.
  // We can't use startRun() directly because it generates a new seed —
  // bypass into the table with the stored seed. Engine.tickOnce reads
  // seed from the row, so the timeline reproduces exactly.
  const insRes = await (db.from('simulation_runs' as never) as unknown as {
    insert: (r: unknown) => { select: (c: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } }
  }).insert({
    user_id:              BENCHMARK_OWNER_USER_ID,
    business_slug:        b.business_slug,
    mode:                 'auto',
    compress_days:        b.compress_days,
    wallclock_budget_sec: b.wallclock_budget_sec,
    approver_policy:      b.approver_policy,
    seed:                 b.seed,
    status:               'running',
    total_events:         0,
    started_at:           new Date().toISOString(),
    synthetic_voice:      b.synthetic_voice,
  }).select('id').single()
  if (insRes.error || !insRes.data) {
    return { name: b.name, status: 'failed', error: insRes.error?.message ?? 'insert_failed' }
  }
  const runId = insRes.data.id
  // startRun would have generated the timeline + set total_events. We
  // need that too — call it explicitly via lookup. Simpler approach:
  // just use the engine's tickOnce which regenerates the timeline on
  // demand. But total_events stays 0 until first run. Let's call the
  // engine's runToCompletion in a loop bounded by 5min wallclock.
  void startRun   // (imported but used only as documentation reference)

  const start = Date.now()
  while (Date.now() - start < BENCHMARK_WALLCLOCK_BUDGET_MS) {
    const tick = await runToCompletion(db, runId)
    if (!tick.ok) return { name: b.name, status: 'failed', run_id: runId, error: tick.error ?? 'tick_failed' }
    if (tick.final_status === 'done' || tick.final_status === 'failed') break
    if (tick.final_status === 'paused') return { name: b.name, status: 'failed', run_id: runId, error: 'auto_mode_paused_unexpectedly' }
  }

  // Read final result
  const fetchRes = await (db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { result: Record<string, unknown> | null; status: string } | null }> } }
  }).select('result, status').eq('id', runId).maybeSingle()
  if (!fetchRes.data || !fetchRes.data.result || fetchRes.data.status !== 'done') {
    return { name: b.name, status: 'failed', run_id: runId, error: `final_status_${fetchRes.data?.status ?? 'unknown'}` }
  }
  const currentResult = fetchRes.data.result

  const netCents      = getMetric(currentResult, 'sim_net_cents')
  const failuresCount = getMetric(currentResult, 'failures')

  // Bootstrap baseline if missing
  if (!b.baseline_result) {
    await (db.from('simulation_benchmarks' as never) as unknown as {
      update: (r: unknown) => { eq: (c: string, v: string) => Promise<unknown> }
    }).update({
      baseline_result:  currentResult,
      baseline_run_id:  runId,
      baseline_set_at:  new Date().toISOString(),
      last_run_result:  currentResult,
      last_run_id:      runId,
      last_run_at:      new Date().toISOString(),
      last_drift_pct:   0,
      updated_at:       new Date().toISOString(),
    }).eq('id', b.id)
    await recordRunHistory(db, b.id, runId, { drift_pct: null, sim_net_cents: netCents, failures: failuresCount, bootstrapped: true, alerted: false, result_snapshot: currentResult })
    return { name: b.name, status: 'done', run_id: runId, bootstrapped: true, drift_pct: 0 }
  }

  // Diff
  const drift = combinedDriftPct(b.baseline_result, currentResult)
  const alertDue = Math.abs(drift) > Number(b.drift_threshold_pct) && (
    !b.last_alert_at ||
    Date.now() - new Date(b.last_alert_at).getTime() > ALERT_COOLDOWN_MS
  )

  if (alertDue) {
    try {
      const cfg = await getSlackConfig(BENCHMARK_OWNER_USER_ID)
      if (cfg.webhookUrl) {
        await postSlackNotification(cfg, {
          text: `📉 Sim benchmark drift on \`${b.name}\`: ${drift.toFixed(1)}% (threshold ${b.drift_threshold_pct}%)`,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `📉 *Sim benchmark drift on \`${b.name}\`*\nDrift: *${drift.toFixed(1)}%* (threshold ${b.drift_threshold_pct}%)\nBaseline run: \`${b.baseline_run_id ?? '?'}\`\nCurrent run: \`${runId}\`` } },
          ],
        })
      }
    } catch (err) {
      console.warn(`[benchmark:${b.name}] Slack alert failed:`, err instanceof Error ? err.message : err)
    }
  }

  await (db.from('simulation_benchmarks' as never) as unknown as {
    update: (r: unknown) => { eq: (c: string, v: string) => Promise<unknown> }
  }).update({
    last_run_result:  currentResult,
    last_run_id:      runId,
    last_run_at:      new Date().toISOString(),
    last_drift_pct:   Number(drift.toFixed(2)),
    ...(alertDue && { last_alert_at: new Date().toISOString() }),
    updated_at:       new Date().toISOString(),
  }).eq('id', b.id)

  await recordRunHistory(db, b.id, runId, {
    drift_pct:       Number(drift.toFixed(2)),
    sim_net_cents:   netCents,
    failures:        failuresCount,
    bootstrapped:    false,
    alerted:         alertDue,
    result_snapshot: currentResult,
  })

  return { name: b.name, status: 'done', run_id: runId, drift_pct: Number(drift.toFixed(2)), alerted: alertDue }
}

async function recordRunHistory(
  db: SupabaseClient,
  benchmarkId: string,
  runId: string,
  fields: {
    drift_pct:       number | null
    sim_net_cents:   number
    failures:        number
    bootstrapped:    boolean
    alerted:         boolean
    result_snapshot: Record<string, unknown>
  },
): Promise<void> {
  try {
    await (db.from('simulation_benchmark_runs' as never) as unknown as {
      insert: (r: unknown) => Promise<{ error: { message: string } | null }>
    }).insert({
      benchmark_id:    benchmarkId,
      run_id:          runId,
      drift_pct:       fields.drift_pct,
      sim_net_cents:   fields.sim_net_cents,
      failures:        fields.failures,
      bootstrapped:    fields.bootstrapped,
      alerted:         fields.alerted,
      result_snapshot: fields.result_snapshot,
    })
  } catch (err) {
    console.warn('[benchmark:history] insert failed:', err instanceof Error ? err.message : err)
  }
}

export async function runBenchmarks(db: SupabaseClient): Promise<RunBenchmarksResult> {
  // Self-bootstrap if no benchmarks exist
  const cntRes = await (db.from('simulation_benchmarks' as never) as unknown as {
    select: (c: string) => Promise<{ data: BenchmarkRow[] | null }>
  }).select('id')
  if (!cntRes.data || cntRes.data.length === 0) {
    const seeded = await bootstrapDefaultBenchmark(db)
    if (!seeded) return { ok: true, results: [{ name: '(default)', status: 'skipped', error: 'no_canonical_sim_business' }] }
  }

  const enabledRes = await (db.from('simulation_benchmarks' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: boolean) => Promise<{ data: BenchmarkRow[] | null }> }
  }).select('*').eq('enabled', true)
  const benchmarks = enabledRes.data ?? []

  const results: BenchmarkRunSummary[] = []
  for (const b of benchmarks) {
    try {
      results.push(await runOneBenchmark(db, b))
    } catch (err) {
      results.push({ name: b.name, status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { ok: true, results }
}

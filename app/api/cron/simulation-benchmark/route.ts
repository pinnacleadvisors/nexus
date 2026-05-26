/**
 * POST /api/cron/simulation-benchmark — daily drift-alarm cron.
 *
 * Runs every enabled simulation_benchmarks row, diffs the result
 * against the stored baseline, posts a Slack alert when |drift| >
 * drift_threshold_pct. Bootstraps a default benchmark on first run
 * if none exist.
 *
 * Auth: Bearer ${CRON_SECRET}.
 * Idempotent: each run creates a new simulation_runs row, but stale
 * state never builds up — old runs are graded + completed.
 * Returns 200 always (retry-storm rule — cron-job.org auto-disables
 * after ~26 consecutive 5xx).
 *
 * Scheduled at 0 6 * * * UTC (06:00 daily) in vercel.json — chosen to
 * fall AFTER the simulation-tick cron (08:00) so a sim business has
 * its persona-tick state fresh; that doesn't affect the benchmark's
 * deterministic seed but means baseline drift won't be confused with
 * a sim-tick-induced shift in any sim state used.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { runBenchmarks } from '@/lib/simulation/benchmark'

export const runtime    = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET
  const auth     = req.headers.get('authorization') ?? ''
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  try {
    const out = await runBenchmarks(db)
    return NextResponse.json(out)
  } catch (err) {
    console.warn('[cron/simulation-benchmark] uncaught:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'unknown' })
  }
}

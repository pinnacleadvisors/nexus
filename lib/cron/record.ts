/**
 * recordCronRun — wraps a cron handler so that every invocation produces a
 * structured `log_events` row. PR 5 of task_plan-ux-security-onboarding.md.
 *
 * Why log_events instead of a dedicated cron_runs table:
 *   - migration 022 already exists (Vercel log drain)
 *   - service-role only (RLS deny-by-default) so cron data isn't browser-exposed
 *   - `route` / `created_at` indexes already cover the queries `/api/health/cron` needs
 *   - one less migration, one less table to operate
 *
 * Schema mapping for cron rows:
 *   route       = /api/cron/<name>
 *   level       = 'info' | 'error'
 *   status      = HTTP-style: 200 success, 500 failure, 408 timeout
 *   duration_ms = wall-clock ms from start to end
 *   message     = stringified JSON of fn() return value (capped) OR error message
 */

import { createServerClient } from '@/lib/supabase'

interface CronRunOptions {
  /** Override clock for tests. */
  now?: Date
  /** Soft cap on the message field; defaults to 4 KB. */
  maxMessageBytes?: number
}

export async function recordCronRun<T>(
  name: string,
  fn: () => Promise<T>,
  opts: CronRunOptions = {},
): Promise<T> {
  const start = (opts.now ?? new Date()).getTime()
  const route = `/api/cron/${name}`
  let result: T | undefined
  let error: Error | undefined
  try {
    result = await fn()
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e))
  }

  const finished = new Date()
  const duration = Math.max(0, finished.getTime() - start)
  const status = error ? 500 : 200
  const level: 'info' | 'error' = error ? 'error' : 'info'
  let message: string
  if (error) {
    message = `error: ${error.message}`
  } else {
    try {
      message = JSON.stringify(result ?? null)
    } catch {
      message = '<unserialisable result>'
    }
  }
  const cap = opts.maxMessageBytes ?? 4096
  if (message.length > cap) message = message.slice(0, cap) + '…'

  const sb = createServerClient()
  if (sb) {
    const insert = sb as unknown as {
      from: (t: string) => { insert: (row: Record<string, unknown>) => Promise<{ error: unknown }> }
    }
    await insert.from('log_events').insert({
      route,
      level,
      status,
      duration_ms: duration,
      message,
      created_at:  finished.toISOString(),
    })
  }

  if (error) throw error
  return result as T
}

/**
 * Names of crons we expect to see in log_events. Used by /api/health/cron
 * to render a row per-job even when no successful run has been recorded.
 */
export const KNOWN_CRONS: ReadonlyArray<{ name: string; expectedWindowMin: number }> = [
  { name: 'signal-review',          expectedWindowMin: 60 * 24 + 15 },     // 0 8 * * *
  { name: 'rebuild-graph-hq',       expectedWindowMin: 60 * 6 + 15 },      // 0 */6 * * *
  { name: 'sync-memory',            expectedWindowMin: 60 * 24 + 15 },     // 0 4 * * *
  { name: 'post-deploy-smoke',      expectedWindowMin: 30 + 5 },           // */30 * * * *
  { name: 'sync-learning-cards',    expectedWindowMin: 60 * 24 + 15 },     // 0 5 * * *
  { name: 'sweep-orphan-cards',     expectedWindowMin: 60 * 24 + 15 },     // 30 4 * * *
]

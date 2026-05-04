/**
 * C2 — daily Inngest cron that compares each user's last-24h per-agent
 * metrics against their 7-day baseline and files `perf-regression: ...`
 * rows on workflow_feedback whenever a > 25% degradation is detected.
 *
 * Runs at 09:30 UTC — after dailyCostCheck (08:00) so its output doesn't
 * race with cost-alert evaluation.
 */

import { inngest } from '@/inngest/client'
import { createServerClient } from '@/lib/supabase'
import { runRegressionSweep } from '@/lib/observability/regression'

export const regressionSweepDaily = inngest.createFunction(
  {
    id:   'regression-sweep-daily',
    name: 'Perf-regression detector (daily)',
    // retries: 0 — daily cron, read-only analysis. If today's run failed,
    // tomorrow's picks up the same window. No retry-on-failure benefit.
    retries: 0,
    triggers: [{ cron: '30 9 * * *' }],
  },
  async ({ step }: { step: Record<string, (id: string, fn: () => Promise<unknown>) => Promise<unknown>> }) => {
    const userIds = await step['run']('list-users-with-recent-samples', async () => {
      const db = createServerClient()
      if (!db) return [] as string[]
      const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const { data } = await (db.from('metric_samples' as never) as unknown as {
        select: (cols: string) => {
          gte: (c: string, v: string) => Promise<{ data: Array<{ user_id: string }> | null }>
        }
      }).select('user_id').gte('at', cutoff)
      const set = new Set<string>()
      for (const row of data ?? []) set.add(row.user_id)
      return [...set]
    }) as string[]

    const results: Array<{ userId: string; detected: number; filed: number }> = []
    for (const userId of userIds) {
      const r = await step['run'](`sweep-${userId.slice(0, 12)}`, async () => {
        return runRegressionSweep(userId)
      }) as { detected: number; filed: number }
      results.push({ userId, ...r })
    }

    return {
      sweptUsers:    userIds.length,
      totalDetected: results.reduce((s, r) => s + r.detected, 0),
      totalFiled:    results.reduce((s, r) => s + r.filed, 0),
    }
  },
)

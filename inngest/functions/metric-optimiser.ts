/**
 * A9 — hourly metric-triggered optimiser. Sweeps every user with recent runs,
 * detects drift signals (review rejections, high token cost, high dispatch
 * failure rate), and files workflow_feedback rows. The existing
 * `workflow-optimizer` managed agent reads those rows and proposes minimal
 * diffs against the agent spec that produced the bad outputs.
 *
 * Why Inngest not Vercel cron: Inngest gives us retries, step isolation, and a
 * durable event log for free. If a per-user sweep fails, only that step
 * retries.
 */

import { inngest } from '@/inngest/client'
import { createServerClient } from '@/lib/supabase'
import { runMetricOptimiser } from '@/lib/runs/metric-triggers'

export const metricOptimiserHourly = inngest.createFunction(
  {
    id:   'metric-optimiser-hourly',
    name: 'Metric-triggered optimiser sweep',
    triggers: [{ cron: '0 * * * *' }],
  },
  async ({ step }: { step: Record<string, (id: string, fn: () => Promise<unknown>) => Promise<unknown>> }) => {
    const userIds = await step['run']('list-active-users', async () => {
      const db = createServerClient()
      if (!db) return [] as string[]
      // Distinct users with a run updated in the last 7 days
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const { data } = await (db.from('runs' as never) as unknown as {
        select: (cols: string) => {
          gte: (c: string, v: string) => Promise<{ data: Array<{ user_id: string }> | null }>
        }
      }).select('user_id').gte('updated_at', cutoff)
      const set = new Set<string>()
      for (const row of data ?? []) set.add(row.user_id)
      return [...set]
    }) as string[]

    const results: Array<{ userId: string; detected: number; filed: number }> = []
    for (const userId of userIds) {
      const r = await step['run'](`optimise-${userId.slice(0, 12)}`, async () => {
        return runMetricOptimiser(userId)
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

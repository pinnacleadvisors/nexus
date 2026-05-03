/**
 * A11 — hourly Inngest cron that polls each live-measure Run's external posts
 * for fresh stats and advances it to `optimise` once `hasEnoughSignal()`
 * returns true.
 *
 * Each user is a separate Inngest step so one broken credential set does not
 * block other users.
 */

import { inngest } from '@/inngest/client'
import { createServerClient } from '@/lib/supabase'
import { ingestMetricsForUser } from '@/lib/runs/measure-ingester'

export const ingestMetricsHourly = inngest.createFunction(
  {
    id:   'ingest-metrics-hourly',
    name: 'Publish-metric ingestion sweep',
    // retries: 1 — each user's metrics call hits YouTube / TikTok / Instagram
    // APIs which are quota-limited (YouTube especially). 3× retry × N users
    // × N providers = quota exhaustion on a flaky upstream. Per-user step
    // catches its own errors below, so function-level retry only fires on
    // the list-measuring-users DB call. One retry covers transient pool
    // exhaustion. See docs/RETRY_STORM_AUDIT.md finding 2.
    retries: 1,
    triggers: [{ cron: '15 * * * *' }],   // :15 past the hour — offset from metric optimiser
  },
  async ({ step }: { step: Record<string, (id: string, fn: () => Promise<unknown>) => Promise<unknown>> }) => {
    const userIds = await step['run']('list-measuring-users', async () => {
      const db = createServerClient()
      if (!db) return [] as string[]
      const { data } = await (db.from('runs' as never) as unknown as {
        select: (cols: string) => {
          eq: (c: string, v: string) => Promise<{ data: Array<{ user_id: string }> | null }>
        }
      }).select('user_id').eq('phase', 'measure')
      const set = new Set<string>()
      for (const row of data ?? []) set.add(row.user_id)
      return [...set]
    }) as string[]

    const results = []
    for (const userId of userIds) {
      // Wrap each user in try/catch — one user's broken provider creds (e.g.
      // expired YouTube refresh token) shouldn't fail the function and trigger
      // a function-level retry that re-pings the SAME broken provider for
      // every other user.
      const r = await step['run'](`ingest-${userId.slice(0, 12)}`, async () => {
        try {
          return await ingestMetricsForUser(userId)
        } catch (err) {
          return {
            error: err instanceof Error ? err.message : String(err),
            userId,
          }
        }
      })
      results.push({ userId, results: r })
    }

    return { sweptUsers: userIds.length, results }
  },
)

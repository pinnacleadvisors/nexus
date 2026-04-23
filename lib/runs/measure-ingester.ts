/**
 * lib/runs/measure-ingester.ts — A11
 *
 * Iterates runs in `phase=measure`, polls each provider for the latest stats
 * on every externalId in `metrics.externalIds`, writes the aggregate back onto
 * the run, and advances to `optimise` once `hasEnoughSignal()` returns true.
 *
 * Pure-ish: uses the Supabase service client (createServerClient) and provider
 * modules, but exposes a single `ingestMetricsForUser(userId)` that the
 * Inngest cron + manual-trigger route both call. Idempotent across runs — safe
 * to call at any cadence.
 */

import { createServerClient } from '@/lib/supabase'
import { getSecrets } from '@/lib/user-secrets'
import { fetchYouTubeStats, fetchTikTokStats, fetchInstagramStats, hasEnoughSignal } from '@/lib/publish/metrics'
import { advancePhase, listEvents, recordMetrics } from './controller'
import type { PublishProviderId } from '@/lib/publish/types'
import type { Run } from '@/lib/types'

interface IngestResult {
  runId:      string
  viewsAdded: number
  advanced:   boolean
}

async function statsFor(
  provider:     PublishProviderId,
  externalId:   string,
  credsByKind:  Record<string, Record<string, string>>,
): Promise<{ views: number; likes: number } | null> {
  if (provider === 'youtube-shorts') {
    const creds = credsByKind.youtube
    if (!creds) return null
    const s = await fetchYouTubeStats(externalId, creds)
    return s ? { views: s.views ?? 0, likes: s.likes ?? 0 } : null
  }
  if (provider === 'tiktok') {
    const s = await fetchTikTokStats()
    return s ? { views: s.views ?? 0, likes: s.likes ?? 0 } : null
  }
  if (provider === 'instagram-reels') {
    const s = await fetchInstagramStats()
    return s ? { views: s.views ?? 0, likes: s.likes ?? 0 } : null
  }
  return null
}

interface RunRow {
  id: string
  user_id: string
  metrics: Record<string, unknown> | null
}

export async function ingestMetricsForUser(userId: string): Promise<IngestResult[]> {
  const db = createServerClient()
  if (!db) return []

  const { data: rows } = await (db.from('runs' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => Promise<{ data: RunRow[] | null }>
      }
    }
  }).select('id,user_id,metrics').eq('user_id', userId).eq('phase', 'measure')

  if (!rows || rows.length === 0) return []

  // Load every credential kind once so repeated YouTube polls don't thrash user_secrets
  const [youtube, tiktok, instagram] = await Promise.all([
    getSecrets(userId, 'youtube'),
    getSecrets(userId, 'tiktok'),
    getSecrets(userId, 'instagram'),
  ])
  const credsByKind: Record<string, Record<string, string>> = { youtube, tiktok, instagram }

  const results: IngestResult[] = []

  for (const row of rows) {
    const metrics = (row.metrics ?? {}) as Run['metrics']
    const externalIds = metrics.externalIds ?? {}
    if (Object.keys(externalIds).length === 0) {
      results.push({ runId: row.id, viewsAdded: 0, advanced: false })
      continue
    }

    let totalViews = 0
    let totalLikes = 0
    for (const [provider, externalId] of Object.entries(externalIds)) {
      const stats = await statsFor(provider as PublishProviderId, externalId, credsByKind).catch(() => null)
      if (!stats) continue
      totalViews += stats.views
      totalLikes += stats.likes
    }

    // Find the oldest publish.posted event so the age heuristic in
    // hasEnoughSignal has a real timestamp to reason about.
    const events = await listEvents(row.id, 500)
    const oldestPostAt = events
      .filter(e => e.kind === 'publish.posted')
      .map(e => e.createdAt)
      .sort()[0]

    const estCtr = totalViews > 0 ? totalLikes / totalViews : undefined

    await recordMetrics(row.id, {
      tokenCostUsd: metrics.tokenCostUsd,   // preserve any prior cost value
      ctr:          estCtr,
      // We store a synthetic 'views' under metrics via an extended field on
      // the merged object — the types allow arbitrary extras because
      // controller.recordMetrics spreads patch over the existing jsonb.
      ...(totalViews > 0 ? { views: totalViews } : {}),
      ...(totalLikes > 0 ? { likes: totalLikes } : {}),
    } as Run['metrics'])

    let advanced = false
    if (hasEnoughSignal({ totalViews, oldestPostAt })) {
      const next = await advancePhase(row.id, 'optimise', {
        reason:      'measure.enough-signal',
        totalViews,
        oldestPostAt,
      })
      advanced = Boolean(next)
    }
    results.push({ runId: row.id, viewsAdded: totalViews, advanced })
  }

  return results
}

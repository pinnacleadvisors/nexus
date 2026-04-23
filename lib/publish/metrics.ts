/**
 * lib/publish/metrics.ts — A11 measure-phase helpers.
 *
 * Polls each configured provider for the analytics of a previously-published
 * asset and normalises the result into `RunMetrics`. Stubs for TikTok /
 * Instagram so the cron loop does not crash while only YouTube is implemented.
 */

import type { PublishProviderId } from './types'

export interface PublishedStats {
  provider:    PublishProviderId
  externalId:  string
  views?:      number
  likes?:      number
  comments?:   number
  /** YouTube reports CTR via the Analytics API (separate from Data API). Left undefined here. */
  ctr?:        number
  /** Conversions are not reported by these platforms directly. */
  conversions?: number
  fetchedAt:   string
}

const YT_STATS_URL = 'https://www.googleapis.com/youtube/v3/videos?part=statistics&id='

async function refreshYouTubeAccessToken(credentials: Record<string, string>): Promise<string | null> {
  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) return null
  const body = new URLSearchParams({
    client_id:     credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type:    'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) return null
  const data = await res.json() as { access_token?: string }
  return data.access_token ?? null
}

export async function fetchYouTubeStats(
  videoId: string,
  credentials: Record<string, string>,
): Promise<PublishedStats | null> {
  const token = await refreshYouTubeAccessToken(credentials)
  if (!token) return null

  const res = await fetch(`${YT_STATS_URL}${encodeURIComponent(videoId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const data = await res.json() as {
    items?: Array<{ statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }>
  }
  const stats = data.items?.[0]?.statistics
  if (!stats) return null

  return {
    provider:   'youtube-shorts',
    externalId: videoId,
    views:      stats.viewCount    ? parseInt(stats.viewCount,    10) : undefined,
    likes:      stats.likeCount    ? parseInt(stats.likeCount,    10) : undefined,
    comments:   stats.commentCount ? parseInt(stats.commentCount, 10) : undefined,
    fetchedAt:  new Date().toISOString(),
  }
}

/** Stubs — implement when the TikTok/Instagram publishers land. */
export async function fetchTikTokStats(): Promise<PublishedStats | null> {
  return null
}
export async function fetchInstagramStats(): Promise<PublishedStats | null> {
  return null
}

/**
 * Sample-size gate. Returns true once the run has enough signal to move from
 * `measure` → `optimise`. Heuristic: ≥ 100 views across all platforms OR
 * ≥ 7 days since the run's last publish.postedAt.
 */
export function hasEnoughSignal(opts: {
  totalViews:    number
  oldestPostAt?: string
}): boolean {
  if (opts.totalViews >= 100) return true
  if (opts.oldestPostAt) {
    const ageMs = Date.now() - new Date(opts.oldestPostAt).getTime()
    if (ageMs >= 7 * 24 * 60 * 60 * 1000) return true
  }
  return false
}

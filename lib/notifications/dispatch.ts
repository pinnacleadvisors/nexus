/**
 * lib/notifications/dispatch.ts — operator-notification fan-out.
 *
 * R4 of the UX consultation. Single entry point: `notifyOperator(userId,
 * category, payload)`. Reads `notification_settings` to find which
 * channels are enabled for this (operator, category), then dispatches
 * via the relevant channel module.
 *
 * Channels (V1):
 *   - 'slack'   — DM via Composio Slack action to the operator-chosen
 *                 channel (default #approvals).
 *   - 'webpush' — Browser Web Push API. Requires VAPID keys + active
 *                 push_subscriptions row.
 *
 * Fail-soft on every channel — one channel breaking never blocks
 * delivery to the others. Returns per-channel result map so the caller
 * can log failures or fall back.
 *
 * NEVER throws. Logging is the caller's job.
 */

import { createServerClient } from '@/lib/supabase'

export type NotificationCategory =
  | 'approval-pending'
  | 'kill-switch'
  | 'graduation'
  | 'security-alert'
  | 'weekly-digest'
  // Durable chat (Phase D) — a detached chat turn finished (or crashed) while
  // the operator was away; the server reconciler fires this so a closed
  // tab/phone still gets pinged.
  | 'chat-turn'
  // Gamify Accomplishments — the operator crossed a new achievement tier
  // (first $1k, third niche, …); the recompute cron fires this exactly once.
  | 'milestone'

export type NotificationChannel = 'slack' | 'webpush' | 'discord'

export interface NotificationPayload {
  title:        string
  body:         string
  /** Deep-link the recipient should follow when they click the
   *  notification. Operator's existing inbox / approvals page work well. */
  link_href?:   string
  /** Optional severity tag for visual styling. Defaults to 'info'. */
  severity?:    'info' | 'warning' | 'critical'
  /** Optional business slug — surfaces in the notification copy as a
   *  prefix ("[inkbound] ..."). */
  business_slug?: string
}

export interface ChannelResult {
  channel: NotificationChannel
  ok:      boolean
  error?:  string
  skipped?: 'disabled' | 'unconfigured' | 'no-subscription'
}

export interface DispatchResult {
  category: NotificationCategory
  results:  ChannelResult[]
  /** True when at least one channel delivered. */
  delivered: boolean
}

/** Default opt-in per category. New operators get these on first read
 *  if the row doesn't exist yet. Configurable later via PATCH. */
const DEFAULT_ENABLED: Record<NotificationCategory, NotificationChannel[]> = {
  'approval-pending':  ['slack', 'webpush', 'discord'],
  'kill-switch':       ['slack', 'webpush', 'discord'],
  'graduation':        ['slack', 'discord'],
  'security-alert':    ['slack', 'webpush', 'discord'],
  'weekly-digest':     ['slack', 'discord'],
  'chat-turn':         ['slack', 'webpush'],
  'milestone':         ['slack', 'webpush', 'discord'],
}

/**
 * Resolve which channels are enabled for (userId, category). Reads the
 * `notification_settings` table and falls back to DEFAULT_ENABLED when
 * a row hasn't been written yet. Fail-soft: returns defaults on DB error.
 */
export async function resolveChannels(
  userId:   string,
  category: NotificationCategory,
): Promise<NotificationChannel[]> {
  const db = createServerClient()
  if (!db) return DEFAULT_ENABLED[category]
  try {
    const res = await (db.from('notification_settings' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ data: Array<{ channel: NotificationChannel; enabled: boolean }> | null; error: { message: string } | null }> } }
    }).select('channel, enabled').eq('user_id', userId).eq('category', category)
    if (res.error || !res.data || res.data.length === 0) {
      return DEFAULT_ENABLED[category]
    }
    return res.data.filter(r => r.enabled).map(r => r.channel)
  } catch {
    return DEFAULT_ENABLED[category]
  }
}

/**
 * Main entry. Fans out to every enabled channel for this category.
 * Each channel dispatched in parallel; channel failures don't block
 * others. Returns aggregated result.
 *
 * Usage:
 *   await notifyOperator(userId, 'approval-pending', {
 *     title: 'New approval needed',
 *     body:  'inkbound: domain_purchase — $12/yr nameneko.com',
 *     link_href: '/approvals',
 *     business_slug: 'inkbound',
 *   })
 */
export async function notifyOperator(
  userId:   string,
  category: NotificationCategory,
  payload:  NotificationPayload,
): Promise<DispatchResult> {
  const channels = await resolveChannels(userId, category)

  if (channels.length === 0) {
    return { category, results: [], delivered: false }
  }

  const results = await Promise.all(channels.map(async (channel): Promise<ChannelResult> => {
    try {
      if (channel === 'slack') {
        const { sendSlackNotification } = await import('./slack')
        return await sendSlackNotification(userId, payload)
      }
      if (channel === 'webpush') {
        const { sendWebPushNotification } = await import('./webpush')
        return await sendWebPushNotification(userId, payload)
      }
      if (channel === 'discord') {
        const { sendDiscordNotification } = await import('./discord')
        return await sendDiscordNotification(userId, payload)
      }
      return { channel, ok: false, error: 'unknown_channel' }
    } catch (err) {
      return {
        channel,
        ok:    false,
        error: err instanceof Error ? err.message : 'unknown',
      }
    }
  }))

  const delivered = results.some(r => r.ok)
  return { category, results, delivered }
}

/** Sets the per-channel-per-category opt-in for an operator. Used by
 *  the NotificationsPanel UI when the operator toggles a checkbox. */
export async function setChannelEnabled(
  userId:   string,
  channel:  NotificationChannel,
  category: NotificationCategory,
  enabled:  boolean,
): Promise<{ ok: boolean; error?: string; degraded?: boolean }> {
  const db = createServerClient()
  if (!db) return { ok: false, error: 'supabase_unconfigured' }
  try {
    const res = await (db.from('notification_settings' as never) as unknown as {
      upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ error: { message: string } | null }>
    }).upsert({
      user_id:    userId,
      channel,
      category,
      enabled,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,channel,category' })
    if (res.error) {
      if (/relation .*notification_settings.* does not exist/i.test(res.error.message)) {
        return { ok: false, degraded: true, error: 'migration_091_not_applied' }
      }
      return { ok: false, error: res.error.message }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

/** Read all settings for an operator — used by the settings UI to
 *  render checkboxes with current state. */
export async function getOperatorSettings(userId: string): Promise<Array<{
  channel:  NotificationChannel
  category: NotificationCategory
  enabled:  boolean
}>> {
  const db = createServerClient()
  if (!db) return []
  try {
    const res = await (db.from('notification_settings' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => Promise<{ data: Array<{ channel: NotificationChannel; category: NotificationCategory; enabled: boolean }> | null; error: { message: string } | null }> }
    }).select('channel, category, enabled').eq('user_id', userId)
    if (res.error || !res.data) return []
    return res.data
  } catch {
    return []
  }
}

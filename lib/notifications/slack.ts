/**
 * lib/notifications/slack.ts — Slack channel for operator notifications.
 *
 * R4 of the UX consultation. DMs the operator via Composio Slack action
 * (`SLACK_SEND_MESSAGE`) to the channel chosen in
 * `notification_slack_targets`. Defaults to `#approvals` per the
 * operator's 2026-05-27 brain-dump.
 *
 * Resolution order for the destination channel:
 *   1. notification_slack_targets.channel_id for the user — operator's
 *      explicit pick (set via /settings → Alerts → Slack target).
 *   2. Default to a channel named `approvals` resolved at dispatch time.
 *   3. Skip if no Slack connection exists at all.
 *
 * Fail-soft: any failure (no connection, no channel, Composio error)
 * returns ok:false with a reason. Never throws.
 */

import { createServerClient } from '@/lib/supabase'
import { executeBusinessAction, ConnectedAccountMissingError } from '@/lib/composio/actions'
import type { ChannelResult, NotificationPayload } from './dispatch'

interface SlackTarget {
  channel_id:   string
  channel_name: string | null
}

/**
 * Load the operator's Slack channel target. Returns null if not set
 * (the dispatcher will fall back to a default).
 */
async function loadSlackTarget(userId: string): Promise<SlackTarget | null> {
  const db = createServerClient()
  if (!db) return null
  try {
    const res = await (db.from('notification_slack_targets' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: SlackTarget | null }> } }
    }).select('channel_id, channel_name').eq('user_id', userId).maybeSingle()
    return res.data ?? null
  } catch { return null }
}

/**
 * Format a notification payload as a Slack message. Uses Slack Block Kit
 * shape for rich formatting (severity emoji, business prefix, link
 * button).
 */
function formatBlocks(payload: NotificationPayload) {
  const sevEmoji = payload.severity === 'critical' ? '🚨'
                 : payload.severity === 'warning'  ? '⚠️'
                 : '🔔'
  const prefix = payload.business_slug ? `[${payload.business_slug}] ` : ''
  const blocks: unknown[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${sevEmoji}  *${prefix}${payload.title}*\n${payload.body}` },
    },
  ]
  if (payload.link_href) {
    const fullUrl = payload.link_href.startsWith('http')
      ? payload.link_href
      : `${process.env.NEXUS_BASE_URL ?? ''}${payload.link_href}`
    blocks.push({
      type:     'actions',
      elements: [{
        type:  'button',
        text:  { type: 'plain_text', text: 'Open in Nexus', emoji: false },
        url:   fullUrl,
        style: payload.severity === 'critical' ? 'danger' : 'primary',
      }],
    })
  }
  return blocks
}

/**
 * Send a notification to the operator via Slack DM / channel.
 * Returns a ChannelResult with skipped reason when no destination exists.
 */
export async function sendSlackNotification(
  userId:  string,
  payload: NotificationPayload,
): Promise<ChannelResult> {
  const target = await loadSlackTarget(userId)

  // Without a target, fall back to the default channel name. The
  // Composio action accepts either an ID or a `#name` reference.
  const channelRef = target?.channel_id ?? '#approvals'

  try {
    await executeBusinessAction({
      userId,
      businessSlug: null, // operator-scope; uses user-default connected_account
      platform:     'slack',
      action:       'SLACK_SEND_MESSAGE',
      arguments: {
        channel: channelRef,
        text:    `${payload.business_slug ? `[${payload.business_slug}] ` : ''}${payload.title}\n${payload.body}`,
        blocks:  formatBlocks(payload),
      },
      timeoutMs:    15_000,
    })
    return { channel: 'slack', ok: true }
  } catch (err) {
    if (err instanceof ConnectedAccountMissingError) {
      return { channel: 'slack', ok: false, skipped: 'unconfigured', error: 'no_slack_connection' }
    }
    return {
      channel: 'slack',
      ok:     false,
      error:  err instanceof Error ? err.message : 'unknown',
    }
  }
}

/** Update or set the operator's Slack channel target. */
export async function setSlackTarget(
  userId:       string,
  channelId:    string,
  channelName:  string | null = null,
): Promise<{ ok: boolean; error?: string }> {
  const db = createServerClient()
  if (!db) return { ok: false, error: 'supabase_unconfigured' }
  try {
    const res = await (db.from('notification_slack_targets' as never) as unknown as {
      upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ error: { message: string } | null }>
    }).upsert({
      user_id:      userId,
      channel_id:   channelId,
      channel_name: channelName,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (res.error) return { ok: false, error: res.error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

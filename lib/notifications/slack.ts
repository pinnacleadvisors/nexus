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
 * Interpret a Composio SLACK_SEND_MESSAGE response.
 *
 * Composio returns HTTP 200 + a top-level `successful: true` whenever it
 * REACHED Slack's API — even when Slack itself rejected the post with
 * `data.ok: false` (token_revoked / not_in_channel / channel_not_found /
 * invalid_auth). Treating "the call didn't throw" as success is the silent-
 * failure bug behind "the test button says OK but no message arrives": the
 * 2026-06-01 probe showed `{ successful: true, data: { ok: false, error:
 * "token_revoked" } }`. So we inspect BOTH levels.
 *
 * Returns the error string when the message did NOT actually send, else null.
 */
function extractSlackError(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as { successful?: boolean; error?: unknown; data?: { ok?: boolean; error?: unknown } }
  if (r.successful === false) {
    return typeof r.error === 'string' && r.error ? r.error : 'composio_action_failed'
  }
  if (r.data && typeof r.data === 'object' && r.data.ok === false) {
    return typeof r.data.error === 'string' && r.data.error ? r.data.error : 'slack_api_rejected'
  }
  return null
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
    const result = await executeBusinessAction({
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
    // Composio 200 ≠ Slack delivered — check the underlying Slack result too.
    const slackErr = extractSlackError(result)
    if (slackErr) {
      // Auth-class failures mean the connection is dead (token revoked/expired,
      // missing scope) — surface as `unconfigured` so the Alerts panel nudges a
      // reconnect at /settings/accounts rather than reading as a transient blip.
      const authClass = /revoked|invalid_auth|not_authed|account_inactive|token_expired|missing_scope|no_permission/i.test(slackErr)
      return { channel: 'slack', ok: false, error: slackErr, ...(authClass ? { skipped: 'unconfigured' as const } : {}) }
    }
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

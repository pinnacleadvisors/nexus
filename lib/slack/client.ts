/**
 * Slack messaging surface — minimal, dependency-free.
 *
 * Two flows:
 *   - Outbound notify   POST to incoming webhook URL (Block Kit JSON)
 *   - Inbound slash cmd Slack POSTs application/x-www-form-urlencoded;
 *                       verified via X-Slack-Signature (HMAC-SHA256 of
 *                       `v0:<timestamp>:<rawBody>` using signing secret).
 *
 * Per-user config lives in `user_secrets` with kind='slack':
 *   - webhookUrl     incoming webhook for outbound notifications
 *   - signingSecret  for inbound slash command verification
 *   - defaultChannel optional, informational only (webhook URL pins channel)
 *
 * Falls back to env vars NEXUS_SLACK_WEBHOOK_URL + NEXUS_SLACK_SIGNING_SECRET
 * for single-tenant / dev setups.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { getSecrets } from '@/lib/user-secrets'

export interface SlackConfig {
  webhookUrl?:     string
  signingSecret?:  string
  defaultChannel?: string
}

export async function getSlackConfig(userId: string): Promise<SlackConfig> {
  const fields = await getSecrets(userId, 'slack')
  return {
    webhookUrl:     fields.webhookUrl     || process.env.NEXUS_SLACK_WEBHOOK_URL     || undefined,
    signingSecret:  fields.signingSecret  || process.env.NEXUS_SLACK_SIGNING_SECRET  || undefined,
    defaultChannel: fields.defaultChannel || undefined,
  }
}

/**
 * Verify a Slack request signature per https://api.slack.com/authentication/verifying-requests-from-slack
 * Pass the raw request body (string), the X-Slack-Request-Timestamp header,
 * the X-Slack-Signature header, and the signing secret.
 *
 * Returns true on a valid signature within a 5-minute clock skew.
 */
export function verifySlackSignature(opts: {
  body:           string
  timestamp:      string
  signature:      string
  signingSecret:  string
  toleranceSec?:  number
}): boolean {
  const tolerance = opts.toleranceSec ?? 5 * 60
  const ts = parseInt(opts.timestamp, 10)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Date.now() / 1000 - ts) > tolerance) return false

  const base = `v0:${opts.timestamp}:${opts.body}`
  const computed = 'v0=' + createHmac('sha256', opts.signingSecret).update(base).digest('hex')

  const a = Buffer.from(computed, 'utf8')
  const b = Buffer.from(opts.signature, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export interface SlackNotifyPayload {
  text:        string                                // fallback / notification text
  blocks?:     unknown[]                             // Block Kit array
  threadTs?:   string                                // reply in-thread (only with chat.postMessage)
  channel?:    string                                // override default channel (chat.postMessage only)
}

/**
 * POST a notification to the configured incoming webhook.
 * Returns true on 2xx, false on any failure (logged in dev).
 */
export async function postSlackNotification(
  cfg: SlackConfig,
  payload: SlackNotifyPayload,
): Promise<boolean> {
  if (!cfg.webhookUrl) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[slack] no webhookUrl configured; skipping notify')
    }
    return false
  }
  const body = JSON.stringify({ text: payload.text, blocks: payload.blocks })
  try {
    const res = await fetch(cfg.webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!res.ok && process.env.NODE_ENV !== 'production') {
      console.warn(`[slack] webhook returned ${res.status}`)
    }
    return res.ok
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.warn('[slack] post failed:', err)
    return false
  }
}

/**
 * Slack-specific failure-mode → human explanation.
 *
 * Slack's incoming webhooks return HTTP 200 with a plain-text body even when
 * the message wasn't delivered — the body string is the only signal of a
 * silent failure. These are the bodies documented at
 * https://api.slack.com/messaging/webhooks#errors.
 */
function explainSlackBody(body: string): string {
  const map: Record<string, string> = {
    channel_is_archived:                 'The pinned channel is archived. Unarchive it or generate a new webhook for a different channel.',
    channel_not_found:                   'The pinned channel no longer exists. Generate a new webhook.',
    no_service:                          'The webhook has been revoked or the app was uninstalled. Generate a new incoming-webhook URL.',
    no_service_id:                       'Slack rejected the webhook (no_service_id) — the URL is malformed or expired.',
    no_team:                             'The Slack workspace was deleted or the app was removed. Reinstall the app and generate a new URL.',
    team_disabled:                       'The Slack workspace is disabled.',
    action_prohibited:                   'Workspace policy blocks this app from posting. Ask a workspace admin to allow it.',
    posting_to_general_channel_denied:   'Posting to #general is blocked in this workspace. Pin the webhook to a different channel.',
    invalid_payload:                     'Slack rejected the message format. This is a Nexus bug — please report it.',
    user_not_found:                      'Slack user resolution failed (user_not_found).',
    rollup_error:                        'Slack rejected the request (rollup_error) — usually transient. Retry in a moment.',
  }
  const key = body.trim().toLowerCase()
  if (map[key]) return `${map[key]} (Slack: ${body.trim()})`
  return `Slack accepted the request but did not deliver it: ${body.trim().slice(0, 150) || '(empty body)'}`
}

/**
 * Send a one-shot verification message to a freshly-pasted incoming-webhook URL.
 * Used by /api/businesses when the slack_webhook_url field changes — the owner
 * gets immediate visual confirmation that the URL is live, and the receiving
 * channel gets a "Nexus is connected" announcement.
 *
 * Detects two distinct failure modes:
 *   1. Hard fail   — non-2xx HTTP status. Caller marks the webhook red.
 *   2. Silent fail — HTTP 200 but body !== "ok" (Slack's documented behavior
 *      when the channel is archived, the webhook revoked, the workspace
 *      disabled, etc). Without this check the message looks delivered but
 *      never reaches a channel.
 *
 * The body-must-equal-"ok" check is gated to URLs that look like Slack's
 * `hooks.slack.com/services/...` form so a user pasting a Discord or Zapier
 * webhook by mistake doesn't get false "silent fail" alerts. The error text
 * for hostnames-that-aren't-Slack defaults to status-code semantics.
 *
 * Returns:
 *   { ok: true }                                  — Slack delivered.
 *   { ok: false, status, reason, silent: true }   — 200 OK, undelivered.
 *   { ok: false, status, reason, silent: false }  — non-2xx response or net error.
 */
export type VerificationResult =
  | { ok: true }
  | { ok: false; status: number; reason: string; silent: boolean }

export async function postVerification(
  webhookUrl: string,
  opts: { businessName?: string; channel?: string } = {},
): Promise<VerificationResult> {
  const name = opts.businessName ?? 'this business'
  const channelLine = opts.channel ? `Channel: \`${opts.channel}\`` : 'Channel pinned by webhook URL'
  const isSlackUrl = /^https:\/\/hooks\.slack\.com\//i.test(webhookUrl)
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:white_check_mark: *Nexus connected to ${name}*\nThis channel will receive approval requests, run summaries, and alerts.`,
      },
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: channelLine }] },
  ]
  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        text: `Nexus connected to ${name}. Approvals and run summaries will arrive here.`,
        blocks,
      }),
    })
    const body = (await res.text().catch(() => '')).trim()

    // Hard HTTP failure — easy case.
    if (!res.ok) {
      return {
        ok:     false,
        status: res.status,
        reason: body.slice(0, 200) || res.statusText || `HTTP ${res.status}`,
        silent: false,
      }
    }

    // Slack URL — body MUST equal "ok" to count as delivered. Anything else is
    // a silent fail (request accepted, message never reached the channel).
    if (isSlackUrl) {
      if (body.toLowerCase() === 'ok') return { ok: true }
      return {
        ok:     false,
        status: res.status,
        reason: explainSlackBody(body),
        silent: true,
      }
    }

    // Non-Slack URL — fall back to status-code-only verdict.
    return { ok: true }
  } catch (err) {
    return {
      ok:     false,
      status: 0,
      reason: err instanceof Error ? err.message : 'network error',
      silent: false,
    }
  }
}

/**
 * Build a small Block Kit card for a Board approval request.
 */
export function approvalBlocks(opts: {
  runId:       string
  title:       string
  description: string
  dashboardUrl: string
}): unknown[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `*${opts.title}*\n${opts.description}` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Run \`${opts.runId.slice(0, 8)}\`` }] },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Open in Nexus' }, url: opts.dashboardUrl, style: 'primary' },
      ],
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Approve from phone: \`/approve ${opts.runId}\` · Reject: \`/reject ${opts.runId} <reason>\`` }] },
  ]
}

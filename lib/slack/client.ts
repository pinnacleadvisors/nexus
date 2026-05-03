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
 * Verify a Slack incoming-webhook URL is reachable by POSTing a small
 * confirmation message. Used by /api/businesses on save (PR 4 of
 * task_plan-ux-security-onboarding.md) so the operator immediately knows
 * if the URL is wrong — instead of waiting until the next 04:00 UTC operator
 * digest fails silently.
 *
 * Returns `{ ok: true }` on 2xx, `{ ok: false, error }` otherwise.
 *
 * Defence-in-depth note: this calls a user-supplied URL. Slack webhook URLs
 * are always `https://hooks.slack.com/services/...`. We enforce the prefix
 * before issuing the request to prevent SSRF onto internal hosts.
 */
export async function postVerification(
  webhookUrl: string,
  businessName?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!/^https:\/\/hooks\.slack\.com\//.test(webhookUrl)) {
    return { ok: false, error: 'webhook_url must be https://hooks.slack.com/services/...' }
  }
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '✅ Nexus connected' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: businessName
          ? `Connected to *${businessName}*. This channel will receive daily operator digests, approval requests, and run summaries.`
          : 'This channel will receive daily operator digests, approval requests, and run summaries.',
      },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Verification sent at ${new Date().toISOString()}` }],
    },
  ]
  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: '✅ Nexus connected', blocks }),
    })
    if (res.ok) return { ok: true }
    const text = await res.text().catch(() => '')
    return { ok: false, error: `slack_${res.status}${text ? `: ${text.slice(0, 80)}` : ''}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network_error' }
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

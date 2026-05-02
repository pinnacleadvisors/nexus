/**
 * POST /api/slack/decision
 *
 * Slack interactivity webhook — handles Approve / Reject button clicks from
 * the daily business-operator digest. Slack posts an
 * application/x-www-form-urlencoded body with a `payload` field containing
 * the interaction JSON; we verify the X-Slack-Signature header against
 * NEXUS_SLACK_SIGNING_SECRET before acting.
 *
 * Phase A — minimal: verify signature, log the decision, ack with an ephemeral
 * Slack reply that updates the message. Phase B will:
 *   - persist the approval to a `business_decisions` table
 *   - advance the linked Run / dispatch the gated action
 *   - link to the Board review modal for richer review
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifySlackSignature } from '@/lib/slack/client'

export const runtime = 'nodejs'

interface SlackInteraction {
  type:    string
  team?:   { id: string; domain: string }
  user?:   { id: string; name: string }
  actions?: Array<{
    action_id:  string
    value:      string
    text?:      { text: string }
  }>
  channel?: { id: string; name: string }
  message?: { ts: string }
  response_url?: string
}

export async function POST(req: NextRequest) {
  const signingSecret = process.env.NEXUS_SLACK_SIGNING_SECRET
  if (!signingSecret) {
    return NextResponse.json({ ok: false, error: 'slack_not_configured' }, { status: 503 })
  }

  const rawBody  = await req.text()
  const ts       = req.headers.get('x-slack-request-timestamp') ?? ''
  const sig      = req.headers.get('x-slack-signature') ?? ''

  const valid = verifySlackSignature({
    body:          rawBody,
    timestamp:     ts,
    signature:     sig,
    signingSecret,
  })
  if (!valid) {
    return NextResponse.json({ ok: false, error: 'bad_signature' }, { status: 401 })
  }

  // Slack interactivity payloads come as form-encoded `payload=<json>`
  const params = new URLSearchParams(rawBody)
  const payloadRaw = params.get('payload')
  if (!payloadRaw) {
    return NextResponse.json({ ok: false, error: 'no_payload' }, { status: 400 })
  }

  let payload: SlackInteraction
  try {
    payload = JSON.parse(payloadRaw) as SlackInteraction
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_payload' }, { status: 400 })
  }

  const action = payload.actions?.[0]
  if (!action) {
    return NextResponse.json({ ok: false, error: 'no_action' }, { status: 400 })
  }

  // value is `<businessSlug>|<base64-of-action-title>`
  const [businessSlug = '', actionTitleB64 = ''] = action.value.split('|')
  let actionTitle = ''
  try { actionTitle = Buffer.from(actionTitleB64, 'base64').toString('utf8') } catch { /* leave empty */ }

  const decision = action.action_id === 'biz_op_approve' ? 'approved' : 'rejected'
  const baseUrl  = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const boardUrl = `${baseUrl}/board?business=${encodeURIComponent(businessSlug)}`

  console.log(
    `[slack-decision] business=${businessSlug} decision=${decision} ` +
    `user=${payload.user?.name ?? 'unknown'} title=${JSON.stringify(actionTitle)}`,
  )

  // Acknowledge inline by updating the original message via response_url.
  // Phase B: persist to a decisions table + advance the Run controller.
  if (payload.response_url) {
    void fetch(payload.response_url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replace_original: false,
        response_type:    'ephemeral',
        text: decision === 'approved'
          ? `✅ Approved by <@${payload.user?.id}>: ${actionTitle}`
          : `❌ Rejected by <@${payload.user?.id}>: ${actionTitle}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: decision === 'approved'
                ? `*Approved* by <@${payload.user?.id}>\n${actionTitle}\n\n_Phase A: logged. Phase B will dispatch the gated action automatically._`
                : `*Rejected* by <@${payload.user?.id}>\n${actionTitle}\n\n_Operator will not retry without further direction._`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Open Board' },
                url:  boardUrl,
              },
            ],
          },
        ],
      }),
    }).catch(err => console.warn('[slack-decision] response_url post failed:', err))
  }

  // Slack expects HTTP 200 within 3s; we've already kicked off response_url async.
  return NextResponse.json({ ok: true })
}

/**
 * POST /api/experiments/gate-respond — D3 (gate-respond half).
 *
 * Slack hits this route when the operator clicks Approve or Reject on the
 * inline buttons posted by `/api/experiments/gate-request`. Slack signs the
 * request — we verify with the canonical helper in `lib/slack/client.ts`
 * (HMAC-SHA256 of `v0:<timestamp>:<rawBody>` against `NEXUS_SLACK_SIGNING_SECRET`,
 * 5-minute clock-skew tolerance). Same signing pattern as `/api/slack/decision`.
 *
 * Side effects:
 *   1. Parse `actions[0].value` — JSON `{ rowId, outcome }`.
 *   2. Update the matching `experiment_metrics` row's payload — set
 *      `outcome`, `approved_by` (slack user id), `responded_at`. We use the
 *      same untyped shim pattern as the cron routes since
 *      `experiment_metrics` (migration 034) isn't in the generated Supabase
 *      types yet.
 *   3. Return Slack's `replace_original: true` body so the buttons disappear
 *      and a "Resolved by @user" banner replaces them.
 *
 * Edge cases:
 *   - `rowId` not found → 200 + ephemeral "Gate already resolved or not found".
 *   - row's outcome is already `approved`/`rejected` → 200 + ephemeral
 *     "Gate already resolved" (don't double-fire).
 *
 * Auth: Slack signing only. No Clerk session — Slack hits this anonymously.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { verifySlackSignature } from '@/lib/slack/client'

export const runtime = 'nodejs'

interface SlackInteraction {
  type:    string
  user?:   { id: string; name?: string }
  actions?: Array<{
    action_id:  string
    value:      string
  }>
  response_url?: string
}

interface ButtonValue {
  rowId:   string
  outcome: 'approved' | 'rejected'
}

// ── Helpers ────────────────────────────────────────────────────────────────

interface GateEventRow {
  id:      string
  payload: Record<string, unknown> | null
}

async function loadGateEvent(rowId: string): Promise<GateEventRow | null> {
  const db = createServerClient()
  if (!db) return null
  try {
    type AnyQuery = {
      eq:          (c: string, v: string) => AnyQuery
      maybeSingle: () => Promise<{ data: GateEventRow | null; error: unknown }>
    }
    const q = (db as unknown as {
      from: (t: string) => { select: (c: string) => AnyQuery }
    }).from('experiment_metrics').select('id,payload').eq('id', rowId)
    const result = await q.maybeSingle()
    if (result.error) return null
    return result.data
  } catch {
    return null
  }
}

async function updateGateEvent(
  rowId: string,
  newPayload: Record<string, unknown>,
): Promise<boolean> {
  const db = createServerClient()
  if (!db) return false
  try {
    type AnyUpdate = {
      eq: (c: string, v: string) => Promise<{ error: unknown }>
    }
    const result = await (db.from('experiment_metrics' as never) as unknown as {
      update: (rec: unknown) => AnyUpdate
    }).update({ payload: newPayload }).eq('id', rowId)
    return !result.error
  } catch (err) {
    console.error('[gate-respond] updateGateEvent failed:', err)
    return false
  }
}

// ── Slack response bodies ──────────────────────────────────────────────────

function ephemeralReply(text: string): NextResponse {
  return NextResponse.json({
    response_type:    'ephemeral',
    replace_original: false,
    text,
  })
}

function resolvedBlocks(opts: {
  gate:     string | null
  outcome:  'approved' | 'rejected'
  userId:   string
  rowId:    string
}): unknown[] {
  const verb = opts.outcome === 'approved' ? ':white_check_mark: *Approved*' : ':x: *Rejected*'
  const gateLine = opts.gate ? ` · gate \`${opts.gate}\`` : ''
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${verb} by <@${opts.userId}>${gateLine}\n_Resolved gate_event \`${opts.rowId.slice(0, 8)}\`._`,
      },
    },
  ]
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const signingSecret = process.env.NEXUS_SLACK_SIGNING_SECRET
  if (!signingSecret) {
    return NextResponse.json({ ok: false, error: 'slack_not_configured' }, { status: 503 })
  }

  const rawBody = await req.text()
  const ts      = req.headers.get('x-slack-request-timestamp') ?? ''
  const sig     = req.headers.get('x-slack-signature')          ?? ''

  if (!ts || !sig) {
    return NextResponse.json({ ok: false, error: 'missing_signature' }, { status: 401 })
  }
  const valid = verifySlackSignature({
    body:          rawBody,
    timestamp:     ts,
    signature:     sig,
    signingSecret,
  })
  if (!valid) {
    return NextResponse.json({ ok: false, error: 'bad_signature' }, { status: 401 })
  }

  // Slack interactive payloads come as form-encoded `payload=<json>`.
  const params     = new URLSearchParams(rawBody)
  const payloadRaw = params.get('payload')
  if (!payloadRaw) {
    return NextResponse.json({ ok: false, error: 'no_payload' }, { status: 400 })
  }

  let interaction: SlackInteraction
  try { interaction = JSON.parse(payloadRaw) as SlackInteraction }
  catch { return NextResponse.json({ ok: false, error: 'bad_payload' }, { status: 400 }) }

  const action = interaction.actions?.[0]
  if (!action) return ephemeralReply('No action in payload.')

  let parsed: ButtonValue
  try { parsed = JSON.parse(action.value) as ButtonValue }
  catch { return ephemeralReply('Malformed button value — gate cannot be resolved.') }

  if (typeof parsed.rowId !== 'string' || !parsed.rowId) {
    return ephemeralReply('Missing rowId in button value.')
  }
  if (parsed.outcome !== 'approved' && parsed.outcome !== 'rejected') {
    return ephemeralReply('Outcome must be approved or rejected.')
  }

  const slackUserId = interaction.user?.id ?? 'unknown'
  const respondedAt = new Date().toISOString()

  // Look up the row; surface row-not-found / already-resolved as ephemerals
  // (Slack expects 200 — anything else triggers a retry storm).
  const existing = await loadGateEvent(parsed.rowId)
  if (!existing) {
    return ephemeralReply(`Gate already resolved or not found (id ${parsed.rowId.slice(0, 8)}).`)
  }
  const oldPayload = existing.payload ?? {}
  const currentOutcome = oldPayload.outcome
  if (currentOutcome === 'approved' || currentOutcome === 'rejected') {
    return ephemeralReply(`Gate already resolved (${String(currentOutcome)}).`)
  }

  const newPayload: Record<string, unknown> = {
    ...oldPayload,
    outcome:      parsed.outcome,
    approved_by:  slackUserId,
    responded_at: respondedAt,
  }

  const ok = await updateGateEvent(parsed.rowId, newPayload)
  if (!ok) {
    return ephemeralReply('Failed to record decision — please retry from the dashboard.')
  }

  // Replace the original message so the buttons disappear and the operator
  // sees the resolution banner immediately.
  const gateName = typeof oldPayload.gate === 'string' ? (oldPayload.gate as string) : null
  return NextResponse.json({
    replace_original: true,
    response_type:    'in_channel',
    text:             `${parsed.outcome === 'approved' ? 'Approved' : 'Rejected'} by <@${slackUserId}>`,
    blocks: resolvedBlocks({
      gate:    gateName,
      outcome: parsed.outcome,
      userId:  slackUserId,
      rowId:   parsed.rowId,
    }),
  })
}

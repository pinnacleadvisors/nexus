/**
 * POST /api/experiments/gate-request — D3 (gate-request half).
 *
 * Called by the `solopreneur-loop` agent when it wants to take an action that
 * falls under one of the 5 strategic gates declared in
 * `docs/runbooks/solopreneur-experiment.md`. Server side:
 *
 *   1. Insert a `kind=gate_event` row into `experiment_metrics` with
 *      payload.outcome = 'pending'. Row id is the correlation handle.
 *   2. Post a Slack incoming-webhook message with Block Kit Approve / Reject
 *      buttons. Each button's `value` carries `{ rowId, outcome }` so the
 *      gate-respond route can find the row without a separate lookup table.
 *   3. Return `{ ok, gateEventId, slackTs }` so the agent can correlate the
 *      decision when it arrives later.
 *
 * Idempotency — if a `pending` gate_event already exists for `(slug, gate)`
 * with a payload-content hash matching the new request, return the existing
 * id with `alreadyPending: true` instead of creating a duplicate. This stops
 * a retried tick from spamming the Slack channel with re-prompts.
 *
 * Auth — Clerk session OR `Authorization: Bearer ${NEXUS_OPS_TOKEN}`. The
 * cron-dispatched agent will use the bearer token. See
 * `lib/auth/ops-auth.ts authenticateOps` (same pattern as the provision
 * route).
 *
 * Slack — uses the existing `getSlackConfig` + `postSlackNotification`
 * helpers in `lib/slack/client.ts`. Incoming webhooks pin a single channel,
 * so `SLACK_EXPERIMENT_CHANNEL_ID` is informational only — message routing
 * is determined by the webhook URL the operator pasted.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createServerClient } from '@/lib/supabase'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { getSlackConfig, postSlackNotification } from '@/lib/slack/client'

export const runtime = 'nodejs'

const VALID_GATES = [
  'niche_pick',
  'domain_purchase',
  'first_n_posts',
  'paid_saas_signup',
  'pricing_change',
] as const
type Gate = (typeof VALID_GATES)[number]

interface GateRequestBody {
  slug?:    string
  gate?:    string
  payload?: Record<string, unknown>
  userId?:  string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isValidGate(g: unknown): g is Gate {
  return typeof g === 'string' && (VALID_GATES as readonly string[]).includes(g)
}

/** Stable hash of the request payload so retries collapse onto one gate. */
function hashPayload(p: Record<string, unknown>): string {
  // JSON.stringify with sorted keys gives a deterministic representation.
  const sortKeys = (obj: unknown): unknown => {
    if (Array.isArray(obj)) return obj.map(sortKeys)
    if (obj && typeof obj === 'object') {
      return Object.keys(obj as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sortKeys((obj as Record<string, unknown>)[k])
          return acc
        }, {})
    }
    return obj
  }
  return createHash('sha256').update(JSON.stringify(sortKeys(p))).digest('hex')
}

interface GateEventRow {
  id:      string
  payload: Record<string, unknown> | null
}

async function findPendingDuplicate(
  slug: string,
  gate: Gate,
  payloadHash: string,
): Promise<string | null> {
  const db = createServerClient()
  if (!db) return null
  try {
    type AnyQuery = {
      eq:    (c: string, v: string) => AnyQuery
      order: (c: string, opts: { ascending: boolean }) => AnyQuery
      limit: (n: number) => AnyQuery
      then:  Promise<{ data: GateEventRow[] | null; error: unknown }>['then']
    }
    const q = (db as unknown as {
      from: (t: string) => { select: (c: string) => AnyQuery }
    }).from('experiment_metrics').select('id,payload')
      .eq('business_slug', slug)
      .eq('kind', 'gate_event')
      .order('ts', { ascending: false })
      .limit(50)
    const result = (await q) as { data: GateEventRow[] | null; error: unknown }
    if (result.error || !result.data) return null
    for (const row of result.data) {
      const p = row.payload ?? {}
      if (p.gate !== gate) continue
      if (p.outcome !== 'pending') continue
      if (p.request_hash === payloadHash) return row.id
    }
    return null
  } catch {
    return null
  }
}

async function insertGateEvent(
  slug: string,
  gate: Gate,
  request: Record<string, unknown>,
  payloadHash: string,
): Promise<string | null> {
  const db = createServerClient()
  if (!db) return null
  try {
    const result = (await (db.from('experiment_metrics' as never) as unknown as {
      insert: (rec: unknown) => {
        select: (c: string) => {
          single: () => Promise<{ data: { id: string } | null; error: unknown }>
        }
      }
    }).insert({
      business_slug: slug,
      kind:          'gate_event',
      payload: {
        gate,
        request,
        request_hash: payloadHash,
        outcome:      'pending',
        requested_at: new Date().toISOString(),
      },
    }).select('id').single()) as { data: { id: string } | null; error: unknown }
    if (result.error || !result.data) return null
    return result.data.id
  } catch (err) {
    console.error('[gate-request] insertGateEvent failed:', err)
    return null
  }
}

// ── Slack message body ─────────────────────────────────────────────────────

const GATE_LABELS: Record<Gate, string> = {
  niche_pick:        'Niche pick',
  domain_purchase:   'Domain purchase',
  first_n_posts:     'First N posts',
  paid_saas_signup:  'Paid SaaS signup',
  pricing_change:    'Pricing change',
}

function summarisePayload(p: Record<string, unknown>): string {
  // Best-effort 1-liner; the full payload is in the gate_event row.
  const cap = (s: string) => s.length > 240 ? `${s.slice(0, 240)}…` : s
  try {
    const compact = JSON.stringify(p)
    return cap(compact)
  } catch {
    return '(unserialisable payload)'
  }
}

function buildBlocks(opts: {
  slug:     string
  gate:     Gate
  rowId:    string
  payload:  Record<string, unknown>
}): unknown[] {
  const label = GATE_LABELS[opts.gate]
  const summary = summarisePayload(opts.payload)
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `:door: *${label} proposed* — \`${opts.slug}\`` } },
    { type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${summary}\`\`\`` } },
    {
      type: 'actions',
      block_id: `gate_event:${opts.rowId}`,
      elements: [
        {
          type:      'button',
          action_id: 'experiment_gate_approve',
          style:     'primary',
          text:      { type: 'plain_text', text: 'Approve' },
          value:     JSON.stringify({ rowId: opts.rowId, outcome: 'approved' }),
        },
        {
          type:      'button',
          action_id: 'experiment_gate_reject',
          style:     'danger',
          text:      { type: 'plain_text', text: 'Reject' },
          value:     JSON.stringify({ rowId: opts.rowId, outcome: 'rejected' }),
        },
      ],
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `gate_event \`${opts.rowId.slice(0, 8)}\` · gate \`${opts.gate}\` · auto-expires after 24h` },
      ],
    },
  ]
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: GateRequestBody
  try { body = (await req.json()) as GateRequestBody }
  catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }) }

  const slug    = typeof body.slug === 'string' ? body.slug.trim() : ''
  const gate    = body.gate
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}

  if (!slug)            return NextResponse.json({ ok: false, error: 'slug required' }, { status: 400 })
  if (!isValidGate(gate)) return NextResponse.json({ ok: false, error: `gate must be one of ${VALID_GATES.join(',')}` }, { status: 400 })

  const a = await authenticateOps(req, { bodyUserId: body.userId })
  if ('response' in a) return a.response

  // Idempotency — collapse retries onto the existing pending row.
  const requestHash = hashPayload(payload)
  const existingId  = await findPendingDuplicate(slug, gate, requestHash)
  if (existingId) {
    return NextResponse.json({ ok: true, gateEventId: existingId, alreadyPending: true })
  }

  const rowId = await insertGateEvent(slug, gate, payload, requestHash)
  if (!rowId) {
    return NextResponse.json({ ok: false, error: 'gate_event_insert_failed' }, { status: 500 })
  }

  // Post Slack notification — best-effort. Even if Slack is misconfigured the
  // gate_event row is still tracked; the operator can resolve it manually via
  // the dashboard.
  const slackCfg = await getSlackConfig(a.userId)
  const blocks = buildBlocks({ slug, gate, rowId, payload })
  const fallbackText = `Gate request: ${GATE_LABELS[gate]} for ${slug}`
  const posted = await postSlackNotification(slackCfg, { text: fallbackText, blocks })

  // Incoming webhooks don't return a message ts — surface posted=true instead
  // so the agent knows the Slack hop succeeded. slackTs stays null.
  return NextResponse.json({
    ok:           true,
    gateEventId:  rowId,
    slackTs:      null,
    slackPosted:  posted,
    channelHint:  process.env.SLACK_EXPERIMENT_CHANNEL_ID ?? null,
  })
}

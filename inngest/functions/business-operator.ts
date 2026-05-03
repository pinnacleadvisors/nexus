/**
 * Phase A — daily Business Operator cron.
 *
 * 04:00 UTC = 11:00 ICT. For each active business, dispatch the
 * `business-operator` agent (sonnet) via the claude-gateway, parse its
 * structured JSON output, and post a Slack digest to the business's
 * channel with inline Approve / Reject buttons for any gated actions.
 *
 * This function does NOT yet advance Run phases or fire sub-dispatches —
 * Phase A surfaces the operator's plan to the human; Phase B wires
 * approval-gated execution back into the Run controller.
 */

import { inngest } from '@/inngest/client'
import { listActiveBusinesses } from '@/lib/business/db'
import { callGateway } from '@/lib/claw/gateway-call'
import type { BusinessRow } from '@/lib/business/types'

interface OperatorAction {
  kind:               string
  title:              string
  rationale:          string
  gateway:            string
  params:             unknown
  requires_approval:  boolean
  estimated_usd:      number
}

interface OperatorPlan {
  summary:           string
  yesterday_shipped: string[]
  yesterday_blocked: string[]
  today_actions:     OperatorAction[]
  tomorrow_seed:     string
  kpi_delta:         Record<string, number>
}

function buildOperatorPrompt(biz: BusinessRow): string {
  // Strip secrets from the row before handing to the model.
  const ctx = {
    slug:                  biz.slug,
    name:                  biz.name,
    status:                biz.status,
    brand_voice:           biz.brand_voice,
    timezone:              biz.timezone,
    daily_cron_local_hour: biz.daily_cron_local_hour,
    niche:                 biz.niche,
    money_model:           biz.money_model,
    kpi_targets:           biz.kpi_targets,
    approval_gates:        biz.approval_gates,
    current_run_id:        biz.current_run_id,
    last_operator_at:      biz.last_operator_at,
  }
  // Phase A — upstream is empty; Phase B wires memory + run_events here.
  const upstream = {
    day_in_run: biz.last_operator_at
      ? Math.floor((Date.now() - new Date(biz.last_operator_at).getTime()) / 86_400_000) || 1
      : 1,
    note: 'Phase A — memory + run_events will be threaded in Phase B; plan against the row alone.',
  }
  return [
    'You are running a daily cycle for the business below.',
    'Follow your spec at .claude/agents/business-operator.md.',
    'Return ONLY the JSON object described in your output contract — no prose, no markdown fences.',
    '',
    'inputs.business:',
    JSON.stringify(ctx, null, 2),
    '',
    'inputs.upstream:',
    JSON.stringify(upstream, null, 2),
  ].join('\n')
}

function parseOperatorOutput(raw: string): OperatorPlan | null {
  // Operator may wrap output in ```json fences despite instructions; tolerate it.
  const stripped = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  try {
    const parsed = JSON.parse(stripped) as Partial<OperatorPlan>
    if (!parsed.summary || !Array.isArray(parsed.today_actions)) return null
    return {
      summary:           parsed.summary,
      yesterday_shipped: parsed.yesterday_shipped ?? [],
      yesterday_blocked: parsed.yesterday_blocked ?? [],
      today_actions:     parsed.today_actions ?? [],
      tomorrow_seed:     parsed.tomorrow_seed ?? '',
      kpi_delta:         parsed.kpi_delta ?? {},
    }
  } catch {
    return null
  }
}

interface SlackBlock {
  type:     string
  text?:    { type: string; text: string }
  elements?: unknown[]
  fields?:   { type: string; text: string }[]
}

function buildDigestBlocks(biz: BusinessRow, plan: OperatorPlan): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${biz.name} — daily operator` },
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*Today*\n${plan.summary}` } },
  ]

  if (plan.yesterday_shipped.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Shipped yesterday*\n' + plan.yesterday_shipped.map(s => `• ${s}`).join('\n') },
    })
  }
  if (plan.yesterday_blocked.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Blocked*\n' + plan.yesterday_blocked.map(s => `• ${s}`).join('\n') },
    })
  }

  blocks.push({ type: 'divider' })

  for (const action of plan.today_actions) {
    const header = action.requires_approval ? `🟡 *${action.title}*` : `🟢 *${action.title}*`
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `${header}\n` +
          `_${action.rationale}_\n` +
          `\`gateway: ${action.gateway} · est: $${action.estimated_usd.toFixed(2)} · kind: ${action.kind}\``,
      },
    })
    if (action.requires_approval) {
      const value = `${biz.slug}|${Buffer.from(action.title).toString('base64').slice(0, 80)}`
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            style: 'primary',
            action_id: 'biz_op_approve',
            value,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Reject' },
            style: 'danger',
            action_id: 'biz_op_reject',
            value,
          },
        ],
      })
    }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Open Board' },
        url: `${baseUrl}/board?business=${encodeURIComponent(biz.slug)}`,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Edit business' },
        url: `${baseUrl}/settings/businesses?slug=${encodeURIComponent(biz.slug)}`,
      },
    ],
  })

  return blocks
}

async function postBusinessSlack(biz: BusinessRow, blocks: SlackBlock[], headline: string): Promise<boolean> {
  if (!biz.slack_webhook_url) return false
  try {
    const res = await fetch(biz.slack_webhook_url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: headline, blocks }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function runForBusiness(
  step: Record<string, (id: string, fn: () => Promise<unknown>) => Promise<unknown>>,
  biz: BusinessRow,
): Promise<unknown> {
  const gatewayUrl  = process.env.CLAUDE_CODE_GATEWAY_URL
  const bearerToken = process.env.CLAUDE_CODE_BEARER_TOKEN
  if (!gatewayUrl || !bearerToken) {
    return { skipped: true, reason: 'claude-gateway not configured' }
  }

  const dispatch = await step['run'](`dispatch-${biz.slug}`, async () => {
    return await callGateway({
      gatewayUrl,
      bearerToken,
      sessionTag: `business-operator-${biz.slug}-${Date.now()}`,
      message:    buildOperatorPrompt(biz),
      agentSlug:  'business-operator',
      env:        {},
      userId:     biz.user_id,
      timeoutMs:  120_000,
    })
  }) as Awaited<ReturnType<typeof callGateway>>

  if (!dispatch.ok) {
    await step['run'](`slack-error-${biz.slug}`, async () =>
      postBusinessSlack(
        biz,
        [{ type: 'section', text: { type: 'mrkdwn', text:
          `:rotating_light: *${biz.name}* — operator dispatch failed (HTTP ${dispatch.status}): \`${dispatch.error ?? 'unknown'}\`` } }],
        `${biz.name} operator failed`,
      ))
    return { dispatched: false, error: dispatch.error }
  }

  const plan = parseOperatorOutput(dispatch.text)
  if (!plan) {
    await step['run'](`slack-parse-${biz.slug}`, async () =>
      postBusinessSlack(
        biz,
        [{ type: 'section', text: { type: 'mrkdwn', text:
          `:warning: *${biz.name}* — operator returned non-JSON output. First 800 chars:\n\`\`\`${dispatch.text.slice(0, 800)}\`\`\`` } }],
        `${biz.name} operator output unparseable`,
      ))
    return { dispatched: true, parsed: false }
  }

  const blocks = buildDigestBlocks(biz, plan)
  const posted = await step['run'](`slack-${biz.slug}`, async () =>
    postBusinessSlack(biz, blocks, `${biz.name} — ${plan.summary}`))

  return {
    dispatched: true,
    parsed: true,
    actions: plan.today_actions.length,
    posted,
  }
}

export const businessOperatorDaily = inngest.createFunction(
  {
    id:   'business-operator-daily',
    name: 'Business Operator — daily cycle (per active business)',
    // retries: 1 — the daily cycle dispatches Claude through the gateway.
    // Default 3 retries × N businesses × Max-plan tokens = expensive on a
    // flaky gateway. One retry catches transient flakes; further failures
    // skip until tomorrow rather than burning the plan. See
    // docs/RETRY_STORM_AUDIT.md finding 2.
    retries: 1,
    triggers: [{ cron: '0 4 * * *' }],   // 04:00 UTC = 11:00 ICT
  },
  async ({ step }: { step: Record<string, (id: string, fn: () => Promise<unknown>) => Promise<unknown>> }) => {
    const businesses = await step['run']('list-active-businesses', async () => {
      return listActiveBusinesses()
    }) as BusinessRow[]

    const results: unknown[] = []
    for (const biz of businesses) {
      results.push({ slug: biz.slug, result: await runForBusiness(step, biz) })
    }
    return { ranAt: new Date().toISOString(), businesses: businesses.length, results }
  },
)

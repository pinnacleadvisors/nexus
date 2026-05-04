/**
 * Slack war-room fan-out — Mission Control Kit Pack 01 ported to Slack.
 *
 * Triggered by `slack/warroom.fanout` events from /api/webhooks/slack when
 * the operator types `/standup`, `/discuss <q>`, or `/ask <q>`. Slack expects
 * the slash-command HTTP response within 3 s, so the receiving route just
 * acks "queued" and lets this function do the heavy multi-agent work async.
 *
 * Patterns:
 *   /standup         — every active business posts its current operator plan
 *                      summary in one threaded reply (no LLM cost — reads
 *                      the last business_operator output from memory).
 *   /discuss <q>     — three specialist roles (researcher, analyst,
 *                      strategist) each weigh in on the question via
 *                      tryGateway; a final consolidator (Sonnet) synthesises
 *                      under a single thread.
 *   /ask <q>         — single-agent shortcut. Routes to the lead operator.
 *
 * All replies use Slack's `response_url` (incoming webhook proxy) so they
 * appear in the same channel as the slash command. Responses are gated by
 * the `slack_warroom` and `llm_dispatch` kill switches, and scrubbed by the
 * exfiltration guard before they leave.
 */

import { inngest } from '@/inngest/client'
import { listActiveBusinesses } from '@/lib/business/db'
import { tryGateway } from '@/lib/claw/llm'
import { isEnabled as isKillSwitchEnabled } from '@/lib/kill-switches'
import { checkExfilSafe } from '@/lib/security/exfil-guard'

interface FanoutEvent {
  data: {
    command:     'standup' | 'discuss' | 'ask'
    text:        string
    userId:      string
    slackUserId: string
    channelId:   string
    responseUrl: string
  }
}

interface SlackBlock { type: string; text?: { type: string; text: string }; elements?: unknown[] }
type StepFn = Record<string, (id: string, fn: () => Promise<unknown>) => Promise<unknown>>

async function postViaResponseUrl(responseUrl: string, payload: { text: string; blocks?: SlackBlock[]; replace_original?: boolean }): Promise<boolean> {
  if (!responseUrl) return false
  if (!checkExfilSafe([payload.text, JSON.stringify(payload.blocks ?? '')].join('\n'), { surface: 'slack.warroom_reply' })) return false
  try {
    const res = await fetch(responseUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ response_type: 'in_channel', ...payload }),
      signal:  AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}

const STANDUP_LIMIT_AGENTS = 8
const DISCUSS_AGENTS = ['researcher', 'analyst', 'strategist'] as const
const PER_AGENT_TIMEOUT_MS = 45_000
const CONSOLIDATOR_TIMEOUT_MS = 60_000

export const slackWarroomFanout = inngest.createFunction(
  {
    id:   'slack-warroom-fanout',
    name: 'Slack war-room fan-out (/standup, /discuss, /ask)',
    // retries: 0 — we never want to dispatch the same multi-agent fan-out
    // twice. If something failed, the operator can re-run the slash command.
    retries: 0,
    triggers: [{ event: 'slack/warroom.fanout' }],
  },
  async ({ event, step }: { event: FanoutEvent; step: StepFn }) => {
    const { command, text, userId, responseUrl } = event.data

    // Hot kill-switch checks — this runs ~1-3s after the user typed the
    // command, plenty of time for them to flip the switch.
    if (!(await isKillSwitchEnabled('slack_warroom'))) {
      await postViaResponseUrl(responseUrl, { text: ':no_entry: slack_warroom kill switch is disabled' })
      return { skipped: 'slack_warroom disabled' }
    }
    if (command !== 'standup' && !(await isKillSwitchEnabled('llm_dispatch'))) {
      await postViaResponseUrl(responseUrl, { text: ':no_entry: llm_dispatch kill switch is disabled — discussion needs LLM access' })
      return { skipped: 'llm_dispatch disabled' }
    }

    if (command === 'standup') {
      return runStandup(step, userId, responseUrl)
    }
    if (command === 'discuss') {
      if (!text) {
        await postViaResponseUrl(responseUrl, { text: 'usage: `/discuss <question>`' })
        return { skipped: 'no question' }
      }
      return runDiscuss(step, userId, text, responseUrl)
    }
    if (command === 'ask') {
      if (!text) {
        await postViaResponseUrl(responseUrl, { text: 'usage: `/ask <question>`' })
        return { skipped: 'no question' }
      }
      return runAsk(step, userId, text, responseUrl)
    }
    return { skipped: 'unknown command' }
  },
)

// ── /standup ─────────────────────────────────────────────────────────────────
async function runStandup(step: StepFn, userId: string, responseUrl: string): Promise<unknown> {
  const businesses = await step['list-businesses'](
    'list-businesses',
    async () => listActiveBusinesses(),
  ) as Awaited<ReturnType<typeof listActiveBusinesses>>

  const limited = businesses.slice(0, STANDUP_LIMIT_AGENTS)
  if (!limited.length) {
    await postViaResponseUrl(responseUrl, { text: 'no active businesses to stand up' })
    return { posted: 0 }
  }

  const blocks: SlackBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: ':rocket: Daily standup' } },
  ]
  for (const biz of limited) {
    const last = biz.last_operator_at
      ? new Date(biz.last_operator_at).toLocaleString()
      : 'never'
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${biz.name}*  \`${biz.slug}\`\n_status: ${biz.status} · last operator run: ${last}_\n${biz.niche || '_no niche set_'}`,
      },
    })
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `${limited.length} business${limited.length === 1 ? '' : 'es'} reporting` }] })
  await postViaResponseUrl(responseUrl, { text: 'Daily standup', blocks })
  return { posted: limited.length }
}

// ── /discuss ─────────────────────────────────────────────────────────────────
async function runDiscuss(step: StepFn, userId: string, question: string, responseUrl: string): Promise<unknown> {
  const responses: Array<{ role: string; text: string }> = []
  for (const role of DISCUSS_AGENTS) {
    const out = await step['run'](`discuss-${role}`, async () => {
      const result = await tryGateway({
        userId,
        prompt: `The operator asked: ${question}\n\nFrom your perspective as a ${role}, give your take in 3-5 sentences.`,
        sessionTag: `warroom-discuss-${role}`,
        timeoutMs: PER_AGENT_TIMEOUT_MS,
      })
      return result.ok && result.text ? result.text.trim() : `(${role} skipped: gateway unavailable)`
    }) as string
    responses.push({ role, text: out })
  }

  const blocks: SlackBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: ':speech_balloon: War-room discussion' } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Question:* ${question}` } },
    { type: 'divider' },
  ]
  for (const r of responses) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${r.role}*\n${r.text.slice(0, 1500)}` },
    })
  }

  // Consolidator — synthesise the three responses.
  const consolidated = await step['run']('discuss-consolidator', async () => {
    const result = await tryGateway({
      userId,
      prompt:
        `Three specialists weighed in on the operator's question. Synthesise their takes into a single recommendation in 4-6 sentences. Prefer concrete next steps over restating their points.\n\n` +
        `Question: ${question}\n\n` +
        responses.map(r => `[${r.role}]\n${r.text}`).join('\n\n'),
      sessionTag: 'warroom-discuss-consolidator',
      timeoutMs:  CONSOLIDATOR_TIMEOUT_MS,
    })
    return result.ok && result.text ? result.text.trim() : '(consolidator unavailable)'
  }) as string

  blocks.push({ type: 'divider' })
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `:bulb: *Synthesis*\n${consolidated.slice(0, 2500)}` } })
  await postViaResponseUrl(responseUrl, { text: `War-room: ${question.slice(0, 80)}`, blocks })
  return { agents: responses.length }
}

// ── /ask ─────────────────────────────────────────────────────────────────────
async function runAsk(step: StepFn, userId: string, question: string, responseUrl: string): Promise<unknown> {
  const out = await step['run']('ask-lead', async () => {
    const result = await tryGateway({
      userId,
      prompt: question,
      sessionTag: 'warroom-ask',
      timeoutMs: CONSOLIDATOR_TIMEOUT_MS,
    })
    return result.ok && result.text ? result.text.trim() : '(lead operator unavailable)'
  }) as string

  await postViaResponseUrl(responseUrl, {
    text: `Ask: ${question.slice(0, 80)}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*Q:* ${question}` } },
      { type: 'section', text: { type: 'mrkdwn', text: out.slice(0, 2800) } },
    ],
  })
  return { ok: true }
}

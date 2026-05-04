/**
 * POST /api/webhooks/slack — E7/E8 inbound slash command receiver.
 *
 * Slack POSTs application/x-www-form-urlencoded bodies for slash commands
 * with these fields: token, team_id, user_id, command, text, response_url.
 * Verifies via X-Slack-Signature (HMAC over `v0:<timestamp>:<rawBody>`).
 *
 * Supported commands:
 *   /approve   <runId>            advance run to next phase
 *   /reject    <runId> <reason>   set run status='blocked', append reason
 *   /condition <runId>            return current phase + 5 most recent events
 *                                 (named `/condition` because Slack reserves `/status`)
 *
 * The Slack user is mapped to a Nexus user by:
 *   1. SLACK_USER_<id> env var pointing to a Clerk user ID, OR
 *   2. ALLOWED_USER_IDS list (single-owner setups), defaulting to the first.
 *
 * Replies use response_url with response_type: 'ephemeral' so only the caller
 * sees the result.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifySlackSignature, getSlackConfig } from '@/lib/slack/client'
import { advancePhase, getRun, listEvents, nextPhase, setStatus } from '@/lib/runs/controller'
import { audit } from '@/lib/audit'
import { isEnabled as isKillSwitchEnabled } from '@/lib/kill-switches'
import { inngest } from '@/inngest/client'

export const runtime = 'nodejs'

function resolveNexusUser(slackUserId: string): string | null {
  const direct = process.env[`SLACK_USER_${slackUserId.toUpperCase()}`]
  if (direct) return direct
  const allowed = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return allowed[0] ?? null
}

interface SlackResponse { response_type: 'ephemeral' | 'in_channel'; text: string }

function reply(text: string, type: 'ephemeral' | 'in_channel' = 'ephemeral'): NextResponse {
  const body: SlackResponse = { response_type: type, text }
  return NextResponse.json(body)
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const ts  = req.headers.get('x-slack-request-timestamp') ?? ''
  const sig = req.headers.get('x-slack-signature')          ?? ''
  if (!ts || !sig) return reply('missing slack signature headers')

  const params = new URLSearchParams(rawBody)
  const slackUserId = params.get('user_id') ?? ''
  if (!slackUserId) return reply('missing user_id in slash command body')

  const nexusUserId = resolveNexusUser(slackUserId)
  if (!nexusUserId) {
    return reply('this Slack user is not mapped to a Nexus operator (set SLACK_USER_<id>=<clerk_id>)')
  }

  const cfg = await getSlackConfig(nexusUserId)
  if (!cfg.signingSecret) return reply('slack signing secret not configured for this operator')
  if (!verifySlackSignature({ body: rawBody, timestamp: ts, signature: sig, signingSecret: cfg.signingSecret })) {
    return reply('signature verification failed')
  }

  const command = (params.get('command') ?? '').trim()
  const text    = (params.get('text')    ?? '').trim()
  const responseUrl = (params.get('response_url') ?? '').trim()
  const channelId   = (params.get('channel_id')   ?? '').trim()

  // ── War-room slash commands (Mission Control Kit Pack 01) ────────────────
  // Slack expects an ack within 3s; the multi-agent fan-out runs async via
  // Inngest and posts back through response_url (or chat.postMessage).
  if (command === '/standup' || command === '/discuss' || command === '/ask') {
    if (!(await isKillSwitchEnabled('slack_warroom'))) {
      return reply(':no_entry: slack_warroom kill switch is disabled')
    }
    audit(req, {
      action:   `slack.${command.replace(/^\//, '')}`,
      resource: 'warroom',
      userId:   nexusUserId,
      metadata: { command, text, channelId, slackUserId },
    })
    await inngest.send({
      name: 'slack/warroom.fanout',
      data: {
        command:        command.replace(/^\//, ''),
        text,
        userId:         nexusUserId,
        slackUserId,
        channelId,
        responseUrl,
      },
    }).catch(err => {
      if (process.env.NODE_ENV !== 'production') console.warn('[warroom] inngest send failed:', err)
    })
    const usage =
      command === '/standup'
        ? 'standup queued — agents will report in this channel within ~30 seconds.'
        : command === '/discuss'
          ? `discussion queued for: ${text.slice(0, 100)}\nagents will weigh in, then a consolidator will summarise.`
          : `ask queued: ${text.slice(0, 100)}\nthe lead operator will reply within ~20 seconds.`
    return reply(`:thought_balloon: ${usage}`, 'ephemeral')
  }

  const [arg, ...rest] = text.split(/\s+/)
  const runId  = arg
  const reason = rest.join(' ').trim()

  if (!runId) return reply(`usage: ${command} <runId> ${command === '/reject' ? '<reason>' : ''}`.trim())

  const run = await getRun(runId)
  if (!run || run.userId !== nexusUserId) {
    return reply(`runId not found or not owned by you: ${runId}`)
  }

  audit(req, {
    action:     `slack.${command.replace(/^\//, '')}`,
    resource:   'run',
    resourceId: runId,
    metadata:   { phase: run.phase, status: run.status, slackUserId },
  })

  if (command === '/approve') {
    const to = nextPhase(run.phase)
    if (!to) return reply(`run is already at terminal phase '${run.phase}'`)
    const updated = await advancePhase(runId, to, { reason: 'slack.approve', slackUserId })
    return reply(`✅ run \`${runId.slice(0, 8)}\` advanced ${run.phase} → ${updated?.phase ?? to}`, 'in_channel')
  }

  if (command === '/reject') {
    const updated = await setStatus(runId, 'blocked', { reason: reason || 'rejected via slack', slackUserId })
    return reply(`❌ run \`${runId.slice(0, 8)}\` blocked${reason ? `: ${reason}` : ''} (phase=${updated?.phase ?? run.phase})`, 'in_channel')
  }

  if (command === '/condition' || command === '/status') {
    const events = await listEvents(runId, 5)
    const tail = events.map(e => `• ${e.createdAt.slice(11, 16)}Z ${e.kind}`).join('\n') || '(no events)'
    return reply(`run \`${runId.slice(0, 8)}\`\nphase=${run.phase} status=${run.status}\nrecent:\n${tail}`)
  }

  return reply(`unknown command: ${command}`)
}

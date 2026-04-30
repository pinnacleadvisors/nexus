/**
 * Dispatch helpers — talk to the Nexus deployment (issue bot session, fetch
 * Vercel logs, file workflow feedback) and to the self-hosted Claude Code
 * gateway (request a fix-attempt). All calls use HMAC where the Nexus side
 * expects it, plus the bot bearer token where bearer auth is enough.
 */

import { signBody } from './auth.js'

export interface DispatchEnv {
  nexusBaseUrl:        string  // e.g. https://nexus.example.com
  botIssuerSecret:     string  // BOT_ISSUER_SECRET
  botClerkUserId:      string  // BOT_CLERK_USER_ID
  botApiToken:         string  // BOT_API_TOKEN
  gatewayUrl:          string  // CLAUDE_GATEWAY_URL
  gatewayBearer:       string  // CLAUDE_GATEWAY_BEARER
}

export async function issueBotSessionTicket(env: DispatchEnv): Promise<string> {
  const body = JSON.stringify({ userId: env.botClerkUserId })
  const { signature, timestamp } = signBody(body, env.botIssuerSecret)

  const url = `${env.nexusBaseUrl.replace(/\/$/, '')}/api/admin/issue-bot-session`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'X-Nexus-Signature': signature,
      'X-Nexus-Timestamp': timestamp,
    },
    body,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`issue_bot_session_failed status=${res.status} body=${detail.slice(0, 200)}`)
  }
  const json = await res.json() as { ok: boolean; url?: string; ticket?: string; error?: string }
  if (!json.ok || !json.url) {
    throw new Error(`issue_bot_session_unexpected: ${json.error ?? 'no_url'}`)
  }
  return json.url
}

export interface DispatchFixOpts {
  /** A short summary of what failed — first line of the dispatch brief. */
  title:       string
  /** Markdown body shown to the agent on the gateway side. */
  brief:       string
  /** Optional URLs to screenshots / traces — embedded as references. */
  attachments?: string[]
  /** Slug of an existing `.claude/agents/<slug>.md` to load as system prompt. */
  agentSlug?:  string | null
  /** Used as the gateway's `sessionTag` so logs identify this lane. */
  sessionTag?: string
}

export async function dispatchFixAttempt(env: DispatchEnv, opts: DispatchFixOpts): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  const body = JSON.stringify({
    role:    'user',
    content: composeBriefMarkdown(opts),
    agent:   opts.agentSlug ?? 'workflow-optimizer',
    env:     {},
  })
  const sigTs = signBody(body, env.gatewayBearer)
  const sessionTag = opts.sessionTag ?? 'qa-runner'
  const url = `${env.gatewayUrl.replace(/\/$/, '')}/api/sessions/${encodeURIComponent(sessionTag)}/messages`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'Authorization':     `Bearer ${env.gatewayBearer}`,
      'X-Nexus-Signature': sigTs.signature,
      'X-Nexus-Timestamp': sigTs.timestamp,
      'X-Nexus-User-Id':   env.botClerkUserId,
    },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `gateway_${res.status}: ${text.slice(0, 200)}` }
  }
  const json = await res.json().catch(() => ({})) as { jobId?: string; sessionId?: string }
  return { ok: true, jobId: json.jobId ?? json.sessionId }
}

export async function fetchVercelLogSlice(env: DispatchEnv, opts: { windowSeconds?: number; deploymentId?: string }): Promise<string> {
  const url = `${env.nexusBaseUrl.replace(/\/$/, '')}/api/logs/slice`
  const body = JSON.stringify({
    windowSeconds: opts.windowSeconds ?? 30,
    deploymentId:  opts.deploymentId ?? null,
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.botApiToken}`,
    },
    body,
  })
  if (!res.ok) return ''
  const json = await res.json().catch(() => ({})) as { markdown?: string }
  return json.markdown ?? ''
}

export async function fileWorkflowFeedback(env: DispatchEnv, opts: { agentSlug: string; summary: string; details: string }): Promise<void> {
  const url = `${env.nexusBaseUrl.replace(/\/$/, '')}/api/workflow-feedback`
  const body = JSON.stringify({
    agent_slug: opts.agentSlug,
    summary:    opts.summary,
    details:    opts.details,
    source:     'qa-runner',
  })
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.botApiToken}`,
    },
    body,
  }).catch(() => undefined)
}

function composeBriefMarkdown(opts: DispatchFixOpts): string {
  const parts: string[] = []
  parts.push(`# ${opts.title}`)
  parts.push('')
  parts.push(opts.brief.trim())
  if (opts.attachments && opts.attachments.length > 0) {
    parts.push('')
    parts.push('## Attachments')
    for (const url of opts.attachments) parts.push(`- ${url}`)
  }
  return parts.join('\n')
}

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
  /** Per-call provider override. Defaults to Nexus-side LLM_PROVIDER env
   *  (claude / codex / openrouter / mimo / ollama). Allows the qa-runner
   *  to A/B providers per run without container env changes — pass
   *  `provider: 'mimo'` to route this fix-attempt through Mimo Pro 2.5,
   *  for example. */
  provider?:   'claude' | 'codex' | 'openrouter' | 'mimo' | 'ollama' | 'auto'
  /** Model override for the resolved provider. Falls back to the provider's
   *  default model from lib/llm/provider.ts. */
  model?:      string
}

/**
 * Dispatch a fix-attempt to whichever AI provider Nexus is configured to use.
 *
 * Previously this hit the Claude Code gateway directly — making the
 * qa-runner Claude-only. The 2026-05-27 model-agnostic refactor (I1) moves
 * the provider selection to a Nexus-side route (/api/qa/dispatch-fix),
 * so the runner sends the same shape regardless of whether Claude, Codex,
 * Mimo, OpenRouter, or Ollama is the configured backend. Swapping is a
 * Doppler env-var change (LLM_PROVIDER=mimo + redeploy nexus-app), no
 * qa-runner image rebuild needed.
 *
 * The Nexus route returns `{ ok, jobId, text?, provider, error? }` —
 * `text` is set when the provider is one of the AI-SDK shapes (mimo /
 * openrouter / ollama) since those are one-shot completions. For Claude
 * gateway dispatches, only `jobId` is returned (caller polls separately).
 *
 * Authenticates with the bot API token — same shape the qa-runner uses
 * for every other Nexus-side surface (issue-bot-session, workflow-feedback).
 */
export async function dispatchFixAttempt(env: DispatchEnv, opts: DispatchFixOpts): Promise<{ ok: boolean; jobId?: string; text?: string; provider?: string; error?: string }> {
  const url = `${env.nexusBaseUrl.replace(/\/$/, '')}/api/qa/dispatch-fix`
  const body = JSON.stringify({
    title:       opts.title,
    brief:       opts.brief,
    attachments: opts.attachments ?? [],
    agentSlug:   opts.agentSlug ?? 'workflow-optimizer',
    sessionTag:  opts.sessionTag ?? `qa-runner-${Date.now()}`,
    provider:    opts.provider,
    model:       opts.model,
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.botApiToken}`,
    },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `nexus_dispatch_${res.status}: ${text.slice(0, 200)}` }
  }
  const json = await res.json().catch(() => ({})) as {
    ok?:       boolean
    jobId?:    string
    text?:     string
    provider?: string
    error?:    string
  }
  return {
    ok:       Boolean(json.ok),
    jobId:    json.jobId,
    text:     json.text,
    provider: json.provider,
    error:    json.error,
  }
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

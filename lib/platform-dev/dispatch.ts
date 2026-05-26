/**
 * lib/platform-dev/dispatch.ts — helper to kick the platform-dev-loop
 * agent against a queued issue.
 *
 * Used by:
 *   - POST /api/issues — when the operator submits with dev_team=true
 *   - POST /api/cron/platform-dev-tick — periodic retry / catch-up
 *
 * Wraps the existing /api/claude-session/dispatch so callers don't
 * duplicate the auth headers + URL resolution + prompt template.
 *
 * Synchronous from the caller's perspective: returns when the dispatch
 * is accepted. The agent itself runs async on the claude-gateway.
 */

import { createHmac, randomBytes } from 'node:crypto'
import { getInternalBaseUrl } from '@/lib/internal-fetch'

export interface PlatformDevDispatchInput {
  issueId:       string
  title:         string
  description:   string | null
  businessSlug:  string
  userId:        string
  /** Cookie string from the originating request, for the inner /dispatch call. */
  cookie?:       string
}

export interface PlatformDevDispatchResult {
  ok:           boolean
  sessionId?:   string
  callbackToken?: string
  error?:       string
}

/**
 * Build a callback-auth token. The dev-loop agent embeds this in its
 * final POST to /api/issues/[id]/pr-opened. The handler verifies via
 * HMAC of the issue id under PLATFORM_DEV_CALLBACK_SECRET.
 */
export function buildCallbackToken(issueId: string, nonce: string): string {
  const secret = process.env.PLATFORM_DEV_CALLBACK_SECRET ?? process.env.CRON_SECRET ?? ''
  if (!secret) {
    // Without a secret, the callback path can't verify — return a sentinel
    // string the handler rejects. Better than a silent open door.
    return 'no-secret-configured'
  }
  return createHmac('sha256', secret).update(`${issueId}:${nonce}`).digest('hex')
}

export function verifyCallbackToken(issueId: string, nonce: string, token: string): boolean {
  if (!nonce || !token) return false
  const expected = buildCallbackToken(issueId, nonce)
  if (expected === 'no-secret-configured') return false
  if (expected.length !== token.length) return false
  // Constant-time comparison
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i)
  return diff === 0
}

export async function dispatchPlatformDev(input: PlatformDevDispatchInput): Promise<PlatformDevDispatchResult> {
  const base   = getInternalBaseUrl()
  const nonce  = randomBytes(12).toString('hex')
  const token  = buildCallbackToken(input.issueId, nonce)
  const callbackUrl = `${base}/api/issues/${encodeURIComponent(input.issueId)}/pr-opened?nonce=${nonce}`

  const dispatchBody = {
    agentSlug:    'platform-dev-loop',
    capabilityId: 'autonomous-dev',
    businessSlug: input.businessSlug,
    inputs: {
      issue_id:       input.issueId,
      title:          input.title,
      description:    input.description ?? '',
      business_slug:  input.businessSlug,
      callback_url:   callbackUrl,
      callback_token: token,
      tools:          ['Read', 'Edit', 'Grep', 'Glob', 'Bash'],
      task: [
        `Autonomously implement this issue and open a DRAFT PR.`,
        ``,
        `Issue #${input.issueId}: ${input.title}`,
        input.description ? `\n${input.description}` : '',
        ``,
        `Follow the platform-dev-loop spec at .claude/agents/platform-dev-loop.md.`,
        `Steps: read context → branch → implement → check:all → push → gh pr create --draft.`,
        `On completion, POST to ${callbackUrl} with { status, pr_url, branch }`,
        `using Bearer ${token.slice(0, 12)}… (the full token is in callback_token).`,
      ].join('\n'),
    },
  }

  try {
    const res = await fetch(`${base}/api/claude-session/dispatch`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.cookie ? { cookie: input.cookie } : {}),
      },
      body:    JSON.stringify(dispatchBody),
      signal:  AbortSignal.timeout(20_000),
    })
    const body = await res.json().catch(() => ({})) as { ok?: boolean; sessionId?: string; error?: string }
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error ?? `dispatch_http_${res.status}` }
    }
    return { ok: true, sessionId: body.sessionId, callbackToken: token }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'dispatch_failed' }
  }
}

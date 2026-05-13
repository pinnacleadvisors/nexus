/**
 * POST /api/platform-chat
 *
 * Platform-dev chat backend (async job variant). Each turn:
 *   1. Auth via Clerk
 *   2. Cost-cap guard via assertUnderCostCap (user scope)
 *   3. Build platform system prompt with admin-scope connections + recent errors
 *   4. Resolve the shared claude-gateway via resolveClaudeCodeConfig
 *   5. Enqueue a job on the gateway (POST /api/jobs). Returns the jobId
 *      immediately — the client then polls /api/platform-chat/poll until done.
 *
 * Why async vs sync (the old shape):
 *   - Opus + Composio MCP tool calls + agent self-reasoning can easily run
 *     for minutes on one turn. The old single-fetch model capped at the
 *     gateway's 55s timeout, surfacing as "gateway returned 0: gateway
 *     request timed out".
 *   - Vercel's per-function maxDuration is 60s. We can't stretch a single
 *     blocking fetch past that.
 *   - Async jobs: enqueue is fast (<1s), result polled separately, no
 *     individual call hits the timeout ceiling. Each poll is <500ms.
 *
 * Body:
 *   { messages: Array<{ role: 'user' | 'assistant'; content: string }> }
 *
 * Returns 200:
 *   { ok: true, jobId: string, sessionTag: string }
 *
 * Returns 4xx/5xx:
 *   { ok: false, error: string, code: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { assertUnderCostCap } from '@/lib/cost-guard'
import { resolveClaudeCodeConfig } from '@/lib/claw/business-client'
import { enqueueGatewayJob } from '@/lib/claw/gateway-jobs'
import { buildPlatformSystemPrompt } from '@/lib/chat/system-prompt-platform'
import {
  appendMessage,
  getSession,
  createSession,
  updateSessionTitle,
  deriveTitleFromMessage,
} from '@/lib/chat/sessions'

export const runtime    = 'nodejs'
export const maxDuration = 30   // Enqueue should be <1s; 30s leaves plenty of slack.

interface PlatformChatBody {
  messages?:  Array<{ role?: string; content?: string }>
  /** Phase 4 — when set, the user message is persisted into chat_messages
   *  under this session and the jobId is associated with it. When unset,
   *  the route auto-creates a new session and returns its id. */
  sessionId?: string
}

const MAX_TURN_CHARS = 32_000

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'platform-chat' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized', code: 'unauthorized' }, { status: 401 })
  }

  let body: PlatformChatBody
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body', code: 'invalid' }, { status: 400 })
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ ok: false, error: 'messages[] required', code: 'invalid' }, { status: 400 })
  }
  const lastUser = [...body.messages].reverse().find(m => m.role === 'user')
  if (!lastUser || typeof lastUser.content !== 'string' || lastUser.content.trim().length === 0) {
    return NextResponse.json({ ok: false, error: 'last message must be a non-empty user message', code: 'invalid' }, { status: 400 })
  }

  // Cost cap — user scope (platform-dev chat has no business_slug).
  const cap = await assertUnderCostCap(session.userId)
  if (!cap.ok) {
    return NextResponse.json({
      ok:    false,
      error: `daily spend cap reached ($${cap.spentUsd.toFixed(2)} / $${cap.capUsd.toFixed(2)}). Reset at UTC midnight or bump USER_DAILY_USD_LIMIT.`,
      code:  'capped',
    }, { status: 402 })
  }

  const gateway = await resolveClaudeCodeConfig(session.userId)
  if (!gateway) {
    return NextResponse.json({
      ok:    false,
      error: 'claude-gateway not configured — set CLAUDE_CODE_GATEWAY_URL + CLAUDE_CODE_BEARER_TOKEN in Doppler, or save them as user secrets under kind="claude-code".',
      code:  'no_gateway',
    }, { status: 503 })
  }

  const systemPrompt = await buildPlatformSystemPrompt(session.userId)
  const transcript   = body.messages
    .filter(m => typeof m.content === 'string' && m.content.length > 0)
    .map(m => `${m.role === 'user' ? 'OPERATOR' : 'CLAUDE'}: ${m.content}`)
    .join('\n\n')

  const composite = `${systemPrompt}\n\n---\n\nConversation so far:\n\n${transcript}\n\nReply as CLAUDE to the latest OPERATOR message.`
  if (composite.length > MAX_TURN_CHARS) {
    return NextResponse.json({
      ok:    false,
      error: `conversation too long for one turn (${composite.length} chars > ${MAX_TURN_CHARS}). Start a new chat to reset.`,
      code:  'invalid',
    }, { status: 413 })
  }

  // ── Phase 4: session resolution + persistence ────────────────────────────
  // If the client passed a sessionId, verify ownership. Otherwise create a
  // new session and derive a title from the first user message. The persisted
  // user message + the eventual assistant reply both live under this session.
  let sessionId = body.sessionId?.trim() || null
  let sessionRow = sessionId ? await getSession(session.userId, sessionId) : null
  if (sessionId && !sessionRow) {
    return NextResponse.json({ ok: false, error: 'session not found', code: 'invalid' }, { status: 404 })
  }
  if (!sessionRow) {
    sessionRow = await createSession({
      userId:    session.userId,
      scope:     'platform',
      agentSlug: 'platform-copilot',
      title:     deriveTitleFromMessage(lastUser.content as string),
    })
    if (!sessionRow) {
      return NextResponse.json({ ok: false, error: 'failed to create chat session', code: 'invalid' }, { status: 500 })
    }
    sessionId = sessionRow.id
  } else if (!sessionRow.title) {
    // First user message arrived against a pre-existing untitled session.
    await updateSessionTitle(sessionRow.id, deriveTitleFromMessage(lastUser.content as string))
  }

  // Persist the user's latest message before the dispatch — if the gateway
  // fails, the user still sees their input preserved in the session.
  await appendMessage({
    sessionId: sessionRow.id,
    role:      'user',
    content:   lastUser.content as string,
  })

  const sessionTag = `platform-chat-${sessionRow.id}-${Date.now()}`
  const t0         = Date.now()
  const enqueued = await enqueueGatewayJob({
    gatewayUrl:  gateway.gatewayUrl,
    bearerToken: gateway.bearerToken,
    sessionTag,
    agentSlug:   'platform-copilot',
    message:     composite,
    userId:      session.userId,
    timeoutMs:   10_000,
  })

  if (!enqueued.ok || !enqueued.jobId) {
    audit(req, {
      action:   'platform_chat.enqueue',
      resource: 'chat',
      userId:   session.userId,
      metadata: { stage: 'enqueue', http: enqueued.http, error: enqueued.error, durationMs: Date.now() - t0 },
    })
    return NextResponse.json({
      ok:    false,
      error: `gateway enqueue failed: ${enqueued.error ?? 'unknown'}`,
      code:  'gateway_error',
    }, { status: enqueued.http && enqueued.http >= 400 && enqueued.http < 600 ? enqueued.http : 502 })
  }

  audit(req, {
    action:   'platform_chat.enqueue',
    resource: 'chat',
    userId:   session.userId,
    metadata: { jobId: enqueued.jobId, sessionId: sessionRow.id, sessionTag, charCount: composite.length, durationMs: Date.now() - t0 },
  })

  return NextResponse.json({
    ok:        true,
    jobId:     enqueued.jobId,
    sessionId: sessionRow.id,
    sessionTag,
  })
}

/**
 * POST /api/platform-chat
 *
 * Platform-dev chat backend. Each turn:
 *   1. Auth via Clerk
 *   2. Cost-cap guard via assertUnderCostCap (user scope)
 *   3. Build platform system prompt with connected accounts + recent errors
 *   4. Dispatch the turn to the shared claude-gateway via the existing
 *      dispatch route — synchronous (Phase 1 MVP). Phase 2 will switch
 *      this to SSE streaming.
 *   5. Return the assistant message + tool-call summary
 *
 * Body:
 *   { messages: Array<{ role: 'user' | 'assistant'; content: string }> }
 *
 * Returns:
 *   { ok: true,  message: string, sessionId: string, durationMs: number }
 *   { ok: false, error: string,   code: 'unauthorized' | 'capped' | 'dispatch_failed' | 'invalid' }
 *
 * The legacy form-based dev-console used /api/build/* — keep those intact
 * for the Research tab. This route is parallel, not a replacement of those.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { assertUnderCostCap } from '@/lib/cost-guard'
import { buildPlatformSystemPrompt } from '@/lib/chat/system-prompt-platform'

export const runtime    = 'nodejs'
export const maxDuration = 60

interface PlatformChatBody {
  messages?: Array<{ role?: string; content?: string }>
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

  // Cost cap. User scope — platform-dev chat has no business_slug.
  // assertUnderCostCap returns a result object (no throw on cap), so check
  // ok and surface a clean error before the dispatch.
  const cap = await assertUnderCostCap(session.userId)
  if (!cap.ok) {
    return NextResponse.json({
      ok:    false,
      error: `daily spend cap reached ($${cap.spentUsd.toFixed(2)} / $${cap.capUsd.toFixed(2)}). Reset at UTC midnight or bump USER_DAILY_USD_LIMIT.`,
      code:  'capped',
    }, { status: 402 })
  }

  // System prompt + composite turn message. The claude-gateway dispatch
  // route accepts a single content string — we prepend the system prompt
  // and serialise prior turns into a transcript so Claude has context.
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

  // Dispatch to the shared claude-gateway via the existing route. We use
  // a generic agent slug ("platform-copilot") so the gateway loads any
  // future .claude/agents/platform-copilot.md spec if it exists, but
  // works without one too.
  const t0   = Date.now()
  const base = process.env.NEXUS_BASE_URL ?? new URL(req.url).origin
  let dispatchRes: Response
  try {
    dispatchRes = await fetch(`${base}/api/claude-session/dispatch`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', cookie: req.headers.get('cookie') ?? '' },
      body:    JSON.stringify({
        agentSlug:       'platform-copilot',
        autoCreateAgent: false,
        inputs: {
          task: composite,
          tools: ['Bash', 'Read', 'Edit', 'Grep', 'Glob', 'WebFetch', 'WebSearch'],
        },
      }),
      signal:  AbortSignal.timeout(55_000),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'dispatch failed'
    audit(req, { action: 'platform_chat.turn', resource: 'chat', userId: session.userId, metadata: { error: message, stage: 'dispatch' } })
    return NextResponse.json({ ok: false, error: `dispatch failed: ${message}`, code: 'dispatch_failed' }, { status: 502 })
  }

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text().catch(() => '')
    audit(req, { action: 'platform_chat.turn', resource: 'chat', userId: session.userId, metadata: { dispatchStatus: dispatchRes.status, body: text.slice(0, 500) } })
    return NextResponse.json({ ok: false, error: `gateway returned ${dispatchRes.status}: ${text.slice(0, 500)}`, code: 'dispatch_failed' }, { status: 502 })
  }

  // The dispatch route's response shape varies — extract whatever assistant
  // text we can find. Real gateway responses include `content`, `result.content`,
  // or a nested `data` field depending on the gateway version.
  type DispatchOk = { content?: string; result?: { content?: string }; data?: { content?: string }; sessionId?: string; durationMs?: number }
  const json = (await dispatchRes.json().catch(() => ({}))) as DispatchOk
  const text = json.content ?? json.result?.content ?? json.data?.content ?? '(empty response from gateway)'
  const elapsed = Date.now() - t0

  audit(req, {
    action:   'platform_chat.turn',
    resource: 'chat',
    userId:   session.userId,
    metadata: { sessionId: json.sessionId ?? null, durationMs: elapsed, messageCount: body.messages.length, charCount: composite.length },
  })

  return NextResponse.json({ ok: true, message: text, sessionId: json.sessionId ?? null, durationMs: elapsed })
}

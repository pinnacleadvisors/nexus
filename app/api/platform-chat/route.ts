/**
 * POST /api/platform-chat
 *
 * Platform-dev chat backend. Each turn:
 *   1. Auth via Clerk
 *   2. Cost-cap guard via assertUnderCostCap (user scope)
 *   3. Build platform system prompt with connected accounts + recent errors
 *   4. Resolve the shared claude-gateway via resolveClaudeCodeConfig
 *   5. Call the gateway directly via lib/claw/gateway-call.ts::callGateway —
 *      NOT via /api/claude-session/dispatch. The dispatch route is for n8n /
 *      idea workflows and strips the assistant text from its response shape
 *      (returns only metadata). callGateway returns the real text and uses
 *      the same 55s timeout as Vercel's maxDuration. It also injects the
 *      X-Nexus-User-Id header so the gateway's ALLOWED_USER_IDS gate passes.
 *
 * Body:
 *   { messages: Array<{ role: 'user' | 'assistant'; content: string }> }
 *
 * Returns:
 *   { ok: true,  message: string, sessionId: string, durationMs: number }
 *   { ok: false, error: string,   code: 'unauthorized' | 'capped' | 'no_gateway' | 'gateway_error' | 'invalid' }
 *
 * Phase 2 will switch to callGatewayStream + SSE so partial output is
 * visible during long-running tool calls. Phase 3 adds approval gates.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { assertUnderCostCap } from '@/lib/cost-guard'
import { resolveClaudeCodeConfig } from '@/lib/claw/business-client'
import { callGateway } from '@/lib/claw/gateway-call'
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
  const cap = await assertUnderCostCap(session.userId)
  if (!cap.ok) {
    return NextResponse.json({
      ok:    false,
      error: `daily spend cap reached ($${cap.spentUsd.toFixed(2)} / $${cap.capUsd.toFixed(2)}). Reset at UTC midnight or bump USER_DAILY_USD_LIMIT.`,
      code:  'capped',
    }, { status: 402 })
  }

  // Resolve the shared claude-gateway (operator-level, no business slug).
  const gateway = await resolveClaudeCodeConfig(session.userId)
  if (!gateway) {
    return NextResponse.json({
      ok:    false,
      error: 'claude-gateway not configured — set CLAUDE_CODE_GATEWAY_URL + CLAUDE_CODE_BEARER_TOKEN in Doppler, or save them as user secrets under kind="claude-code".',
      code:  'no_gateway',
    }, { status: 503 })
  }

  // System prompt + composite turn message. The gateway loads the agent spec
  // (.claude/agents/platform-copilot.md) as a system-style preface from its
  // own /repo clone, then prepends our message as the user turn. We include
  // the prior conversation as part of the user message so multi-turn state
  // works without server-side session storage (Phase 4 will persist).
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

  const t0 = Date.now()
  const result = await callGateway({
    gatewayUrl:  gateway.gatewayUrl,
    bearerToken: gateway.bearerToken,
    sessionTag:  `platform-chat-${Date.now()}`,
    agentSlug:   'platform-copilot',
    message:     composite,
    userId:      session.userId,
    timeoutMs:   55_000,
  })

  if (!result.ok) {
    audit(req, {
      action:   'platform_chat.turn',
      resource: 'chat',
      userId:   session.userId,
      metadata: { stage: 'gateway', status: result.status, error: result.error, durationMs: Date.now() - t0 },
    })
    return NextResponse.json({
      ok:    false,
      error: `gateway returned ${result.status}: ${result.error ?? 'unknown error'}`,
      code:  'gateway_error',
    }, { status: result.status >= 400 && result.status < 600 ? result.status : 502 })
  }

  const text    = (result.text ?? '').trim()
  const elapsed = Date.now() - t0
  audit(req, {
    action:   'platform_chat.turn',
    resource: 'chat',
    userId:   session.userId,
    metadata: { durationMs: elapsed, messageCount: body.messages.length, charCount: composite.length, replyLen: text.length },
  })

  return NextResponse.json({
    ok:         true,
    message:    text || '(the gateway returned an empty assistant message — usually means the agent timed out mid-tool-call or Claude refused for safety reasons; check the gateway logs)',
    sessionId:  null,
    durationMs: elapsed,
  })
}

/**
 * POST /api/businesses/[slug]/chat — enqueue a chat turn against the
 * per-business agent (Phase 5a of task_plan-chat.md).
 *
 * Mirror of /api/platform-chat (PR #155 + #159) but scoped per-business:
 *   - System prompt built from business connections + run events
 *   - Dispatches to the per-business gateway via resolveClawConfig(userId, slug)
 *   - Uses agent slug 'business-copilot' (see .claude/agents/business-copilot.md)
 *   - chat_sessions row carries scope = 'business:<slug>'
 *
 * MVP scope: auto-resolves to a SINGLE persistent session per business
 * (one rolling chat per business, no sidebar yet). Multi-session support
 * for per-business chat is a follow-up — the schema already supports it
 * via the scope column, just no UI.
 *
 * Returns: { ok: true, jobId, sessionId } on success.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { assertUnderCostCap } from '@/lib/cost-guard'
import { resolveClawConfig, isBusinessSlug } from '@/lib/claw/business-client'
import { enqueueGatewayJob } from '@/lib/claw/gateway-jobs'
import { buildBusinessSystemPrompt } from '@/lib/chat/system-prompt-business'
import { appendMessage, listSessions, createSession, deriveTitleFromMessage, listMessages } from '@/lib/chat/sessions'
import { buildEditPlanResumeHint } from '@/lib/chat/edit-plan-resume'
import { computeUsage } from '@/lib/chat/context-window'

export const runtime    = 'nodejs'
export const maxDuration = 30

interface Body {
  messages?:  Array<{ role?: string; content?: string }>
  sessionId?: string
  /** Phase 0 of task_plan-model-agnostic-chat.md — operator may opt this
   *  turn into the Codex direct-dispatch path. Defaults to 'claude'. */
  provider?: 'claude' | 'codex'
}

/** Sanity ceiling — anything past 2MB chars is runaway. Real check is token-based, see computeUsage(). */
const ABSOLUTE_CHAR_CEILING = 2_000_000

export async function POST(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'business-chat' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized', code: 'unauthorized' }, { status: 401 })

  const { slug } = await context.params
  if (!isBusinessSlug(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid business slug', code: 'invalid' }, { status: 400 })
  }

  let body: Body
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

  // Cost cap — passes businessSlug so the business-specific kill switch applies.
  const cap = await assertUnderCostCap(session.userId, slug)
  if (!cap.ok) {
    return NextResponse.json({
      ok:    false,
      error: `daily spend cap reached for ${cap.scope === 'business' ? `business "${slug}"` : 'user'} ($${cap.spentUsd.toFixed(2)} / $${cap.capUsd.toFixed(2)}).`,
      code:  'capped',
    }, { status: 402 })
  }

  const gateway = await resolveClawConfig(session.userId, slug)
  if (!gateway) {
    return NextResponse.json({
      ok:    false,
      error: `no gateway configured for business "${slug}" — provision a per-business container at POST /api/businesses/${slug}/provision, or set CLAUDE_CODE_GATEWAY_URL for a fallback.`,
      code:  'no_gateway',
    }, { status: 503 })
  }

  // MVP: one rolling session per business. If the operator passed sessionId,
  // use it (verified ownership in DB). Otherwise pick the most-recent session
  // for this business; if none, create a fresh one with the user's first
  // message as the auto-derived title.
  const scope = `business:${slug}`
  let sessionId = body.sessionId?.trim() || null
  if (!sessionId) {
    const existing = await listSessions(session.userId, scope, 1)
    if (existing.length > 0) sessionId = existing[0].id
  }
  if (!sessionId) {
    const created = await createSession({
      userId:    session.userId,
      scope,
      agentSlug: 'business-copilot',
      title:     deriveTitleFromMessage(lastUser.content as string),
    })
    if (!created) {
      return NextResponse.json({ ok: false, error: 'failed to create chat session', code: 'invalid' }, { status: 500 })
    }
    sessionId = created.id
  }

  // Persist user turn before dispatch (matches platform-chat pattern).
  await appendMessage({ sessionId, role: 'user', content: lastUser.content as string })

  const systemPrompt = await buildBusinessSystemPrompt(session.userId, slug)
  const transcript   = body.messages
    .filter(m => typeof m.content === 'string' && m.content.length > 0)
    .map(m => `${m.role === 'user' ? 'OPERATOR' : 'CLAUDE'}: ${m.content}`)
    .join('\n\n')

  // Crash-recovery hint — see app/api/platform-chat/route.ts for design notes.
  let crashHint = ''
  let editPlanResumeHint = ''
  if (sessionId) {
    const recent = await listMessages(sessionId, 6)
    const lastAssistant = [...recent].reverse().find(m => m.role === 'assistant')
    const crashedMeta = lastAssistant?.metadata && typeof lastAssistant.metadata === 'object'
      ? (lastAssistant.metadata as { crashed?: { exit_code?: number | null } }).crashed
      : null
    if (crashedMeta) {
      const code = crashedMeta.exit_code ?? '?'
      crashHint = `\n\n## ⚠ Previous turn crashed (exit code ${code})\n\nThe last turn ended in a CLI crash before the agent could finish its tool calls. **Re-issue any uncompleted tool calls; do not assume prior "pending" / "I'll write" / "queued" work landed.** Inspect the conversation, identify what was promised but unverified, redo it.\n`
    }
    // Edit-plan resume — wider 30-msg window so multi-group plans survive.
    const wideHistory  = await listMessages(sessionId, 30)
    editPlanResumeHint = buildEditPlanResumeHint(wideHistory)
  }

  const composite = `${systemPrompt}${crashHint}${editPlanResumeHint}\n\n---\n\nConversation so far:\n\n${transcript}\n\nReply as CLAUDE to the latest OPERATOR message.`
  // Token-based budget check — see lib/chat/context-window.ts. Replaces
  // the old 32k-char cap with the model's actual input budget (~150k
  // tokens for Claude on 200k context).
  const compositeUsage = computeUsage(composite, 'opus')
  if (compositeUsage.overBudget || composite.length > ABSOLUTE_CHAR_CEILING) {
    const detail = compositeUsage.overBudget
      ? `${compositeUsage.tokensUsed.toLocaleString()} tokens > ${compositeUsage.inputBudget.toLocaleString()} input budget (${compositeUsage.model.display}, ${compositeUsage.contextTokens.toLocaleString()} context). Start a new chat to reset, or trim earlier turns.`
      : `composite size ${composite.length.toLocaleString()} chars > absolute ceiling ${ABSOLUTE_CHAR_CEILING.toLocaleString()}`
    return NextResponse.json({
      ok:    false,
      error: `conversation too long for one turn — ${detail}`,
      code:  'invalid',
      usage: { tokensUsed: compositeUsage.tokensUsed, inputBudget: compositeUsage.inputBudget, model: compositeUsage.model.display },
    }, { status: 413 })
  }

  const t0         = Date.now()
  const sessionTag = `business-chat-${slug}-${Date.now()}`

  // Phase 0 of task_plan-model-agnostic-chat.md — operator may opt this
  // turn into Codex direct-dispatch. Skips the async-job pattern. Typed
  // blocks (iteration-plan, approval-request) are unreliable on this path
  // — operator accepts the regression for cost savings.
  if (body.provider === 'codex') {
    const { dispatchCodexChatTurn } = await import('@/lib/chat/codex-direct-dispatch')
    const cdx = await dispatchCodexChatTurn({
      userId:    session.userId,
      sessionId,
      agentSlug: 'business-copilot',
      message:   composite,
      sessionTag,
    })
    audit(req, {
      action:   'business_chat.codex_direct',
      resource: 'chat',
      userId:   session.userId,
      metadata: { businessSlug: slug, ok: cdx.ok, sessionId, sessionTag, durationMs: cdx.durationMs, error: cdx.error },
    })
    if (!cdx.ok) {
      return NextResponse.json({
        ok:           false,
        mode:         'codex-direct',
        error:        cdx.error ?? 'codex dispatch failed',
        fallbackHint: cdx.fallbackHint,
        code:         'codex_error',
      }, { status: 502 })
    }
    return NextResponse.json({
      ok:        true,
      mode:      'codex-direct',
      sessionId,
      sessionTag,
      text:      cdx.text,
      usage: {
        tokensUsed:     compositeUsage.tokensUsed,
        inputBudget:    compositeUsage.inputBudget,
        contextTokens:  compositeUsage.contextTokens,
        inputUsedPct:   compositeUsage.inputUsedPct,
        contextUsedPct: compositeUsage.contextUsedPct,
        model:          'gpt-5.5-codex',
      },
    })
  }

  const enq = await enqueueGatewayJob({
    gatewayUrl:  gateway.gatewayUrl,
    bearerToken: gateway.bearerToken,
    sessionTag,
    agentSlug:   'business-copilot',
    message:     composite,
    userId:      session.userId,
    timeoutMs:   10_000,
  })
  if (!enq.ok || !enq.jobId) {
    audit(req, { action: 'business_chat.enqueue', resource: 'chat', userId: session.userId, metadata: { businessSlug: slug, http: enq.http, error: enq.error, durationMs: Date.now() - t0 } })
    return NextResponse.json({ ok: false, error: `gateway enqueue failed: ${enq.error ?? 'unknown'}`, code: 'gateway_error' }, { status: enq.http && enq.http >= 400 && enq.http < 600 ? enq.http : 502 })
  }
  audit(req, { action: 'business_chat.enqueue', resource: 'chat', userId: session.userId, metadata: { businessSlug: slug, jobId: enq.jobId, sessionId, charCount: composite.length, durationMs: Date.now() - t0 } })
  return NextResponse.json({
    ok:       true,
    jobId:    enq.jobId,
    sessionId,
    usage: {
      tokensUsed:     compositeUsage.tokensUsed,
      inputBudget:    compositeUsage.inputBudget,
      contextTokens:  compositeUsage.contextTokens,
      inputUsedPct:   compositeUsage.inputUsedPct,
      contextUsedPct: compositeUsage.contextUsedPct,
      model:          compositeUsage.model.display,
    },
  })
}

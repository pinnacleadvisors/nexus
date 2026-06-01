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
import { resolveExecMode } from '@/lib/chat/exec-mode'
import { dispatchCodexChatTurn } from '@/lib/chat/codex-direct-dispatch'
import { buildPlatformSystemPrompt } from '@/lib/chat/system-prompt-platform'
import { getActiveSession as getActiveBugHuntSession, listFindings } from '@/lib/bug-hunt/sessions'
import { getPlanWindowUsage } from '@/lib/claw/plan-window'
import { computeUsage } from '@/lib/chat/context-window'
import {
  appendMessage,
  getSession,
  createSession,
  updateSessionTitle,
  deriveTitleFromMessage,
  listMessages,
  setInflightTurn,
  markTurnError,
} from '@/lib/chat/sessions'

/**
 * Fire-and-forget kick of the chat-turn-drain reconciler so a detached turn is
 * persisted within seconds of finishing rather than at the next cron tick. Hits
 * NEXUS_BASE_URL (the deployment), gated by CRON_SECRET. Fail-soft — the cron
 * is the safety net, so a missing env or a failed kick never breaks the turn.
 */
function fireReconcilerKick(): void {
  try {
    const base   = process.env.NEXUS_BASE_URL
    const secret = process.env.CRON_SECRET
    if (!base || !secret) return
    void fetch(`${base.replace(/\/$/, '')}/api/cron/chat-turn-drain`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${secret}` },
      signal:  AbortSignal.timeout(5_000),
    }).catch(() => { /* cron tick is the safety net */ })
  } catch { /* ignore */ }
}
import { buildEditPlanResumeHint } from '@/lib/chat/edit-plan-resume'

export const runtime    = 'nodejs'
// The Claude path enqueues to the gateway and returns in <1s. The codex
// path runs synchronously inside this handler (no async job — see Phase 0
// of task_plan-model-agnostic-chat.md) so the ceiling needs to cover the
// codex-gateway round-trip plus its 30s internal timeout. 60s leaves
// margin without paying for slots that don't need it (the function still
// returns in <1s on the Claude path).
export const maxDuration = 60

interface PlatformChatBody {
  messages?:  Array<{ role?: string; content?: string }>
  /** Phase 4 — when set, the user message is persisted into chat_messages
   *  under this session and the jobId is associated with it. When unset,
   *  the route auto-creates a new session and returns its id. */
  sessionId?: string
  /** Phase 0 of task_plan-model-agnostic-chat.md — operator may opt this
   *  turn into the Codex direct-dispatch path (cheaper, subscription-billed,
   *  typed blocks unreliable). Defaults to 'claude' (the existing async-job
   *  pattern that supports typed blocks). */
  provider?: 'claude' | 'codex'
  /** Phase 1 of task_plan-mobile-copilot.md — per-turn timeout override
   *  in milliseconds. The gateway clamps to its env cap REQUEST_MAX_MS;
   *  omitting means "use the full env cap". The composer's TurnTimeoutSelector
   *  populates this from the operator's chip pick. */
  requestTimeoutMs?: number
  /** Phase 1 of task_plan-collaborative-chat.md — per-turn model override.
   *  See lib/chat/models.ts for the whitelist. Gateway passes through to
   *  `claude -p --model <id>`. */
  modelOverride?: string
  /** Phase 1 of task_plan-collaborative-chat.md — per-turn permission mode.
   *  See lib/chat/modes.ts. Gateway forwards as NEXUS_CHAT_MODE env to the
   *  agent. */
  mode?: 'ask' | 'plan' | 'auto'
}

/**
 * Legacy hard cap, kept as a sanity ceiling for the composite string size.
 * Replaced by the model's `inputBudget` (in TOKENS) — see lib/chat/context-window.ts.
 * Anything past 2 MB chars is almost certainly a runaway / DoS — refuse there.
 */
const ABSOLUTE_CHAR_CEILING = 2_000_000

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

  // Bug-hunt-loop activation. The platform-copilot is the default agent —
  // but when an active bug-hunt session exists for this user AND the
  // operator's latest message looks like a bug-hunt command (or an
  // APPROVAL reply to an iteration-plan), dispatch the bug-hunt-loop
  // agent instead so it gets its own spec loaded as the system prompt.
  //
  // The bug-hunt-loop spec at .claude/agents/bug-hunt-loop.md fully
  // describes the iteration-plan / finding-block protocol. Mixing it
  // inline into the platform-copilot spec would bloat the platform turn
  // for every chat. Splitting on agent slug is cleaner.
  const activeHunt = await getActiveBugHuntSession(session.userId, 'admin')
  const lastUserText = String(lastUser.content ?? '').trim()
  const looksLikeBugHunt = /^\/bug-hunt\b/i.test(lastUserText)
    || /^APPROVAL\s*\[\s*bh-/i.test(lastUserText)
  const useBugHuntAgent = !!activeHunt && looksLikeBugHunt

  let bugHuntContext = ''
  if (useBugHuntAgent && activeHunt) {
    // Inject the live session state so the agent's iteration-plan is
    // grounded in real numbers rather than guessing.
    const tagPrefix = `bug-hunt-${activeHunt.id}-`
    const [maxUsage, proUsage, findings] = await Promise.all([
      getPlanWindowUsage(session.userId, 'claude-max', tagPrefix),
      getPlanWindowUsage(session.userId, 'codex-pro',  tagPrefix),
      listFindings(activeHunt.id),
    ])
    const openFindings = findings.filter(f => f.status === 'open')
    bugHuntContext = [
      '## Bug-hunt session context (live)',
      '',
      `session_id:         ${activeHunt.id}`,
      `status:             ${activeHunt.status}`,
      `iteration_count:    ${activeHunt.iteration_count} / ${activeHunt.max_iterations}`,
      `plan_window_share_pct: ${activeHunt.plan_window_share_pct}`,
      `codex_window_share_pct: ${activeHunt.codex_window_share_pct}`,
      `force_plan_window:  ${activeHunt.force_plan_window}`,
      '',
      `claude_max usage:   session ${maxUsage.sessionSharePct.toFixed(1)}% / window ${maxUsage.windowSharePct.toFixed(1)}% (cap ${activeHunt.plan_window_share_pct}%)`,
      `codex_pro  usage:   session ${proUsage.sessionSharePct.toFixed(1)}% / window ${proUsage.windowSharePct.toFixed(1)}% (cap ${activeHunt.codex_window_share_pct}%)`,
      '',
      `total findings:     ${findings.length} (open: ${openFindings.length}, pr-opened: ${findings.filter(f => f.status === 'pr-opened').length}, wont-fix: ${findings.filter(f => f.status === 'wont-fix').length}, merged: ${findings.filter(f => f.status === 'merged').length})`,
      '',
      'When emitting an iteration-plan block: use the session_id above, set `iteration` to the next number (iteration_count + 1), pick a stable `approval_id` like `<session_id>-i<N>`.',
      '',
      openFindings.length > 0
        ? '## Open findings the operator may want fixed:\n\n' + openFindings.slice(0, 10).map(f => `- [${f.id}] ${f.severity} / ${f.category} — ${f.title}${f.source_path ? ` (${f.source_path})` : ''}`).join('\n')
        : '## No open findings — fresh session, propose static-audit for iteration 1.',
      '',
    ].join('\n')
  }

  // Active bug-hunt session is surfaced even when the platform-copilot
  // (not bug-hunt-loop) is dispatched, so the agent can nudge the operator
  // toward typing /bug-hunt iterate when relevant.
  const huntHint = !useBugHuntAgent && activeHunt
    ? `\n\n## Active bug-hunt session\n\nA bug-hunt session is currently ${activeHunt.status} (id: ${activeHunt.id}, iter ${activeHunt.iteration_count}/${activeHunt.max_iterations}). The operator can type "/bug-hunt iterate" to ask you to propose the next iteration's plan, OR control it from the Bug-hunt panel in the Views dropdown.\n`
    : ''

  // Crash-recovery hint — when the previous assistant message in this
  // session crashed, inject a one-line warning so the agent knows to
  // re-issue any uncompleted tool calls rather than assuming earlier
  // "pending" / "I'll write" claims actually landed.
  let crashHint = ''
  // Edit-plan resume hint — when a prior edit-plan was approved but some
  // groups never reported `edit-group-complete`, the agent gets a re-
  // anchor telling it which group to do this turn (and only that group).
  // Bigger window than the crash check — plans can span many turns.
  let editPlanResumeHint = ''
  const incomingSessionId = body.sessionId?.trim() || null
  if (incomingSessionId) {
    const recent = await listMessages(incomingSessionId, 6)
    const lastAssistant = [...recent].reverse().find(m => m.role === 'assistant')
    const crashedMeta = lastAssistant?.metadata && typeof lastAssistant.metadata === 'object'
      ? (lastAssistant.metadata as { crashed?: { exit_code?: number | null } }).crashed
      : null
    if (crashedMeta) {
      const code = crashedMeta.exit_code ?? '?'
      crashHint = `\n\n## ⚠ Previous turn crashed (exit code ${code})\n\nThe last turn ended in a CLI crash before the agent could finish its tool calls. **Re-issue any uncompleted tool calls; do not assume prior "pending" / "I'll write" / "queued" work landed.** Inspect the conversation to find what was promised but not verified, then redo it.\n`
    }
    // Resume hint scans further back (edit-plans can be approved in turn N
    // and resumed in turn N+5). 30 messages comfortably covers a multi-
    // group plan without bloating the prompt.
    const wideHistory = await listMessages(incomingSessionId, 30)
    editPlanResumeHint = buildEditPlanResumeHint(wideHistory)
  }

  const composite = useBugHuntAgent
    ? `${bugHuntContext}${crashHint}${editPlanResumeHint}\n\n---\n\nConversation so far:\n\n${transcript}\n\nThis is a bug-hunt iteration request. Emit an \`iteration-plan\` fenced JSON block per your charter, then end the turn. Do NOT run audits in this turn — the operator must approve the plan first via APPROVAL [<approval_id>]: reply.`
    : `${systemPrompt}${huntHint}${crashHint}${editPlanResumeHint}\n\n---\n\nConversation so far:\n\n${transcript}\n\nReply as CLAUDE to the latest OPERATOR message.`

  // Token-based budget check. Replaces the old 32k-char cap with the
  // model's actual input budget (~150k tokens for Claude on a 200k
  // context window). 32k chars ≈ 8k tokens — wildly under capacity.
  const compositeUsage = computeUsage(composite, useBugHuntAgent ? 'opus' : 'opus')
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

  // sessionTag prefix is what plan-window math uses to slice usage by consumer.
  // When the bug-hunt-loop agent is dispatched, tag the turn with the session
  // id so it counts toward the loop's plan-window cap (NOT the operator's
  // regular interactive chat).
  const sessionTag = useBugHuntAgent && activeHunt
    ? `bug-hunt-${activeHunt.id}-iter`
    : `platform-chat-${sessionRow.id}-${Date.now()}`
  const t0         = Date.now()

  // Phase 0 of task_plan-model-agnostic-chat.md — operator may opt this
  // turn into Codex direct-dispatch. Skips the async-job pattern (no
  // jobId, no polling). Bug-hunt loop is explicitly forced back to Claude
  // because its iteration-plan / finding blocks REQUIRE Claude's typed
  // block emission to work at all.
  if (body.provider === 'codex' && !useBugHuntAgent) {
    const cdx = await dispatchCodexChatTurn({
      userId:     session.userId,
      sessionId:  sessionRow.id,
      agentSlug:  'platform-copilot',
      message:    composite,
      sessionTag,
    })
    audit(req, {
      action:   'platform_chat.codex_direct',
      resource: 'chat',
      userId:   session.userId,
      metadata: { ok: cdx.ok, sessionId: sessionRow.id, sessionTag, durationMs: cdx.durationMs, error: cdx.error },
    })
    if (!cdx.ok) {
      // Return 200 + {ok:false} per retry-storm rule. A real 502 from the
      // Next.js route gets intercepted by Cloudflare's "502 Bad Gateway"
      // HTML page which replaces our JSON body, so the operator sees raw
      // <!DOCTYPE html> instead of the actionable error message.
      return NextResponse.json({
        ok:           false,
        mode:         'codex-direct',
        error:        cdx.error ?? 'codex dispatch failed',
        fallbackHint: cdx.fallbackHint ?? 'Codex gateway unreachable — try Claude instead, or check /settings → AI Providers for codex-gateway health.',
        code:         'codex_error',
      })
    }
    return NextResponse.json({
      ok:        true,
      mode:      'codex-direct',
      sessionId: sessionRow.id,
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

  // Subscription-billing control: route through the interactive pty path when
  // the operator's execution_mode pref is subscription/node-pty (Max/Pro
  // billing); 'api' uses the `-p` path. Unset → gateway default. See
  // lib/chat/exec-mode.ts + services/claude-gateway/src/spawnPty.ts.
  const execMode = await resolveExecMode(session.userId)

  const enqueued = await enqueueGatewayJob({
    gatewayUrl:  gateway.gatewayUrl,
    bearerToken: gateway.bearerToken,
    sessionTag,
    agentSlug:   useBugHuntAgent ? 'bug-hunt-loop' : 'platform-copilot',
    message:     composite,
    userId:      session.userId,
    timeoutMs:   10_000,
    requestTimeoutMs: body.requestTimeoutMs,
    modelOverride: body.modelOverride,
    mode: body.mode,
    execMode,
  })

  if (!enqueued.ok || !enqueued.jobId) {
    audit(req, {
      action:   'platform_chat.enqueue',
      resource: 'chat',
      userId:   session.userId,
      metadata: { stage: 'enqueue', http: enqueued.http, error: enqueued.error, durationMs: Date.now() - t0 },
    })
    // Phase D3 — stamp the failure onto the just-persisted user message so it
    // survives a reload + surfaces in /inbox, instead of living only in the
    // client's React state (lost on navigation). Fail-soft.
    await markTurnError(sessionRow.id, {
      code:    'gateway_error',
      message: `gateway enqueue failed: ${enqueued.error ?? 'unknown'}`,
    })
    return NextResponse.json({
      ok:    false,
      error: `gateway enqueue failed: ${enqueued.error ?? 'unknown'}`,
      code:  'gateway_error',
    }, { status: enqueued.http && enqueued.http >= 400 && enqueued.http < 600 ? enqueued.http : 502 })
  }

  // Durable chat (migration 099): record the in-flight job so a server-side
  // reconciler can drain it to chat_messages even if the browser closes, then
  // fire-and-forget a reconciler kick so the common case drains in seconds
  // rather than waiting for the 2-min cron tick. Both fail-soft.
  await setInflightTurn(sessionRow.id, enqueued.jobId)
  fireReconcilerKick()

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

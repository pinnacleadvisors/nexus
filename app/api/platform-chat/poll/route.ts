/**
 * GET /api/platform-chat/poll?jobId=<id>
 *
 * Proxies the gateway's GET /api/jobs/:jobId so the chat UI can poll without
 * exposing the gateway URL + bearer to the browser. The client polls this
 * every 2-3 seconds until status === 'done' or 'error'.
 *
 * Returns 200 (regardless of job state — it's a poll, not a transactional op):
 *   { ok: true,
 *     status:  'pending' | 'running' | 'done' | 'error',
 *     text?:   string,            // final assistant text when status === 'done'
 *     jobError?: string,          // native CLI error when status === 'error'
 *     durationMs?: number,
 *     createdAt?: number, startedAt?: number, finishedAt?: number }
 *
 * Returns 4xx on auth / bad input.
 * Returns 5xx on gateway-side transport errors (rare — most failures land
 * as { ok: true, status: 'error', jobError: ... } from the gateway itself).
 *
 * Cost-cap guard is intentionally NOT re-checked here — the spend was
 * committed at enqueue time. Repeating the check on every poll would 402
 * mid-execution which is worse UX than letting the in-flight job finish.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { resolveClaudeCodeConfig } from '@/lib/claw/business-client'
import { getGatewayJob } from '@/lib/claw/gateway-jobs'
import { parseAssistantMessage } from '@/lib/chat/approval'
import { parseManualTaskBlocks } from '@/lib/chat/manual-task'
import { parseIterationPlans } from '@/lib/chat/iteration-plan'
import { parseBugHuntFindings } from '@/lib/chat/bug-hunt-finding'
import { parseEditPlanBlocks } from '@/lib/chat/edit-plan'
import { appendMessage, getSession } from '@/lib/chat/sessions'
import { createTask } from '@/lib/views/tasks'
import { getSession as getBugHuntSession, insertFinding, bumpIteration } from '@/lib/bug-hunt/sessions'
import { insertGatewayTurn } from '@/lib/claw/gateway-turns'
import { parseCrash } from '@/lib/chat/crash'

export const runtime    = 'nodejs'
export const maxDuration = 15   // Single GET to gateway, default poll budget is small.

export async function GET(req: NextRequest) {
  // Poll loop fires every 2-3s — generous bucket so a normal turn doesn't 429.
  const rl = await rateLimit(req, { limit: 120, window: '1 m', prefix: 'platform-chat:poll' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized', code: 'unauthorized' }, { status: 401 })
  }
  // Capture for closures (async sub-helpers below lose TS narrowing on
  // `session.userId` otherwise).
  const userId: string = session.userId

  const jobId = new URL(req.url).searchParams.get('jobId')?.trim()
  if (!jobId) {
    return NextResponse.json({ ok: false, error: 'jobId query param required', code: 'invalid' }, { status: 400 })
  }
  // Defensive: enforce a sane shape so we don't proxy arbitrary strings.
  if (!/^job_[A-Za-z0-9_-]{6,128}$/.test(jobId)) {
    return NextResponse.json({ ok: false, error: 'malformed jobId', code: 'invalid' }, { status: 400 })
  }

  const gateway = await resolveClaudeCodeConfig(session.userId)
  if (!gateway) {
    return NextResponse.json({
      ok:    false,
      error: 'claude-gateway not configured',
      code:  'no_gateway',
    }, { status: 503 })
  }

  const result = await getGatewayJob({
    gatewayUrl:  gateway.gatewayUrl,
    bearerToken: gateway.bearerToken,
    jobId,
    userId:      session.userId,
    timeoutMs:   10_000,
  })

  if (!result.ok) {
    // Gateway transport error (not a job-level error — those return ok:true).
    return NextResponse.json({
      ok:    false,
      error: `gateway poll failed: ${result.error ?? 'unknown'}`,
      code:  'gateway_error',
    }, { status: result.http && result.http >= 400 && result.http < 600 ? result.http : 502 })
  }

  // Phase 3 — extract approval-request blocks from the assistant text so
  // the client can render them as inline buttons instead of raw JSON.
  // Phase 4 — when the job lands `done` and the caller passes sessionId,
  // persist the assistant reply (with parsed approvals as metadata) so
  // the conversation is durable across page reloads.
  let displayText        = result.text ?? ''
  let approvalRequests   = [] as ReturnType<typeof parseAssistantMessage>['approval_requests']
  // Edit-plan + group-complete arrays surface in the poll response so the
  // client can render EditPlanCards inline. Populated inside the
  // status==='done' branch; default to empty so the response shape is stable.
  let editPlans          = [] as ReturnType<typeof parseEditPlanBlocks>['plans']
  let editGroupCompletes = [] as ReturnType<typeof parseEditPlanBlocks>['group_completes']

  // Crash detection — covers two failure shapes:
  //   1. status='error' with jobError set (CLI exited with code != 0)
  //   2. status='done' but result.jobError still populated (some gateway
  //      versions emit the partial-text + error pair when the CLI dies
  //      mid-stream — we want to surface BOTH the streamed text AND the
  //      crash card)
  // parseCrash extracts the exit code + stderr tail from the formatted
  // gateway error string.
  const crashedRaw = result.jobError || (result.status === 'error' ? result.error : undefined)
  const crash = crashedRaw ? parseCrash(crashedRaw) : null
  const isCrashed = !!crash

  if (result.status === 'done' && result.text) {
    const parsed = parseAssistantMessage(result.text)
    displayText      = parsed.text
    approvalRequests = parsed.approval_requests

    // Phase 9 — extract any `manual-task` fenced blocks the agent emitted
    // and insert them into operator_tasks. Strip the blocks from displayText
    // so they don't render raw to the operator (the Tasks panel shows them).
    const taskParse = parseManualTaskBlocks(displayText)
    displayText = taskParse.text

    // Bug-hunt loop (PR-1) — extract iteration-plan + bug-hunt-finding blocks.
    // iteration-plan blocks: the inner ApprovalRequest is added to the
    //   approval_requests array so the existing ApprovalCard UI renders it
    //   (extra context — iteration number, intent — appears in metadata).
    // bug-hunt-finding blocks: each becomes a row in bug_hunt_findings, but
    //   ONLY when the session_id maps to an active session owned by the user
    //   (server-side override defeats prompt-injection cross-session writes).
    const iterParse    = parseIterationPlans(displayText)
    displayText        = iterParse.text
    const findingParse = parseBugHuntFindings(displayText)
    displayText        = findingParse.text
    // Edit-plan blocks — the agent proposes chunked multi-turn edits here.
    // The EditPlanCard renders these as approval cards with file-level
    // granularity; the enqueue-side resume hint reads them on subsequent
    // turns to re-anchor the agent on the next un-completed group.
    const editPlanParse = parseEditPlanBlocks(displayText)
    displayText         = editPlanParse.text
    editPlans           = editPlanParse.plans
    editGroupCompletes  = editPlanParse.group_completes
    // The agent's iteration-plan items render as ApprovalCards via the normal
    // protocol. Append the inner approval requests so the chat surfaces them.
    for (const p of iterParse.plans) approvalRequests = [...approvalRequests, p.approval]

    const sessionId = new URL(req.url).searchParams.get('sessionId')?.trim()
    if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) {
      const owned = await getSession(session.userId, sessionId)
      if (owned) {
        for (const t of taskParse.tasks) {
          await createTask({
            userId:           session.userId,
            scope:            'admin',        // platform-chat = admin scope
            title:            t.title,
            description:      t.description ?? null,
            dueAt:            t.due_at ?? null,
            source:           'agent',
            sourceSessionId:  sessionId,
          })
        }
        // Insert findings — but only for sessions owned by the user. The
        // session_id in the block is trusted ONLY after we verify ownership.
        const ownedBugHuntSessions = new Map<string, boolean>()
        async function ownsBugHunt(bhId: string): Promise<boolean> {
          if (ownedBugHuntSessions.has(bhId)) return ownedBugHuntSessions.get(bhId)!
          const row = await getBugHuntSession(userId, bhId)
          const ok = !!row
          ownedBugHuntSessions.set(bhId, ok)
          return ok
        }
        for (const f of findingParse.findings) {
          if (!(await ownsBugHunt(f.session_id))) continue
          await insertFinding({
            sessionId:  f.session_id,
            iteration:  f.iteration,
            severity:   f.severity,
            category:   f.category,
            title:      f.title,
            detail:     f.detail ?? null,
            sourcePath: f.source_path ?? null,
          })
        }
        // Bump iteration counters for any iteration-plan blocks that target
        // a session this user owns — the operator's approval implicitly
        // marks "iteration N is now live".
        const bumpedSessions = new Set<string>()
        for (const p of iterParse.plans) {
          if (bumpedSessions.has(p.session_id)) continue
          if (!(await ownsBugHunt(p.session_id))) continue
          await bumpIteration(userId, p.session_id)
          bumpedSessions.add(p.session_id)
        }
        await appendMessage({
          sessionId,
          role:    'assistant',
          content: displayText,
          metadata: {
            durationMs:        result.durationMs,
            jobId,
            approval_requests: approvalRequests,
            tool_calls:        result.toolCalls,    // Phase 2b — persisted with the message
            manual_tasks:      taskParse.tasks.length > 0 ? taskParse.tasks : undefined,
            iteration_plans:   iterParse.plans.length > 0 ? iterParse.plans : undefined,
            findings_inserted: findingParse.findings.length || undefined,
            edit_plans:        editPlanParse.plans.length > 0 ? editPlanParse.plans : undefined,
            edit_group_completes: editPlanParse.group_completes.length > 0 ? editPlanParse.group_completes : undefined,
            // Crash flag survives page reload — the system-prompt builder
            // reads this on the next turn to inject the "previous turn
            // crashed" hint into the dispatch.
            crashed:           isCrashed ? { exit_code: crash?.exitCode ?? null, stderr_tail: crash?.stderrTail ?? null, raw: crash?.rawError ?? null } : undefined,
          },
        })
      }
    }

    // (handled inside the done-branch)
    // Record the gateway turn for plan-window accounting. Fire-and-forget.
    // Use the most-relevant bug-hunt session_id (first one referenced in
    // the assistant message) so the session-slice math attributes correctly.
    const huntTag = iterParse.plans[0]?.session_id ?? findingParse.findings[0]?.session_id
    const sessionTag = huntTag ? `bug-hunt-${huntTag}-iter` : 'platform-chat'
    const toolCallsCount = Array.isArray(result.toolCalls) ? result.toolCalls.length : 0
    void insertGatewayTurn({
      userId:         session.userId,
      plan:           'claude-max',
      model:          'opus',          // platform-copilot defaults to opus
      sessionTag,
      durationMs:     result.durationMs ?? null,
      toolCallsCount,
    })
  }

  // If the job ended with status='error' (gateway CLI died without
  // emitting any final assistant text), persist a placeholder message
  // so the operator sees a crash card on reload.
  if (result.status === 'error' && !result.text) {
    const sessionIdParam = new URL(req.url).searchParams.get('sessionId')?.trim()
    if (sessionIdParam && /^[0-9a-f-]{36}$/i.test(sessionIdParam)) {
      const owned = await getSession(userId, sessionIdParam)
      if (owned) {
        await appendMessage({
          sessionId: sessionIdParam,
          role:      'assistant',
          content:   '',
          metadata:  {
            durationMs: result.durationMs,
            jobId,
            crashed:    { exit_code: crash?.exitCode ?? null, stderr_tail: crash?.stderrTail ?? null, raw: crash?.rawError ?? result.jobError ?? null },
          },
        })
      }
    }
  }

  return NextResponse.json({
    ok:                    true,
    status:                result.status,
    text:                  displayText,
    /** Phase 2a — partial text accumulated while running. Client renders
     *  this as a tentative bubble between polls so long Opus runs feel
     *  progressive without going through SSE. */
    partialText:           result.partialText,
    approval_requests:     approvalRequests,
    tool_calls:            result.toolCalls,    // Phase 2b — chat renders cards
    /** Multi-turn edit plans the agent emitted this turn. Client renders
     *  an EditPlanCard per entry. */
    edit_plans:            editPlans.length > 0 ? editPlans : undefined,
    /** Per-group completion markers. Client uses these to flip group
     *  checkboxes to ✓ on prior cards. */
    edit_group_completes:  editGroupCompletes.length > 0 ? editGroupCompletes : undefined,
    jobError:              result.jobError,
    /** Crash info parsed from the gateway error — when present, the
     *  client renders a CrashedTurnCard above the assistant bubble. */
    crashed:           isCrashed
      ? { exit_code: crash?.exitCode ?? null, stderr_tail: crash?.stderrTail ?? null, raw: crash?.rawError ?? null }
      : undefined,
    durationMs:        result.durationMs,
    createdAt:         result.createdAt,
    startedAt:         result.startedAt,
    finishedAt:        result.finishedAt,
  })
}

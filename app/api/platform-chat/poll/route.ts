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
import { listPendingForJob, type PermissionRequestRow } from '@/lib/chat/permission-requests'
import { appendMessage, getSession } from '@/lib/chat/sessions'
import { parseCrash } from '@/lib/chat/crash'
import {
  parseTurnBlocks,
  persistCompletedTurn,
  recordCompletedTurnAccounting,
  type ParsedTurnBlocks,
} from '@/lib/chat/persist-completed-turn'

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

  // Fetch any pending permission requests for this jobId (PR #189). The
  // broker MCP inside the gateway writes them when the CLI hits a tool
  // call that isn't pre-approved. We always return them — even when the
  // gateway poll itself errored — so the UI can show the Allow/Deny
  // card and unblock the running turn.
  let pendingPermissions: PermissionRequestRow[] = []
  try {
    pendingPermissions = await listPendingForJob(userId, jobId)
  } catch { /* swallow — poll is a hot-path, never throw on the side-channel */ }

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
  // Extracted into lib/chat/persist-completed-turn.ts so the new SSE
  // bridge at /api/platform-chat/stream uses the same logic.
  let displayText        = result.text ?? ''
  let approvalRequests   = [] as ReturnType<typeof parseAssistantMessage>['approval_requests']
  let editPlans          = [] as ParsedTurnBlocks['edit_plans']
  let editGroupCompletes = [] as ParsedTurnBlocks['edit_group_completes']
  let editSelfs          = [] as ParsedTurnBlocks['edit_selfs']

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
    const sessionIdParam = new URL(req.url).searchParams.get('sessionId')?.trim()
    const sessionIdValid = sessionIdParam && /^[0-9a-f-]{36}$/i.test(sessionIdParam) ? sessionIdParam : null
    const owned          = sessionIdValid ? await getSession(userId, sessionIdValid) : null

    if (owned && sessionIdValid) {
      // Happy path — full parse + persist + accounting in one helper call.
      const persisted = await persistCompletedTurn({
        userId,
        sessionId:   sessionIdValid,
        jobId,
        gatewayText: result.text,
        toolCalls:   result.toolCalls,
        durationMs:  result.durationMs,
        crashed:     crash,
        usage:       result.usage,
      })
      displayText        = persisted.displayText
      approvalRequests   = persisted.approval_requests
      editPlans          = persisted.edit_plans
      editGroupCompletes = persisted.edit_group_completes
      editSelfs          = persisted.edit_selfs
    } else {
      // Defensive — sessionId missing or unowned. Still parse for the
      // response shape and still record accounting (spend was committed
      // at enqueue time regardless of who reads the result), but skip
      // the persistence + side-effects path.
      const parsed = parseTurnBlocks(result.text)
      displayText        = parsed.displayText
      approvalRequests   = parsed.approval_requests
      editPlans          = parsed.edit_plans
      editGroupCompletes = parsed.edit_group_completes
      editSelfs          = parsed.edit_selfs
      recordCompletedTurnAccounting({
        userId,
        parsed,
        durationMs:     result.durationMs ?? null,
        toolCallsCount: Array.isArray(result.toolCalls) ? result.toolCalls.length : 0,
        usage:          result.usage,
      })
    }
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
    /** Self-modification proposals (Continual Harness pattern). Client
     *  renders an EditSelfCard per entry; operator approves via the same
     *  APPROVAL [<plan_id>]: ... syntax as edit-plan. */
    edit_selfs:            editSelfs.length > 0 ? editSelfs : undefined,
    /** Pending CLI tool-permission requests (PR #189). Client renders a
     *  PermissionPromptCard per entry. While the array is non-empty the
     *  gateway turn is paused — operator Allow/Deny on /api/platform-
     *  chat/permission-requests/:id unblocks the broker MCP's poll. */
    pending_permission_requests: pendingPermissions.length > 0 ? pendingPermissions : undefined,
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

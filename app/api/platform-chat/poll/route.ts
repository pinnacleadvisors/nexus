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
import { appendMessage, getSession } from '@/lib/chat/sessions'

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

  if (result.status === 'done' && result.text) {
    const parsed = parseAssistantMessage(result.text)
    displayText      = parsed.text
    approvalRequests = parsed.approval_requests

    const sessionId = new URL(req.url).searchParams.get('sessionId')?.trim()
    if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) {
      const owned = await getSession(session.userId, sessionId)
      if (owned) {
        await appendMessage({
          sessionId,
          role:    'assistant',
          content: displayText,
          metadata: {
            durationMs:        result.durationMs,
            jobId,
            approval_requests: approvalRequests,
            tool_calls:        result.toolCalls,    // Phase 2b — persisted with the message
          },
        })
      }
    }
  }

  return NextResponse.json({
    ok:                true,
    status:            result.status,
    text:              displayText,
    /** Phase 2a — partial text accumulated while running. Client renders
     *  this as a tentative bubble between polls so long Opus runs feel
     *  progressive without going through SSE. */
    partialText:       result.partialText,
    approval_requests: approvalRequests,
    tool_calls:        result.toolCalls,    // Phase 2b — chat renders cards
    jobError:          result.jobError,
    durationMs:        result.durationMs,
    createdAt:         result.createdAt,
    startedAt:         result.startedAt,
    finishedAt:        result.finishedAt,
  })
}

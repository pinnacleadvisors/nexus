/**
 * GET /api/businesses/[slug]/chat/poll?jobId=<id>&sessionId=<id>
 *
 * Mirror of /api/platform-chat/poll for the per-business gateway.
 * Resolves the right per-business gateway via resolveClawConfig(userId, slug),
 * proxies the gateway's GET /api/jobs/:id, parses any approval-request
 * blocks from the final assistant text, and persists the assistant reply
 * into chat_messages when sessionId is provided + ownership verified.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { resolveClawConfig, isBusinessSlug } from '@/lib/claw/business-client'
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
export const maxDuration = 15

export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const rl = await rateLimit(req, { limit: 120, window: '1 m', prefix: 'business-chat:poll' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized', code: 'unauthorized' }, { status: 401 })

  const { slug } = await context.params
  if (!isBusinessSlug(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid business slug', code: 'invalid' }, { status: 400 })
  }

  const jobId = new URL(req.url).searchParams.get('jobId')?.trim()
  if (!jobId || !/^job_[A-Za-z0-9_-]{6,128}$/.test(jobId)) {
    return NextResponse.json({ ok: false, error: 'jobId query param required', code: 'invalid' }, { status: 400 })
  }

  const gateway = await resolveClawConfig(session.userId, slug)
  if (!gateway) {
    return NextResponse.json({ ok: false, error: `no gateway for business "${slug}"`, code: 'no_gateway' }, { status: 503 })
  }

  const result = await getGatewayJob({
    gatewayUrl:  gateway.gatewayUrl,
    bearerToken: gateway.bearerToken,
    jobId,
    userId:      session.userId,
    timeoutMs:   10_000,
  })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: `gateway poll failed: ${result.error ?? 'unknown'}`, code: 'gateway_error' }, { status: result.http && result.http >= 400 && result.http < 600 ? result.http : 502 })
  }

  let pendingPermissions: PermissionRequestRow[] = []
  try { pendingPermissions = await listPendingForJob(session.userId, jobId) } catch { /* swallow */ }

  let displayText        = result.text ?? ''
  let approvalRequests   = [] as ReturnType<typeof parseAssistantMessage>['approval_requests']
  let editPlans          = [] as ParsedTurnBlocks['edit_plans']
  let editGroupCompletes = [] as ParsedTurnBlocks['edit_group_completes']

  // Crash detection — see app/api/platform-chat/poll/route.ts for design notes.
  const crashedRaw = result.jobError || (result.status === 'error' ? result.error : undefined)
  const crash = crashedRaw ? parseCrash(crashedRaw) : null
  const isCrashed = !!crash

  if (result.status === 'done' && result.text) {
    const sessionIdParam = new URL(req.url).searchParams.get('sessionId')?.trim()
    const sessionIdValid = sessionIdParam && /^[0-9a-f-]{36}$/i.test(sessionIdParam) ? sessionIdParam : null
    // Defence-in-depth — the session must belong to THIS business, not
    // just to the user. A malicious sessionId from another scope (admin
    // or a different business) would otherwise persist under the wrong row.
    const owned = sessionIdValid ? await getSession(session.userId, sessionIdValid) : null
    const scopeMatches = owned?.scope === `business:${slug}`

    if (owned && scopeMatches && sessionIdValid) {
      const persisted = await persistCompletedTurn({
        userId:             session.userId,
        sessionId:          sessionIdValid,
        jobId,
        gatewayText:        result.text,
        toolCalls:          result.toolCalls,
        durationMs:         result.durationMs,
        crashed:            crash,
        taskScope:          `business:${slug}`,
        sessionTagFallback: `business-chat-${slug}`,
        usage:              result.usage,
      })
      displayText        = persisted.displayText
      approvalRequests   = persisted.approval_requests
      editPlans          = persisted.edit_plans
      editGroupCompletes = persisted.edit_group_completes
    } else {
      // Defensive — sessionId missing, unowned, or cross-scope. Still
      // parse for the response shape and still record accounting (the
      // spend was committed at enqueue time regardless of who reads the
      // result), but skip the persistence + side-effects path.
      const parsed = parseTurnBlocks(result.text)
      displayText        = parsed.displayText
      approvalRequests   = parsed.approval_requests
      editPlans          = parsed.edit_plans
      editGroupCompletes = parsed.edit_group_completes
      recordCompletedTurnAccounting({
        userId:             session.userId,
        parsed,
        durationMs:         result.durationMs ?? null,
        toolCallsCount:     Array.isArray(result.toolCalls) ? result.toolCalls.length : 0,
        sessionTagFallback: `business-chat-${slug}`,
        usage:              result.usage,
      })
    }
  }

  // Persist a placeholder when the gateway died WITHOUT any final text —
  // so reload shows the crash card.
  if (result.status === 'error' && !result.text) {
    const sessionId2 = new URL(req.url).searchParams.get('sessionId')?.trim()
    if (sessionId2 && /^[0-9a-f-]{36}$/i.test(sessionId2)) {
      const owned = await getSession(session.userId, sessionId2)
      if (owned && owned.scope === `business:${slug}`) {
        await appendMessage({
          sessionId: sessionId2,
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
    partialText:           result.partialText,
    tool_calls:            result.toolCalls,
    approval_requests:     approvalRequests,
    edit_plans:            editPlans.length > 0 ? editPlans : undefined,
    edit_group_completes:  editGroupCompletes.length > 0 ? editGroupCompletes : undefined,
    pending_permission_requests: pendingPermissions.length > 0 ? pendingPermissions : undefined,
    jobError:              result.jobError,
    crashed:           isCrashed ? { exit_code: crash?.exitCode ?? null, stderr_tail: crash?.stderrTail ?? null, raw: crash?.rawError ?? null } : undefined,
    durationMs:        result.durationMs,
    createdAt:         result.createdAt,
    startedAt:         result.startedAt,
    finishedAt:        result.finishedAt,
  })
}

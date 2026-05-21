/**
 * GET /api/businesses/[slug]/chat/stream?jobId=<id>&sessionId=<uuid>
 *
 * Per-business mirror of /api/platform-chat/stream — SSE bridge between
 * the browser and the gateway's async job model, scoped to a single
 * business. Client first hits POST /api/businesses/[slug]/chat to enqueue,
 * then connects here with the returned jobId. Same 250ms inner-poll +
 * delta/done/continue/error event protocol as the platform route.
 *
 * Differences from the platform route:
 *   - Resolves gateway via resolveClawConfig(userId, slug) so per-business
 *     containers are picked up automatically.
 *   - Verifies the chat session's scope === `business:<slug>` (defence
 *     against cross-business session-id forging).
 *   - Passes taskScope=`business:<slug>` + sessionTagFallback=
 *     `business-chat-<slug>` to persistCompletedTurn so the right Tasks
 *     panel renders any emitted manual-task rows and per-business spend
 *     attribution stays clean.
 *   - Gated by BUSINESS_CHAT_STREAM_ENABLED so platform vs business
 *     surfaces can roll out independently.
 *
 * See app/api/platform-chat/stream/route.ts for full design rationale —
 * the architecture, wire format, and pitfall-mitigation are identical.
 */

import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { resolveClawConfig, isBusinessSlug } from '@/lib/claw/business-client'
import { getGatewayJob } from '@/lib/claw/gateway-jobs'
import { listPendingForJob } from '@/lib/chat/permission-requests'
import { getSession, appendMessage } from '@/lib/chat/sessions'
import { parseCrash } from '@/lib/chat/crash'
import { persistCompletedTurn } from '@/lib/chat/persist-completed-turn'
import {
  writeSseEvent,
  writeSseComment,
  type StreamEventReady,
  type StreamEventDelta,
  type StreamEventDone,
  type StreamEventContinue,
  type StreamEventError,
  type StreamErrorCode,
  type StreamEventToolEvent,
} from '@/lib/chat/stream-events'
import type { ToolCall } from '@/lib/claw/gateway-jobs'

export const runtime    = 'nodejs'
export const maxDuration = 300

const INNER_POLL_MS         = 250
const HEARTBEAT_MS          = 15_000
const MAX_DURATION_GUARD_MS = 280_000
const INNER_FETCH_TIMEOUT   = 10_000

function streamingDisabled(): boolean {
  return (process.env.BUSINESS_CHAT_STREAM_ENABLED ?? '1') === '0'
}

export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'business-chat:stream' })
  if (!rl.success) return rateLimitResponse(rl)

  if (streamingDisabled()) {
    return new Response(
      JSON.stringify({ ok: false, error: 'stream disabled', code: 'streaming_disabled' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const session = await auth()
  if (!session.userId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'unauthorized', code: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const userId: string = session.userId

  const { slug } = await context.params
  if (!isBusinessSlug(slug)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'invalid business slug', code: 'invalid' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const url       = new URL(req.url)
  const jobId     = url.searchParams.get('jobId')?.trim()
  const sessionId = url.searchParams.get('sessionId')?.trim()
  if (!jobId || !/^job_[A-Za-z0-9_-]{6,128}$/.test(jobId)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'jobId query param required (must match /^job_[A-Za-z0-9_-]{6,128}$/)', code: 'invalid' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'sessionId query param required (must be a uuid)', code: 'invalid' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const owned = await getSession(userId, sessionId)
  if (!owned || owned.scope !== `business:${slug}`) {
    // 404 (not 403) on cross-scope so we don't reveal whether the session
    // exists under a different scope — same shape as the platform route.
    return new Response(
      JSON.stringify({ ok: false, error: 'session not found', code: 'not_found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const gateway = await resolveClawConfig(userId, slug)
  if (!gateway) {
    return new Response(
      JSON.stringify({
        ok:    false,
        error: `no gateway configured for business "${slug}"`,
        code:  'no_gateway',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // ── ReadableStream body ─────────────────────────────────────────────────
  const start = Date.now()
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Flush an SSE comment immediately so proxies (Cloudflare, Vercel
      // edge) commit to the response and stop buffering before the first
      // delta. Without this the operator can wait 5-10s before seeing
      // anything even though the gateway is streaming.
      writeSseComment(controller, 'open')

      heartbeatTimer = setInterval(() => {
        if (closed) return
        try { writeSseComment(controller, 'heartbeat') } catch { /* enqueue after close */ }
      }, HEARTBEAT_MS)

      const safeClose = () => {
        if (closed) return
        closed = true
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
        try { controller.close() } catch { /* already closed */ }
      }

      const emitError = (code: StreamErrorCode, message: string, includeJobId = true): void => {
        const payload: StreamEventError = includeJobId
          ? { code, message, jobId }
          : { code, message }
        try { writeSseEvent(controller, 'error', payload) } catch { /* already closed */ }
      }

      try {
        const ready: StreamEventReady = {
          jobId,
          sessionId,
          sessionTag: `business-chat-${slug}-${sessionId}-${start}`,
        }
        writeSseEvent(controller, 'ready', ready)

        let lastEmittedLen = 0
        // Phase 3 — progressive tool-call diff (see platform stream route
        // for design notes; this is the same shape).
        const lastEmittedToolCalls = new Map<string, { startedAt: number; finishedAt?: number }>()
        const emitToolDiff = (snapshot: ToolCall[] | undefined): void => {
          if (!Array.isArray(snapshot)) return
          for (const call of snapshot) {
            if (typeof call.id !== 'string') continue
            const prev = lastEmittedToolCalls.get(call.id)
            const finishedChanged = !!call.finishedAt && (!prev || !prev.finishedAt)
            if (!prev || finishedChanged) {
              const evt: StreamEventToolEvent = { call }
              writeSseEvent(controller, 'tool_event', evt)
              lastEmittedToolCalls.set(call.id, {
                startedAt:  call.startedAt,
                finishedAt: call.finishedAt,
              })
            }
          }
        }

        while (!closed) {
          if (Date.now() - start > MAX_DURATION_GUARD_MS) {
            const cont: StreamEventContinue = {
              jobId,
              sessionId,
              reason: 'max_duration_approaching',
            }
            writeSseEvent(controller, 'continue', cont)
            break
          }

          const result = await getGatewayJob({
            gatewayUrl:  gateway.gatewayUrl,
            bearerToken: gateway.bearerToken,
            jobId,
            userId,
            timeoutMs:   INNER_FETCH_TIMEOUT,
          })

          if (!result.ok) {
            emitError('gateway_error', `gateway poll failed: ${result.error ?? 'unknown'}`)
            break
          }

          if (typeof result.partialText === 'string' && result.partialText.length > lastEmittedLen) {
            const delta: StreamEventDelta = {
              text: result.partialText.slice(lastEmittedLen),
            }
            writeSseEvent(controller, 'delta', delta)
            lastEmittedLen = result.partialText.length
          }

          // Phase 3 — emit progressive tool-call events.
          emitToolDiff(result.partialToolCalls)

          if (result.status === 'done') {
            // Final tool-event sweep to cover the same-tick race.
            emitToolDiff(result.partialToolCalls)
            const text = result.text ?? ''
            let pendingPermissions: Awaited<ReturnType<typeof listPendingForJob>> = []
            try { pendingPermissions = await listPendingForJob(userId, jobId) }
            catch { /* swallow */ }

            const crashedRaw = result.jobError || undefined
            const crash      = crashedRaw ? parseCrash(crashedRaw) : null

            if (text) {
              const persisted = await persistCompletedTurn({
                userId,
                sessionId,
                jobId,
                gatewayText:        text,
                toolCalls:          result.toolCalls,
                durationMs:         result.durationMs,
                crashed:            crash,
                pendingPermissions,
                taskScope:          `business:${slug}`,
                sessionTagFallback: `business-chat-${slug}`,
                usage:              result.usage,
              })
              const done: StreamEventDone = {
                text:                        persisted.displayText,
                approval_requests:           persisted.approval_requests,
                tool_calls:                  persisted.tool_calls,
                manual_tasks:                persisted.manual_tasks.length > 0       ? persisted.manual_tasks       : undefined,
                iteration_plans:             persisted.iteration_plans.length > 0    ? persisted.iteration_plans    : undefined,
                edit_plans:                  persisted.edit_plans.length > 0         ? persisted.edit_plans         : undefined,
                edit_group_completes:        persisted.edit_group_completes.length > 0 ? persisted.edit_group_completes : undefined,
                pending_permission_requests: persisted.pending_permission_requests,
                crashed:                     persisted.crashed,
                durationMs:                  persisted.durationMs,
                persisted:                   true,
              }
              writeSseEvent(controller, 'done', done)
            } else {
              const done: StreamEventDone = {
                text:                        '',
                approval_requests:           [],
                tool_calls:                  result.toolCalls,
                pending_permission_requests: pendingPermissions.length > 0 ? pendingPermissions : undefined,
                durationMs:                  result.durationMs,
                persisted:                   false,
              }
              writeSseEvent(controller, 'done', done)
            }
            break
          }

          if (result.status === 'error') {
            const crashedRaw = result.jobError || result.error || 'gateway_error'
            const crash      = parseCrash(crashedRaw)
            try {
              if (!result.text) {
                await appendMessage({
                  sessionId,
                  role:      'assistant',
                  content:   '',
                  metadata:  {
                    durationMs: result.durationMs,
                    jobId,
                    crashed:    {
                      exit_code:   crash?.exitCode   ?? null,
                      stderr_tail: crash?.stderrTail ?? null,
                      raw:         crash?.rawError   ?? crashedRaw,
                    },
                  },
                })
              }
            } catch { /* persistence best-effort */ }
            emitError('gateway_error', crashedRaw)
            break
          }

          await new Promise(r => setTimeout(r, INNER_POLL_MS))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        try { emitError('mid_stream', msg) } catch { /* already closed */ }
      } finally {
        safeClose()
      }
    },
    cancel() {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

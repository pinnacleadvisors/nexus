/**
 * GET /api/platform-chat/stream?jobId=<id>&sessionId=<uuid>
 *
 * SSE bridge between the browser and the gateway's async job model.
 * Client first hits POST /api/platform-chat (unchanged) to enqueue a job,
 * then connects here with the returned jobId. We inner-poll the gateway
 * every 250ms and emit `delta` events as partial text grows; when the
 * job finishes we call persistCompletedTurn (same path as /poll uses)
 * and emit a single `done` event with the full structured payload.
 *
 * Why GET+jobId vs all-in-one POST (Plan-agent finding 2026-05-17):
 *   - Reconnect on TCP drop is trivial — same URL, same jobId.
 *   - The whole 300s function budget is for streaming, not enqueue.
 *   - Existing pollUntilDone(jobId) is a zero-server-change fallback.
 *
 * Why fast-poll-inside-SSE vs proxying the gateway's /stream endpoint:
 *   - Gateway /stream holds the connection AND a queue slot for the full
 *     CLI run (up to 600s). One TCP drop loses everything.
 *   - The job model already pipes onDelta -> partialText, so we're just
 *     reading the same delta source from a different surface.
 *   - 250ms inner-poll first-token latency is dominated by the CLI's own
 *     time-to-first-token (multi-second).
 *
 * Wire format: see lib/chat/stream-events.ts. Events emitted:
 *   `ready`     once after enqueue/auth checks pass
 *   `delta`     N×, one per partial-text growth tick
 *   `heartbeat` every 15s (plus a `: heartbeat\n\n` comment immediately
 *               on open to flush proxies and defeat buffering)
 *   `done`      once when status='done' — payload includes parsed
 *               approval_requests / tool_calls / edit_plans / etc.
 *   `continue`  once at t≈280s (just under Vercel maxDuration). Client
 *               falls back to pollUntilDone(jobId, sessionId).
 *   `error`     on gateway/job failures. Always carries jobId so client
 *               can decide whether to fall back or surface to operator.
 *
 * Cost-cap is intentionally NOT re-checked here — the spend was committed
 * at /api/platform-chat enqueue time. Repeating the check mid-execution
 * would 402 a running turn which is worse UX than letting it finish.
 *
 * Feature flag: PLATFORM_CHAT_STREAM_ENABLED='0' returns HTTP 503 so
 * clients with the public mirror flag set can skip the attempt entirely.
 */

import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { resolveClaudeCodeConfig } from '@/lib/claw/business-client'
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
export const maxDuration = 300                // Vercel Pro ceiling.

const INNER_POLL_MS         = 250
const HEARTBEAT_MS          = 15_000
const MAX_DURATION_GUARD_MS = 280_000         // ~20s slack before Vercel kills the fn.
const INNER_FETCH_TIMEOUT   = 10_000          // Per-call cap on getGatewayJob.

function streamingDisabled(): boolean {
  return (process.env.PLATFORM_CHAT_STREAM_ENABLED ?? '1') === '0'
}

export async function GET(req: NextRequest) {
  // Rate limit higher than poll (one open connection per turn vs N polls)
  // but lower than the bursty enqueue endpoint.
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'platform-chat:stream' })
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
  if (!owned) {
    return new Response(
      JSON.stringify({ ok: false, error: 'session not found', code: 'not_found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const gateway = await resolveClaudeCodeConfig(userId)
  if (!gateway) {
    return new Response(
      JSON.stringify({ ok: false, error: 'claude-gateway not configured', code: 'no_gateway' }),
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
        // The ready event is the client's signal that auth + ownership +
        // gateway resolution all passed. It carries the same context the
        // POST enqueue response did, so client state can rehydrate.
        const ready: StreamEventReady = {
          jobId,
          sessionId,
          sessionTag: `platform-chat-${sessionId}-${start}`,
        }
        writeSseEvent(controller, 'ready', ready)

        let lastEmittedLen = 0
        // Phase 3 — per-call cursor used to emit `tool_event` SSE deltas.
        // Stores the most recent (startedAt, finishedAt) we've sent. A
        // record is new when its id isn't in the map; an update is when
        // its finishedAt transitions from undefined → set (output landed).
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

        // Inner-poll loop. Bounded by:
        //   - status === 'done' / 'error'  → break + handle below
        //   - Date.now() - start > MAX_DURATION_GUARD_MS → emit `continue` + break
        //   - any thrown error → emit `error { code: 'mid_stream' }` + break
        // The gateway job continues running server-side after we close;
        // client falls back to pollUntilDone(jobId, sessionId) on continue
        // OR on any error that carries a jobId.
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
            // Transport failure (5xx, network). Surface with jobId so the
            // client falls back to pollUntilDone, which uses the same
            // primitive and will likely recover on the next gateway tick.
            emitError('gateway_error', `gateway poll failed: ${result.error ?? 'unknown'}`)
            break
          }

          // Emit any new partial text since the last tick.
          if (typeof result.partialText === 'string' && result.partialText.length > lastEmittedLen) {
            const delta: StreamEventDelta = {
              text: result.partialText.slice(lastEmittedLen),
            }
            writeSseEvent(controller, 'delta', delta)
            lastEmittedLen = result.partialText.length
          }

          // Phase 3 — emit progressive tool-call events for new and just-
          // finished calls. Older gateway images (pre-Phase-3 deploy) omit
          // partialToolCalls; this branch then no-ops and the final
          // result.toolCalls still lands via the `done` event as before.
          emitToolDiff(result.partialToolCalls)

          if (result.status === 'done') {
            // One final tool-event sweep — covers the race where a tool
            // finished in the same poll tick that the run completed.
            // The `done` event below carries the authoritative tool_calls
            // list (parsed by persistCompletedTurn), so the client uses
            // that as the final state; this sweep just keeps progressive
            // animation smooth in the streaming bubble until done lands.
            emitToolDiff(result.partialToolCalls)
            // Persist + parse. We deliberately ALWAYS persist on `done` —
            // never on `continue` — so the client never sees a double-
            // write race when it falls back to poll mid-stream.
            const text = result.text ?? ''
            // Fetch pending permission requests one final time so the
            // done event surfaces them the same way the poll route does.
            let pendingPermissions: Awaited<ReturnType<typeof listPendingForJob>> = []
            try { pendingPermissions = await listPendingForJob(userId, jobId) }
            catch { /* swallow — side-channel, never throw on done */ }

            const crashedRaw = result.jobError || undefined
            const crash      = crashedRaw ? parseCrash(crashedRaw) : null

            if (text) {
              const persisted = await persistCompletedTurn({
                userId,
                sessionId,
                jobId,
                gatewayText: text,
                toolCalls:   result.toolCalls,
                durationMs:  result.durationMs,
                crashed:     crash,
                pendingPermissions,
                usage:       result.usage,
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
              // No assistant text but status='done' — still close cleanly,
              // emit empty done so the client stops the spinner. No persist.
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
            // Mid-stream crash. Mirror the poll route's behaviour — if the
            // gateway emitted partial text before dying, the client already
            // received it via `delta` events. Persist a crash placeholder
            // so reload shows the CrashedTurnCard.
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

          // status === 'pending' | 'running' — sleep before the next tick.
          await new Promise(r => setTimeout(r, INNER_POLL_MS))
        }
      } catch (err) {
        // Unexpected exception inside the loop. Surface as mid_stream so
        // the client falls back to pollUntilDone — the gateway job is
        // still running server-side regardless of what crashed us here.
        const msg = err instanceof Error ? err.message : String(err)
        try { emitError('mid_stream', msg) } catch { /* already closed */ }
      } finally {
        safeClose()
      }
    },
    cancel() {
      // Client disconnect — stop the heartbeat timer. The gateway job
      // continues running server-side; client can pick it up via the
      // existing poll path with the same jobId.
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      // X-Accel-Buffering disables nginx/Cloudflare buffering — without it
      // events accumulate until the proxy's chunk threshold, defeating the
      // whole point of streaming.
      'X-Accel-Buffering': 'no',
    },
  })
}

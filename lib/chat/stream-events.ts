/**
 * Typed wire format for the platform-chat SSE bridge.
 *
 * The new GET /api/platform-chat/stream route emits these events while
 * inner-polling the gateway's async job model. Mirrored on the client side
 * by a small SSE reader inside PlatformChat.tsx — see streamUntilDone().
 *
 * Why a custom protocol (not AI SDK 6's UIMessage stream): our payload is
 * gateway-specific (approval_requests, edit_plans, tool_calls, crashed,
 * etc.). Forcing it through createUIMessageStream means writing an adapter
 * bigger than the raw reader. The shape below is ~80 lines; the matching
 * client parser is ~80 more, mirroring lib/claw/gateway-call.ts L103-149.
 */
import type { ApprovalRequest } from './approval'
import type { ManualTaskInput } from './manual-task'
import type { IterationPlan } from './iteration-plan'
import type { EditPlan, EditGroupComplete } from './edit-plan'
import type { EditSelfPlan } from './edit-self'
import type { CrashInfo } from './crash'
import type { PermissionRequestRow } from './permission-requests'
import type { ToolCall } from '@/lib/claw/gateway-jobs'

// ── Events the server emits ──────────────────────────────────────────────────

export interface StreamEventReady {
  jobId:      string
  sessionId:  string
  sessionTag: string
  usage?: {
    tokensUsed?:     number
    inputBudget?:    number
    contextTokens?:  number
    inputUsedPct?:   number
    contextUsedPct?: number
    model?:          string
  }
}

export interface StreamEventDelta {
  /** Newly-arrived text chunk to append to the streaming bubble. */
  text: string
}

/**
 * Phase 3 — progressive tool calls. Emitted whenever a tool call starts
 * (`startedAt` set, `output` undefined) OR finishes (`finishedAt` set,
 * `output` populated). The client maintains a Map keyed by `call.id` and
 * upserts on each event so the in-progress ToolCallCard updates from
 * Wrench → CheckCircle as the gateway observes the tool_result.
 */
export interface StreamEventToolEvent {
  call: ToolCall
}

export interface StreamEventHeartbeat {
  /** Optional epoch ms — purely for observability. */
  at?: number
}

export interface StreamEventDone {
  /** Final assistant text, post-parsing (approval / manual-task /
   *  iteration-plan / edit-plan / bug-hunt-finding blocks already removed). */
  text:                        string
  approval_requests:           ApprovalRequest[]
  tool_calls?:                 ToolCall[]
  manual_tasks?:               ManualTaskInput[]
  iteration_plans?:            IterationPlan[]
  edit_plans?:                 EditPlan[]
  edit_group_completes?:       EditGroupComplete[]
  /** Continual Harness self-modification proposals (lib/chat/edit-self.ts). */
  edit_selfs?:                 EditSelfPlan[]
  pending_permission_requests?: PermissionRequestRow[]
  crashed?:                    CrashInfo
  durationMs?:                 number
  /** True when the message was persisted server-side. Always true on done,
   *  always false on continue (handed off to client poll). */
  persisted:                   boolean
}

export interface StreamEventContinue {
  jobId:     string
  sessionId: string
  /** Why we closed early. Currently only one reason exists. */
  reason:    'max_duration_approaching'
}

export type StreamErrorCode =
  | 'enqueue_failed'    // (reserved — POST handles this today, not the SSE route)
  | 'queue_full'        // ditto
  | 'stream_disabled'   // PLATFORM_CHAT_STREAM_ENABLED=0 or session unowned
  | 'mid_stream'        // unexpected exception inside the inner-poll loop
  | 'gateway_error'     // job status === 'error' came back from the gateway
  | 'unauthorized'      // auth/session ownership failed
  | 'not_found'         // jobId malformed or session_id mismatched

export interface StreamEventError {
  code:     StreamErrorCode
  message:  string
  /** Present when the jobId is known and the client should fall back to
   *  the existing pollUntilDone(jobId, sessionId). Absent means "surface
   *  this error to the operator". */
  jobId?:   string
}

// ── Server-side SSE writers ──────────────────────────────────────────────────

const ENCODER = new TextEncoder()

/**
 * Write a typed `event: X\ndata: {...}\n\n` block to the controller.
 * Use this for every named event the client parses.
 */
export function writeSseEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event:      string,
  data:       unknown,
): void {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  controller.enqueue(ENCODER.encode(line))
}

/**
 * Write an SSE comment line (`: text\n\n`). Comments are ignored by every
 * compliant SSE parser but are still flushed through proxies — use them
 * to defeat buffering and to keep keep-alive timers happy without
 * polluting the named-event stream.
 */
export function writeSseComment(
  controller: ReadableStreamDefaultController<Uint8Array>,
  text:       string,
): void {
  controller.enqueue(ENCODER.encode(`: ${text}\n\n`))
}

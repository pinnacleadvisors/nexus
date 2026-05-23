/**
 * Shared "a gateway job finished — parse + persist + account" logic.
 *
 * Extracted from the inline `status === 'done'` branch of
 * app/api/platform-chat/poll/route.ts so the new SSE bridge at
 * app/api/platform-chat/stream/route.ts can reuse exactly the same logic.
 * Two consumers must NEVER drift on the metadata shape — `/api/approvals/
 * fleet` (PR #203) reads `metadata.approval_requests`, and the next-turn
 * resume hint in app/api/platform-chat/route.ts reads `metadata.crashed`
 * and `metadata.edit_plans`. Drift here would break both surfaces silently.
 *
 * Two entry points:
 *   - parseTurnBlocks(text)        — pure, used for the response shape
 *                                    whether or not the session is owned.
 *   - persistCompletedTurn(input)  — calls parseTurnBlocks + writes
 *                                    side-effects + appendMessage +
 *                                    insertGatewayTurn. Caller MUST verify
 *                                    session ownership first.
 */

import { parseAssistantMessage } from '@/lib/chat/approval'
import { parseManualTaskBlocks, parseManualTaskCompleteBlocks } from '@/lib/chat/manual-task'
import { parseBackgroundTaskBlocks } from '@/lib/chat/background-task'
import { parseSwarmTaskBlocks } from '@/lib/chat/swarm-task'
import { parseIterationPlans } from '@/lib/chat/iteration-plan'
import { parseBugHuntFindings } from '@/lib/chat/bug-hunt-finding'
import { parseEditPlanBlocks } from '@/lib/chat/edit-plan'
import { appendMessage } from '@/lib/chat/sessions'
import { createTask, findOpenTaskByTitle, updateTask, deleteTask } from '@/lib/views/tasks'
import { createBackgroundTask } from '@/lib/background-tasks/dispatch'

/**
 * Phase 4 v2 — fire-and-forget hook into the dispatch route after a row
 * is created. Doesn't await; doesn't block the chat turn. The dispatch
 * route handles its own auth (bot bearer) + cost-guard + handler errors;
 * we just kick it off here so the row doesn't sit pending until the next
 * cron sweep. Wraps in try/catch so a missing NEXUS_BASE_URL / BOT_API_TOKEN
 * env doesn't crash the chat poll route.
 */
function fireAndForgetDispatch(taskId: string): void {
  try {
    const base = process.env.NEXUS_BASE_URL
    const bot  = process.env.BOT_API_TOKEN
    if (!base || !bot) return  // no creds = dispatch will need to be triggered out-of-band (cron / manual)
    void fetch(`${base}/api/background-tasks/${taskId}/dispatch`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${bot}`, 'Content-Type': 'application/json' },
      // Tight timeout — we don't actually wait for the dispatcher's result
      // here; we just want to trip the start. The dispatch route's own
      // maxDuration handles the long tail.
      signal:  AbortSignal.timeout(5_000),
    }).catch(err => console.warn(`[background-task] dispatch trigger failed for ${taskId}:`, err instanceof Error ? err.message : err))
  } catch (err) {
    console.warn(`[background-task] dispatch setup error for ${taskId}:`, err instanceof Error ? err.message : err)
  }
}
import { getSession as getBugHuntSession, insertFinding, bumpIteration } from '@/lib/bug-hunt/sessions'
import { insertGatewayTurn } from '@/lib/claw/gateway-turns'
import type { ApprovalRequest } from '@/lib/chat/approval'
import type { ManualTaskInput, ManualTaskCompleteInput } from '@/lib/chat/manual-task'
import type { BackgroundTaskInput } from '@/lib/chat/background-task'
import type { SwarmTaskInput } from '@/lib/chat/swarm-task'
import type { IterationPlan } from '@/lib/chat/iteration-plan'
import type { BugHuntFinding } from '@/lib/chat/bug-hunt-finding'
import type { EditPlan, EditGroupComplete } from '@/lib/chat/edit-plan'
import type { ToolCall } from '@/lib/claw/gateway-jobs'
import type { CrashInfo } from '@/lib/chat/crash'
import type { PermissionRequestRow } from '@/lib/chat/permission-requests'

export interface ParsedTurnBlocks {
  /** Cleaned-up display text — all fenced blocks stripped. */
  displayText:          string
  approval_requests:    ApprovalRequest[]
  manual_tasks:         ManualTaskInput[]
  /** Phase 3 of task_plan-collaborative-chat.md — agent-emitted completions
   *  for tasks it previously flagged. Resolved server-side by title match
   *  against open operator_tasks for the session's scope. */
  manual_task_completes: ManualTaskCompleteInput[]
  /** Phase 4 of task_plan-collaborative-chat.md — long-running work the
   *  agent delegates to a background worker. Rows inserted into
   *  `background_tasks` with status=pending; v2 wires Inngest handlers. */
  background_tasks:     BackgroundTaskInput[]
  /** Phase 5 of task_plan-collaborative-chat.md — N-parallel swarm. The
   *  persist routine fans each entry into one parent + N child rows. */
  swarm_tasks:          SwarmTaskInput[]
  iteration_plans:      IterationPlan[]
  findings:             BugHuntFinding[]
  edit_plans:           EditPlan[]
  edit_group_completes: EditGroupComplete[]
}

/**
 * Pure parser — extracts every fenced block from the assistant text and
 * returns the cleaned-up display text plus structured arrays. Safe to call
 * even when no session is bound (e.g. ad-hoc previews). Side-effect-free.
 *
 * Order matters: approval → manual-task → iteration-plan → bug-hunt-
 * finding → edit-plan. Each parser strips its blocks so the next sees
 * clean input. Don't reorder — the visible text the operator sees depends
 * on this sequence.
 */
export function parseTurnBlocks(gatewayText: string): ParsedTurnBlocks {
  const parsed = parseAssistantMessage(gatewayText)
  let displayText      = parsed.text
  let approvalRequests = parsed.approval_requests

  const taskParse     = parseManualTaskBlocks(displayText);         displayText = taskParse.text
  const completeParse = parseManualTaskCompleteBlocks(displayText); displayText = completeParse.text
  const bgParse       = parseBackgroundTaskBlocks(displayText);     displayText = bgParse.text
  const swarmParse    = parseSwarmTaskBlocks(displayText);          displayText = swarmParse.text
  const iterParse     = parseIterationPlans(displayText);           displayText = iterParse.text
  const findingParse  = parseBugHuntFindings(displayText);  displayText = findingParse.text
  const editPlanParse = parseEditPlanBlocks(displayText);   displayText = editPlanParse.text

  // iteration-plan blocks each carry an inner ApprovalRequest — append so
  // the existing ApprovalCard renders them with the rest.
  for (const p of iterParse.plans) approvalRequests = [...approvalRequests, p.approval]

  return {
    displayText,
    approval_requests:    approvalRequests,
    manual_tasks:         taskParse.tasks,
    manual_task_completes: completeParse.completes,
    background_tasks:     bgParse.tasks,
    swarm_tasks:          swarmParse.swarms,
    iteration_plans:      iterParse.plans,
    findings:             findingParse.findings,
    edit_plans:           editPlanParse.plans,
    edit_group_completes: editPlanParse.group_completes,
  }
}

export interface PersistCompletedTurnInput {
  userId:               string
  /** Already verified as owned by userId by the caller (poll + SSE). */
  sessionId:            string
  jobId:                string
  /** Raw assistant text from the gateway result. */
  gatewayText:          string
  /** Tool calls captured during the turn — passed through to metadata. */
  toolCalls?:           ToolCall[]
  durationMs?:          number
  /** Token usage from the gateway's terminal `result` event. Forwarded to
   *  `insertGatewayTurn` so `gateway_turns` rows carry real token counts
   *  instead of nulls (G1 cost-measurement substrate). */
  usage?: {
    input_tokens?:                number
    output_tokens?:               number
    cache_read_input_tokens?:     number
    cache_creation_input_tokens?: number
  }
  /** Pre-parsed crash info — when set, the message persists with
   *  `metadata.crashed` so the next-turn resume hint can fire. */
  crashed?:             CrashInfo | null
  /** Already-fetched pending permission requests for this jobId. Surfaced
   *  in the response only — not persisted (they live in their own table). */
  pendingPermissions?:  PermissionRequestRow[]
  /** Scope tag stored on operator_tasks rows that this turn emits via
   *  `manual-task` blocks. Defaults to `'admin'` for backward compat with
   *  the original platform-chat extraction. Business-chat passes
   *  `business:<slug>` so the Tasks panel for the right scope surfaces them. */
  taskScope?:           string
  /** Fallback sessionTag for plan-window accounting when the turn does NOT
   *  reference a bug-hunt session_id. Defaults to `'platform-chat'`.
   *  Business-chat passes `business-chat-<slug>` so per-business spend
   *  attribution stays correct. */
  sessionTagFallback?:  string
}

export interface PersistCompletedTurnOutput extends ParsedTurnBlocks {
  tool_calls?:                 ToolCall[]
  pending_permission_requests?: PermissionRequestRow[]
  findings_inserted:           number
  crashed?:                    CrashInfo
  durationMs?:                 number
}

/**
 * Parse + persist + side-effect a completed gateway turn. Idempotent only
 * insofar as appendMessage is — callers must NOT invoke twice for the same
 * jobId (the SSE handler enforces this by NOT calling persist on `continue`).
 */
export async function persistCompletedTurn(
  input: PersistCompletedTurnInput,
): Promise<PersistCompletedTurnOutput> {
  const parsed = parseTurnBlocks(input.gatewayText)
  const taskScope = input.taskScope ?? 'admin'

  // Stage 1 — manual tasks. The session is already verified owned by the
  // caller; insert under the caller-specified scope (admin for platform
  // chat, `business:<slug>` for business chat) with the back-link.
  for (const t of parsed.manual_tasks) {
    await createTask({
      userId:           input.userId,
      scope:            taskScope,
      title:            t.title,
      description:      t.description ?? null,
      dueAt:            t.due_at ?? null,
      source:           'agent',
      sourceSessionId:  input.sessionId,
    })
  }

  // Stage 1b (Phase 3 of task_plan-collaborative-chat.md) — manual-task
  // completions. Agent identifies the row by exact title (case-insensitive)
  // within this scope. Multiple matches: most recent open task wins. No
  // match: silently no-op (the agent's mental model of open tasks may be
  // stale; the operator sees no rogue side effect).
  for (const c of parsed.manual_task_completes) {
    const row = await findOpenTaskByTitle(input.userId, taskScope, c.title)
    if (!row) continue
    if (c.delete) {
      await deleteTask(input.userId, row.id)
    } else {
      await updateTask(input.userId, row.id, { done: true })
    }
  }

  // Stage 1c (Phase 4 of task_plan-collaborative-chat.md) — background tasks.
  // Same scope ownership pattern as manual_tasks. v1 inserted the row at
  // status=pending; v2 (this commit) ALSO fires the dispatcher fire-and-
  // forget so the row immediately transitions pending → running → done|error.
  for (const b of parsed.background_tasks) {
    const row = await createBackgroundTask({
      userId:        input.userId,
      scope:         taskScope,
      chatSessionId: input.sessionId,
      kind:          b.kind,
      title:         b.title,
      description:   b.description ?? null,
      payload:       b.payload ?? {},
    })
    if (row) fireAndForgetDispatch(row.id)
  }

  // Stage 1d (Phase 5 of task_plan-collaborative-chat.md) — swarm tasks.
  // Each swarm fans out into a parent (kind='swarm') + N children linked via
  // parent_id. AGENTS.md's "≥3 subtasks" rule: swarms with <3 valid subtasks
  // fall back to N standalone background_tasks (no parent grouping) so the
  // agent's mental model isn't silently dropped.
  for (const s of parsed.swarm_tasks) {
    if (s.subtasks.length < 3) {
      // Fall back: insert each as a standalone background_task + dispatch.
      for (const sub of s.subtasks) {
        const subRow = await createBackgroundTask({
          userId:        input.userId,
          scope:         taskScope,
          chatSessionId: input.sessionId,
          kind:          sub.kind,
          title:         sub.title,
          description:   sub.description ?? null,
          payload:       sub.payload ?? {},
        })
        if (subRow) fireAndForgetDispatch(subRow.id)
      }
      continue
    }
    const parent = await createBackgroundTask({
      userId:        input.userId,
      scope:         taskScope,
      chatSessionId: input.sessionId,
      kind:          'swarm',
      title:         s.title,
      description:   s.description ?? null,
      payload:       { subtask_count: s.subtasks.length },
    })
    if (!parent) continue
    for (const sub of s.subtasks) {
      const subRow = await createBackgroundTask({
        userId:        input.userId,
        scope:         taskScope,
        chatSessionId: input.sessionId,
        parentId:      parent.id,
        kind:          sub.kind,
        title:         sub.title,
        description:   sub.description ?? null,
        payload:       sub.payload ?? {},
      })
      if (subRow) fireAndForgetDispatch(subRow.id)
    }
  }

  // Stage 2 — bug-hunt finding inserts + iteration bumps. These reference
  // a DIFFERENT session_id (a bug-hunt session, not the chat session) so
  // each one needs its own ownership check to defeat prompt injection
  // trying to write rows under another user's session.
  const ownedBugHuntSessions = new Map<string, boolean>()
  const ownsBugHunt = async (bhId: string): Promise<boolean> => {
    if (ownedBugHuntSessions.has(bhId)) return ownedBugHuntSessions.get(bhId)!
    const row = await getBugHuntSession(input.userId, bhId)
    const ok = !!row
    ownedBugHuntSessions.set(bhId, ok)
    return ok
  }

  let findingsInserted = 0
  for (const f of parsed.findings) {
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
    findingsInserted++
  }

  const bumpedSessions = new Set<string>()
  for (const p of parsed.iteration_plans) {
    if (bumpedSessions.has(p.session_id)) continue
    if (!(await ownsBugHunt(p.session_id))) continue
    await bumpIteration(input.userId, p.session_id)
    bumpedSessions.add(p.session_id)
  }

  // Stage 3 — persist the assistant message itself. This metadata bag is
  // load-bearing for `/api/approvals/fleet` (reads `metadata.approval_
  // requests`) AND the next-turn resume hint at app/api/platform-chat/
  // route.ts (reads `metadata.crashed` and `metadata.edit_plans`). Don't
  // drop fields without updating those consumers in the same PR.
  await appendMessage({
    sessionId: input.sessionId,
    role:      'assistant',
    content:   parsed.displayText,
    metadata: {
      durationMs:           input.durationMs,
      jobId:                input.jobId,
      approval_requests:    parsed.approval_requests,
      tool_calls:           input.toolCalls,
      manual_tasks:         parsed.manual_tasks.length      > 0 ? parsed.manual_tasks      : undefined,
      manual_task_completes: parsed.manual_task_completes.length > 0 ? parsed.manual_task_completes : undefined,
      background_tasks:     parsed.background_tasks.length  > 0 ? parsed.background_tasks  : undefined,
      swarm_tasks:          parsed.swarm_tasks.length       > 0 ? parsed.swarm_tasks       : undefined,
      iteration_plans:      parsed.iteration_plans.length   > 0 ? parsed.iteration_plans   : undefined,
      findings_inserted:    findingsInserted || undefined,
      edit_plans:           parsed.edit_plans.length        > 0 ? parsed.edit_plans        : undefined,
      edit_group_completes: parsed.edit_group_completes.length > 0 ? parsed.edit_group_completes : undefined,
      crashed:              input.crashed
        ? {
            exit_code:   input.crashed.exitCode   ?? null,
            stderr_tail: input.crashed.stderrTail ?? null,
            raw:         input.crashed.rawError   ?? null,
          }
        : undefined,
    },
  })

  // Stage 4 — gateway-turn accounting (fire-and-forget; never throws into
  // the response path). Tag by bug-hunt session id when one is referenced
  // this turn so plan-window math attributes correctly; otherwise use the
  // caller-supplied fallback so per-business spend attribution stays clean.
  recordCompletedTurnAccounting({
    userId:             input.userId,
    parsed,
    durationMs:         input.durationMs ?? null,
    toolCallsCount:     Array.isArray(input.toolCalls) ? input.toolCalls.length : 0,
    sessionTagFallback: input.sessionTagFallback ?? 'platform-chat',
    usage:              input.usage,
  })

  return {
    ...parsed,
    tool_calls:                  input.toolCalls,
    pending_permission_requests: input.pendingPermissions && input.pendingPermissions.length > 0
                                   ? input.pendingPermissions
                                   : undefined,
    findings_inserted:           findingsInserted,
    crashed:                     input.crashed ?? undefined,
    durationMs:                  input.durationMs,
  }
}

/**
 * Standalone accounting helper — exposed separately so the poll route can
 * still record a turn even when the session isn't owned (defensive — the
 * spend was committed at enqueue time regardless of who reads the result).
 */
export function recordCompletedTurnAccounting(args: {
  userId:             string
  parsed:             Pick<ParsedTurnBlocks, 'iteration_plans' | 'findings'>
  durationMs:         number | null
  toolCallsCount:     number
  /** Used when no bug-hunt session is referenced this turn. Defaults to
   *  `'platform-chat'` for backward compat. Business chat passes
   *  `business-chat-<slug>`. */
  sessionTagFallback?: string
  /** Token usage from the gateway result. When absent the row lands with
   *  null tokens — preserve the legacy behaviour so older call sites that
   *  haven't been updated still record a turn (better than silently
   *  dropping the accounting row). */
  usage?: {
    input_tokens?:                number
    output_tokens?:               number
    cache_read_input_tokens?:     number
    cache_creation_input_tokens?: number
  }
}): void {
  const huntTag = args.parsed.iteration_plans[0]?.session_id
              ?? args.parsed.findings[0]?.session_id
  const sessionTag = huntTag
    ? `bug-hunt-${huntTag}-iter`
    : (args.sessionTagFallback ?? 'platform-chat')
  void insertGatewayTurn({
    userId:         args.userId,
    plan:           'claude-max',
    model:          'opus',          // platform-copilot defaults to opus
    sessionTag,
    durationMs:     args.durationMs,
    toolCallsCount: args.toolCallsCount,
    inputTokens:    args.usage?.input_tokens  ?? null,
    outputTokens:   args.usage?.output_tokens ?? null,
  })
}

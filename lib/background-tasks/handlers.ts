/**
 * lib/background-tasks/handlers.ts — per-kind execution handlers.
 *
 * Phase 4 v2 of task_plan-collaborative-chat.md. v1 only landed rows; this
 * module is what flips them pending → running → done by actually doing the
 * work referenced by `kind` + `payload`.
 *
 * Each handler is a pure function: takes the task row, returns a JSON-safe
 * result or throws on error. The dispatcher wrapper (route.ts) handles the
 * status transitions + error capture.
 *
 * v2 v1 ships handlers for `playwright-run` and `custom`. Others can be
 * added without a migration — just add an entry to HANDLERS. Unknown kinds
 * fall through to the default which marks the task as error with a clear
 * "not yet implemented" message; the operator can cancel + retry once the
 * kind is wired.
 *
 * Cost-guard: every handler calls `checkKillSwitch(scope)` before any LLM
 * or external service call. If the kill switch is tripped, the handler
 * throws and the dispatcher marks the row error with the kill-switch
 * payload — visible in the BackgroundTasksView so the operator sees why.
 */

import { createHmac } from 'node:crypto'
import { checkKillSwitch } from '@/lib/cost-guard'
import type { BackgroundTaskRow } from '@/lib/background-tasks/dispatch'

export interface HandlerResult {
  /** Free-form JSON result. Stored in background_tasks.result. */
  result: unknown
}

export type Handler = (task: BackgroundTaskRow) => Promise<HandlerResult>

// ── Individual handlers ──────────────────────────────────────────────────

/** `custom` — pure informational. Marks done immediately with the original
 *  payload as the result. Useful when the agent wants to record "I would
 *  have done X in the background" without actual execution (e.g. operator
 *  asked for a plan, agent wants to surface the plan in the view). */
async function handleCustom(task: BackgroundTaskRow): Promise<HandlerResult> {
  return { result: { kind: 'custom', payload: task.payload, note: 'no-op handler — informational only' } }
}

/** `playwright-run` — POST to the qa-runner webhook. Same HMAC shape as
 *  /api/cron/post-deploy-smoke. qa-runner runs Playwright async and posts
 *  back via /api/workflow-feedback eventually; v2 v1 marks the task `done`
 *  as soon as qa-runner acknowledges the webhook (HTTP 200/202). A future
 *  v3 will wire result-callback to mark `done` only when qa-runner
 *  actually finishes. */
async function handlePlaywrightRun(task: BackgroundTaskRow): Promise<HandlerResult> {
  // Cost-guard pre-flight when this task is scoped to a specific business.
  // Admin-scope tasks don't have a business kill-switch (user-level cap is
  // enforced by the chat dispatch route's cost-cap guard before any agent
  // turn fires, so by the time we're dispatching a row the spend was OK).
  if (task.scope.startsWith('business:')) {
    const businessSlug = task.scope.slice('business:'.length)
    const kill = await checkKillSwitch(businessSlug)
    if (kill.kill) throw new Error(`kill_switch_tripped: ${kill.reason ?? 'cost cap'}`)
  }

  const webhookUrl = process.env.QA_RUNNER_WEBHOOK_URL
  const hmacSecret = process.env.QA_RUNNER_HMAC_SECRET
  if (!webhookUrl) throw new Error('QA_RUNNER_WEBHOOK_URL not set — wire qa-runner first')
  if (!hmacSecret) throw new Error('QA_RUNNER_HMAC_SECRET not set')

  const payload = (task.payload as Record<string, unknown>) ?? {}
  const baseUrl = (payload.url as string | undefined) ?? process.env.NEXUS_BASE_URL ?? ''
  const body = JSON.stringify({
    baseUrl,
    backgroundTaskId: task.id,
    spec:    payload.spec,
    project: payload.project,
  })
  const ts  = Date.now().toString()
  const sig = 'sha256=' + createHmac('sha256', hmacSecret).update(body).digest('hex')

  const res = await fetch(webhookUrl, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'X-Nexus-Signature': sig,
      'X-Nexus-Timestamp': ts,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`qa-runner rejected dispatch: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  return { result: { kind: 'playwright-run', dispatched: true, webhook: webhookUrl, qa_runner_http: res.status } }
}

// ── Registry ─────────────────────────────────────────────────────────────

const HANDLERS: Record<string, Handler> = {
  custom:           handleCustom,
  'playwright-run': handlePlaywrightRun,
  // Future handlers — add the key + import the implementation. No migration
  // needed; unknown kinds fall through to the "not implemented" path below.
  // 'firecrawl-crawl': handleFirecrawlCrawl,
  // 'codex-dispatch':  handleCodexDispatch,
  // 'n8n-workflow':    handleN8nWorkflow,
}

export function getHandler(kind: string): Handler | null {
  return HANDLERS[kind] ?? null
}

export function listImplementedKinds(): string[] {
  return Object.keys(HANDLERS)
}

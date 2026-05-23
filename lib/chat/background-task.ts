/**
 * background-task fenced JSON block — Phase 4 of task_plan-collaborative-chat.md.
 *
 * When the chat agent identifies work that's too long to fit one turn,
 * it emits a fenced JSON block:
 *
 *   ```background-task
 *   {
 *     "kind": "playwright-run",
 *     "title": "Smoke /dashboard against the latest preview deploy",
 *     "description": "Optional one-line context",
 *     "payload": { "url": "https://...", "spec": "tests/playwright/sign-in.spec.ts" }
 *   }
 *   ```
 *
 * The chat poll route extracts these blocks, inserts a row into
 * `background_tasks` (status=pending), and strips the fenced block from
 * the visible reply. The Background tasks view in the Views dropdown
 * polls + renders status. v1: agent just creates the row; v2 will wire
 * Inngest handlers per `kind` to actually drive the work.
 *
 * Mirrors lib/chat/manual-task.ts:
 *   manual-task     → operator does it offline
 *   background-task → agent (or an Inngest worker) does it in the background
 */

export interface BackgroundTaskInput {
  /** Dispatcher tag — see lib/background-tasks/dispatch.ts BackgroundTaskKind.
   *  Free-form so new kinds don't need a migration. Unknown kinds = pending
   *  forever until v2 lands or the operator cancels. */
  kind:         string
  title:        string
  description?: string
  payload?:     Record<string, unknown>
}

export interface BackgroundTaskParseResult {
  text:  string
  tasks: BackgroundTaskInput[]
}

const FENCED_BLOCK_RE = /```background-task\s*\n([\s\S]*?)```/g

export function parseBackgroundTaskBlocks(assistantText: string): BackgroundTaskParseResult {
  const tasks: BackgroundTaskInput[] = []
  const cleaned = assistantText.replace(FENCED_BLOCK_RE, (match, jsonRaw: string) => {
    let parsed: unknown
    try { parsed = JSON.parse(jsonRaw) }
    catch { return match }
    if (!parsed || typeof parsed !== 'object') return match
    const p = parsed as Record<string, unknown>
    if (typeof p.kind !== 'string' || !p.kind.trim())   return match
    if (typeof p.title !== 'string' || !p.title.trim()) return match
    const task: BackgroundTaskInput = {
      kind:  p.kind.trim(),
      title: p.title.trim(),
    }
    if (typeof p.description === 'string' && p.description.trim()) task.description = p.description.trim()
    if (p.payload && typeof p.payload === 'object' && !Array.isArray(p.payload)) {
      task.payload = p.payload as Record<string, unknown>
    }
    tasks.push(task)
    return ''
  })
  return { text: cleaned.replace(/^\s+|\s+$/g, ''), tasks }
}

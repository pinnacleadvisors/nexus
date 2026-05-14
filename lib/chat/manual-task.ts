/**
 * manual-task fenced JSON block protocol — parallel to lib/chat/approval.ts.
 *
 * When the chat agent identifies work that the operator must do manually
 * (because it requires UI clicks the agent can't perform, an out-of-band
 * decision, or domain knowledge the agent doesn't have), it emits one or
 * more fenced JSON blocks tagged `manual-task` in its reply:
 *
 *   ```manual-task
 *   {
 *     "title": "Approve the new Beehiiv newsletter signup form layout",
 *     "description": "Beehiiv → Forms → Embed in Site. Composio doesn't expose this endpoint yet.",
 *     "due_at": "2026-05-20"
 *   }
 *   ```
 *
 * The chat poll route extracts these blocks server-side, inserts them into
 * `operator_tasks` with the session's scope + the session_id back-link, and
 * strips the fenced blocks from the displayed text. The Views → Tasks panel
 * surfaces them so the operator has a single inbox of "things only I can do".
 *
 * Mirrors the approval protocol so the agent learns one pattern that fans
 * out into two surfaces:
 *   approval-request → ApprovalCard       (inline, blocking — operator approves an action the agent will then run)
 *   manual-task      → Tasks panel        (background — operator does the work outside chat)
 */

export interface ManualTaskInput {
  title:        string
  description?: string
  due_at?:      string   // ISO 8601; agent should use absolute dates not "tomorrow"
}

/** Parsed manual-task block + the residual text with all blocks stripped. */
export interface ManualTaskParseResult {
  text:  string
  tasks: ManualTaskInput[]
}

const FENCED_BLOCK_RE = /```manual-task\s*\n([\s\S]*?)```/g

/**
 * Pull every `manual-task` fenced JSON block out of the assistant message,
 * validate each, and return the cleaned-up text + the list of tasks.
 *
 * Malformed JSON / missing required fields → the block is left in place
 * (renders raw to the operator so they see what the agent tried to emit).
 * This matches `parseApprovalBlocks` behaviour from lib/chat/approval.ts.
 */
export function parseManualTaskBlocks(assistantText: string): ManualTaskParseResult {
  const tasks: ManualTaskInput[] = []
  const malformed: string[] = []
  const cleaned = assistantText.replace(FENCED_BLOCK_RE, (match, jsonRaw: string) => {
    let parsed: unknown
    try { parsed = JSON.parse(jsonRaw) }
    catch { malformed.push(match); return match }
    if (!parsed || typeof parsed !== 'object') { malformed.push(match); return match }
    const p = parsed as Record<string, unknown>
    if (typeof p.title !== 'string' || !p.title.trim()) { malformed.push(match); return match }
    const task: ManualTaskInput = { title: p.title.trim() }
    if (typeof p.description === 'string' && p.description.trim()) task.description = p.description.trim()
    if (typeof p.due_at === 'string' && p.due_at.trim() && !Number.isNaN(Date.parse(p.due_at))) {
      task.due_at = new Date(p.due_at).toISOString()
    }
    tasks.push(task)
    return ''
  })
  // Trim leading/trailing whitespace left by the removed blocks, but keep
  // internal whitespace so paragraph breaks render correctly.
  return { text: cleaned.replace(/^\s+|\s+$/g, ''), tasks }
}

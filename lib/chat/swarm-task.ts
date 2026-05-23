/**
 * swarm-task fenced JSON block — Phase 5 of task_plan-collaborative-chat.md.
 *
 * When the agent identifies work that decomposes into ≥3 parallel sub-tasks
 * (per AGENTS.md's swarm rule — ≥3 plausibly-independent sub-tasks, ≥2
 * tools each), it emits a `swarm-task` block. The poll route fans this out
 * into one parent `background_tasks` row (kind='swarm') + N child rows
 * (one per sub-task) linked via `parent_id`. The Background tasks view
 * groups children under their parent.
 *
 * Format:
 *   ```swarm-task
 *   {
 *     "title": "Launch the v1 storefront",
 *     "description": "4 parallel sub-agents",
 *     "subtasks": [
 *       { "kind": "playwright-run", "title": "Smoke checkout", "payload": {...} },
 *       { "kind": "firecrawl-crawl", "title": "Index product pages", "payload": {...} },
 *       { "kind": "codex-dispatch",  "title": "Generate email copy",   "payload": {...} },
 *       { "kind": "n8n-workflow",    "title": "Publish social post",    "payload": {...} }
 *     ]
 *   }
 *   ```
 *
 * Server-side enforcement of AGENTS.md "≥3 subtasks" rule lives in the
 * persist-completed-turn dispatch. Sub-3 swarms fall back to N
 * standalone background-tasks (no parent grouping).
 */

import type { BackgroundTaskInput } from '@/lib/chat/background-task'

export interface SwarmTaskInput {
  title:        string
  description?: string
  subtasks:     BackgroundTaskInput[]
}

export interface SwarmTaskParseResult {
  text:   string
  swarms: SwarmTaskInput[]
}

const FENCED_BLOCK_RE = /```swarm-task\s*\n([\s\S]*?)```/g

export function parseSwarmTaskBlocks(assistantText: string): SwarmTaskParseResult {
  const swarms: SwarmTaskInput[] = []
  const cleaned = assistantText.replace(FENCED_BLOCK_RE, (match, jsonRaw: string) => {
    let parsed: unknown
    try { parsed = JSON.parse(jsonRaw) }
    catch { return match }
    if (!parsed || typeof parsed !== 'object') return match
    const p = parsed as Record<string, unknown>
    if (typeof p.title !== 'string' || !p.title.trim()) return match
    if (!Array.isArray(p.subtasks)) return match

    const validSubtasks: BackgroundTaskInput[] = []
    for (const raw of p.subtasks) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      if (typeof r.kind  !== 'string' || !r.kind.trim())  continue
      if (typeof r.title !== 'string' || !r.title.trim()) continue
      const sub: BackgroundTaskInput = {
        kind:  r.kind.trim(),
        title: r.title.trim(),
      }
      if (typeof r.description === 'string' && r.description.trim()) sub.description = r.description.trim()
      if (r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload)) {
        sub.payload = r.payload as Record<string, unknown>
      }
      validSubtasks.push(sub)
    }
    if (validSubtasks.length === 0) return match

    const swarm: SwarmTaskInput = {
      title:    p.title.trim(),
      subtasks: validSubtasks,
    }
    if (typeof p.description === 'string' && p.description.trim()) swarm.description = p.description.trim()
    swarms.push(swarm)
    return ''
  })
  return { text: cleaned.replace(/^\s+|\s+$/g, ''), swarms }
}

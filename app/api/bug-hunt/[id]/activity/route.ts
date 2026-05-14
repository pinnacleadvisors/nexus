/**
 * GET /api/bug-hunt/[id]/activity
 *
 * Time-ordered event feed for a bug-hunt session. The Bug-hunt panel's
 * "Session activity" dropdown reads from this and renders the rows with
 * appropriate icons + failure highlighting.
 *
 * Sources merged into the unified stream:
 *   1. `bug_hunt_sessions` row    → session-started / paused / resumed / stopped
 *   2. `chat_messages.metadata`   → iteration-proposed (from iteration_plans),
 *                                    iteration-approved (from a later APPROVAL reply),
 *                                    tool-call (success / error from tool_calls array)
 *   3. `bug_hunt_findings` rows   → finding-inserted, pr-opened
 *   4. `gateway_turns` rows       → turn-completed (when tagged for this session)
 *
 * The chat_messages source is the richest because it surfaces tool errors —
 * the failures the operator most wants to see. Same query attribution as
 * the rest of the panel (session_tag prefix `bug-hunt-<id>-`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getSession, listFindings } from '@/lib/bug-hunt/sessions'
import { createServerClient } from '@/lib/supabase'
import type { ToolCall } from '@/lib/claw/gateway-jobs'
import type { ApprovalRequest } from '@/lib/chat/approval'

export const runtime    = 'nodejs'
export const maxDuration = 10

export type ActivityKind =
  | 'session-started'
  | 'session-paused'
  | 'session-resumed'
  | 'session-stopped'
  | 'iteration-proposed'
  | 'iteration-approved'
  | 'tool-call'
  | 'finding-inserted'
  | 'pr-opened'
  | 'turn-completed'

export interface ActivityEvent {
  kind:      ActivityKind
  at:        string
  ok:        boolean
  title:     string
  detail?:   string
  meta?:     Record<string, unknown>
}

interface ChatMessageRow {
  id:         string
  role:       'user' | 'assistant' | 'system'
  content:    string
  metadata:   {
    iteration_plans?:    Array<{ session_id: string; iteration: number; scope: string; intent: string; approval: ApprovalRequest }>
    tool_calls?:         ToolCall[]
    findings_inserted?:  number
    durationMs?:         number
  } | null
  created_at: string
}

interface Chain<T> {
  eq:    (c: string, v: unknown) => Chain<T>
  like:  (c: string, v: string) => Chain<T>
  order: (c: string, opts: { ascending: boolean }) => Chain<T>
  limit: (n: number) => Promise<{ data: T[] | null }>
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { limit: 120, window: '1 m', prefix: 'bug-hunt:activity' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id } = await context.params
  const row = await getSession(session.userId, id)
  if (!row) return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })

  const events: ActivityEvent[] = []

  // ── Session lifecycle from the row ─────────────────────────────────────
  events.push({
    kind:  'session-started',
    at:    row.created_at,
    ok:    true,
    title: 'Session started',
    detail: `caps: max ${row.plan_window_share_pct}% · codex ${row.codex_window_share_pct}% · max iters ${row.max_iterations}`,
  })
  if (row.status === 'paused')  events.push({ kind: 'session-paused',  at: row.created_at, ok: true, title: 'Session paused' })
  if (row.status === 'stopped' && row.ended_at) events.push({ kind: 'session-stopped', at: row.ended_at, ok: true, title: 'Session stopped' })
  if (row.status === 'done'    && row.ended_at) events.push({ kind: 'session-stopped', at: row.ended_at, ok: true, title: 'Session completed' })

  // ── Findings — direct DB rows ─────────────────────────────────────────
  const findings = await listFindings(row.id)
  for (const f of findings) {
    events.push({
      kind:  'finding-inserted',
      at:    f.created_at,
      ok:    true,
      title: `${f.severity.toUpperCase()} finding — ${f.title}`,
      detail: f.source_path ?? undefined,
      meta:  { id: f.id, severity: f.severity, category: f.category },
    })
    if (f.pr_url) {
      events.push({
        kind:  'pr-opened',
        at:    f.resolved_at ?? f.created_at,
        ok:    true,
        title: `PR opened — ${f.title}`,
        detail: f.pr_url,
        meta:  { finding_id: f.id, pr_url: f.pr_url, branch: f.branch },
      })
    }
  }

  // ── Chat messages with this session referenced in metadata ────────────
  // We can't easily filter chat_messages by metadata content via Supabase
  // FTS, so we pull the operator's last ~60 messages across all sessions
  // and filter client-side by metadata.iteration_plans[].session_id ===
  // row.id. 60 is enough headroom — even a heavy bug-hunt week is < 30
  // assistant messages tagged to one session.
  const db = createServerClient()
  if (db) {
    const messagesRes = await (db.from('chat_messages' as never) as unknown as { select: (c: string) => Chain<ChatMessageRow> })
      .select('id, role, content, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    for (const m of messagesRes.data ?? []) {
      // Iteration proposals — only those that reference THIS session.
      for (const p of m.metadata?.iteration_plans ?? []) {
        if (p.session_id !== row.id) continue
        events.push({
          kind:  'iteration-proposed',
          at:    m.created_at,
          ok:    true,
          title: `Iteration ${p.iteration} proposed — ${p.scope}`,
          detail: p.intent.slice(0, 240),
          meta:  { iteration: p.iteration, approval_id: p.approval.approval_id, scope: p.scope },
        })
      }
      // Tool calls — surface successes + failures. We can't tell server-side
      // which session a tool call belongs to, so we attribute tool calls to
      // a session only when the SAME message also carried an iteration-plan
      // for that session.
      const sessionTaggedHere = (m.metadata?.iteration_plans ?? []).some(p => p.session_id === row.id)
      if (sessionTaggedHere && Array.isArray(m.metadata?.tool_calls)) {
        for (const tc of m.metadata.tool_calls) {
          events.push({
            kind:  'tool-call',
            at:    new Date(tc.startedAt).toISOString(),
            ok:    !tc.isError,
            title: `Tool: ${tc.name}${tc.isError ? ' (FAILED)' : ''}`,
            detail: tc.isError
              ? (typeof tc.output === 'string' ? tc.output.slice(0, 240) : 'error — see chat for detail')
              : `${tc.finishedAt ? (tc.finishedAt - tc.startedAt) + 'ms' : 'in flight'}`,
            meta:  { id: tc.id, isError: tc.isError ?? false, duration_ms: tc.finishedAt ? tc.finishedAt - tc.startedAt : null },
          })
        }
      }
      // APPROVAL replies — match the approval_id pattern back to an iteration.
      if (m.role === 'user' && /^APPROVAL\s*\[/.test(m.content)) {
        const idMatch = m.content.match(/APPROVAL\s*\[\s*([^\]]+?)\s*\]/i)
        if (idMatch && idMatch[1].startsWith(row.id + '-i')) {
          const iter = Number(idMatch[1].slice(row.id.length + 2))
          events.push({
            kind:  'iteration-approved',
            at:    m.created_at,
            ok:    true,
            title: `Iteration ${iter} approved`,
            detail: m.content.slice(0, 160),
            meta:  { approval_id: idMatch[1], iteration: iter },
          })
        }
      }
    }
  }

  // Sort newest first (UI renders top-down).
  events.sort((a, b) => b.at.localeCompare(a.at))

  return NextResponse.json({ ok: true, events })
}

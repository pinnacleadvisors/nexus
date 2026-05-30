/**
 * lib/approvals/fleet.ts — shared logic for the cross-scope pending-approvals
 * aggregator. Extracted from app/api/approvals/fleet/route.ts so multiple
 * routes can call it without going over HTTP (the original `/api/approvals`
 * compatibility alias proxied to `/api/approvals/fleet` via fetch, which
 * CodeQL flagged as SSRF because the URL origin came from req.url —
 * harmless in practice behind Cloudflare Tunnel but better fixed than
 * suppressed).
 *
 * Today both `/api/approvals/fleet` (returns {ok, pending}) and
 * `/api/approvals` (returns {ok, rows, count}) call `listFleetPending()`
 * directly — same data, two response shapes, zero HTTP roundtrip.
 *
 * Behaviour preserved exactly from the original route implementation:
 *   - Walks up to 100 chat sessions per user (newest first by
 *     last_message_at)
 *   - Reads up to 5000 messages across those sessions
 *   - Filters out resolved approvals via the `APPROVAL [<id>]:` regex
 *   - Tags each pending item with scope + scope_label so the UI can
 *     route back to the right chat surface
 *   - Sorts newest first
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { listBusinessesForUser } from '@/lib/business/db'
import type { ApprovalRequest } from '@/lib/chat/approval'

interface ChatMessageRow {
  id:         string
  session_id: string
  role:       'user' | 'assistant' | 'system'
  content:    string
  metadata:   { approval_requests?: ApprovalRequest[] } | null
  created_at: string
}

interface ChatSessionRow {
  id:    string
  title: string | null
  scope: string
}

interface Chain<T> {
  eq:    (c: string, v: unknown) => Chain<T>
  in:    (c: string, v: string[]) => Chain<T>
  order: (c: string, opts: { ascending: boolean }) => Chain<T>
  limit: (n: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
}

/**
 * Where the approval originated. The /inbox + dashboard FleetApprovalInbox
 * read both kinds via this aggregator so the operator sees a single feed,
 * each row labelled with its origin.
 *
 *   - 'chat-emitted'   — approval_request block parsed out of chat_messages
 *                        metadata (the dispatch / Ralph-loop pattern)
 *   - 'operator-task'  — row in the `approvals` Postgres table (the older
 *                        approval-card flow that pre-dates the chat-emitted
 *                        path; still used by some workflow paths)
 */
export type ApprovalKind =
  | 'chat-emitted'
  | 'operator-task'
  | 'cron-alert'
  | 'stalled-run'
  | 'budget-incident'
  // Durable chat (Phase D4) — a chat turn that crashed or never reached the
  // gateway, surfaced as an info alert so a failure off the chat page isn't lost.
  | 'chat-turn'

export interface FleetPendingItem {
  /** 'platform' OR 'business:<slug>' — what scope this approval lives in. */
  scope:         string
  /** Human-readable scope name — 'Platform' or the business's display name. */
  scope_label:   string
  /** Origin of the approval — discriminates chat-emitted vs DB-table rows. */
  kind:          ApprovalKind
  session_id:    string
  session_title: string
  message_id:    string
  created_at:    string
  approval:      ApprovalRequest
}

/**
 * Resolved-approval detection. Looks for an `APPROVAL [<id>]:` user reply
 * later in the same session. Case-insensitive; tolerates whitespace.
 *
 * Same shape duplicated in /api/views/approvals — when a 3rd caller lands,
 * promote to its own file.
 */
function isResolved(approval: ApprovalRequest, sessionMessages: ChatMessageRow[], thisMsgIdx: number): boolean {
  const re = new RegExp(
    `APPROVAL\\s*\\[${approval.approval_id.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\]\\s*:`,
    'i',
  )
  for (let i = thisMsgIdx + 1; i < sessionMessages.length; i++) {
    if (sessionMessages[i].role === 'user' && re.test(sessionMessages[i].content)) return true
  }
  return false
}

/**
 * Returns the operator's cross-scope pending approvals, newest first.
 * Caller is responsible for auth (the userId must be a verified Clerk
 * session.userId). Caller-provided `db` keeps this function unit-testable
 * and avoids re-wiring createServerClient when used from a server action.
 */
export async function listFleetPending(
  db: SupabaseClient,
  userId: string,
): Promise<FleetPendingItem[]> {
  // Pull every chat session the operator owns (across scopes). 100 sessions
  // × ~50 messages = ~5000 message-rows worst case — comfortable for a
  // single page-load read.
  const sessionsRes = await (db.from('chat_sessions' as never) as unknown as { select: (c: string) => Chain<ChatSessionRow> })
    .select('id, title, scope')
    .eq('user_id', userId)
    .order('last_message_at', { ascending: false })
    .limit(100)
  const sessionRows = sessionsRes.data ?? []
  if (sessionRows.length === 0) return []

  // Resolve scope labels — businesses by slug (one batch query); platform
  // is just labelled "Platform".
  const businesses = await listBusinessesForUser(userId)
  const nameBySlug = new Map(businesses.map(b => [b.slug, b.name]))

  function scopeLabel(scope: string): string {
    if (scope === 'platform' || scope === 'admin') return 'Platform'
    if (scope.startsWith('business:')) {
      const slug = scope.slice('business:'.length)
      return nameBySlug.get(slug) ?? slug
    }
    return scope
  }

  function externalScope(internalScope: string): string {
    // chat_sessions.scope uses 'platform' for admin chats. Surface as 'admin'
    // to match the rest of the platform-copilot vocabulary (PR #197).
    return internalScope === 'platform' ? 'admin' : internalScope
  }

  const sessionIds = sessionRows.map(s => s.id)
  const messagesRes = await (db.from('chat_messages' as never) as unknown as { select: (c: string) => Chain<ChatMessageRow> })
    .select('id, session_id, role, content, metadata, created_at')
    .in('session_id', sessionIds)
    .order('created_at', { ascending: true })
    .limit(5000)
  const messageRows = messagesRes.data ?? []

  // Group messages by session for the isResolved walk.
  const bySession = new Map<string, ChatMessageRow[]>()
  for (const m of messageRows) {
    const arr = bySession.get(m.session_id) ?? []
    arr.push(m)
    bySession.set(m.session_id, arr)
  }

  const sessionMeta = new Map(sessionRows.map(s => [s.id, s]))

  const pending: FleetPendingItem[] = []
  for (const [sid, msgs] of bySession) {
    const meta = sessionMeta.get(sid)
    if (!meta) continue
    msgs.forEach((m, idx) => {
      const reqs = m.metadata?.approval_requests
      if (!Array.isArray(reqs)) return
      for (const ar of reqs) {
        if (isResolved(ar, msgs, idx)) continue
        pending.push({
          scope:         externalScope(meta.scope),
          scope_label:   scopeLabel(meta.scope),
          kind:          'chat-emitted',
          session_id:    sid,
          session_title: meta.title ?? 'Untitled chat',
          message_id:    m.id,
          created_at:    m.created_at,
          approval:      ar,
        })
      }
    })
  }

  // Also pull pending rows from the `approvals` Postgres table — that's the
  // older approval-card flow that pre-dates the chat-emitted path. Before
  // this aggregation existed, /inbox and /dashboard showed disjoint counts.
  try {
    const apprRes = await (db.from('approvals' as never) as unknown as { select: (c: string) => {
      eq:    (c: string, v: string) => {
        order: (c: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: ApprovalsRow[] | null; error: { message: string } | null }>
        }
      }
    } })
      .select('id, business_slug, type, payload, created_by_agent, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(200)
    const rows = apprRes.data ?? []
    for (const row of rows) {
      if (!row.business_slug) continue
      pending.push({
        scope:         `business:${row.business_slug}`,
        scope_label:   nameBySlug.get(row.business_slug) ?? row.business_slug,
        kind:          'operator-task',
        session_id:    `approvals-table:${row.id}`,
        session_title: row.created_by_agent
          ? `Approval (${row.type}) from ${row.created_by_agent}`
          : `Approval (${row.type})`,
        message_id:    row.id,
        created_at:    row.created_at,
        approval:      synthesiseApprovalRequest(row),
      })
    }
  } catch (err) {
    console.warn('[lib/approvals/fleet] approvals-table fetch failed:', err instanceof Error ? err.message : err)
  }

  // System alerts (cron / stalled runs / budget incidents) — merged into
  // the same feed so the operator has ONE inbox. Each loader is fail-soft.
  try {
    const { loadAllSystemAlerts } = await import('./system-alerts')
    const sys = await loadAllSystemAlerts(db, userId)
    pending.push(...sys)
  } catch (err) {
    console.warn('[lib/approvals/fleet] system-alerts load failed:', err instanceof Error ? err.message : err)
  }

  pending.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return pending
}

interface ApprovalsRow {
  id:                string
  business_slug:     string | null
  type:              string
  payload:           Record<string, unknown> | null
  created_by_agent:  string | null
  created_at:        string
}

/**
 * The `approvals` table doesn't store an ApprovalRequest object directly —
 * it stores `{ type, payload }`. Synthesise a chat-style ApprovalRequest
 * shape so the operator's UI can render both sources with the same row
 * component.
 */
function synthesiseApprovalRequest(row: ApprovalsRow): ApprovalRequest {
  const payload = row.payload ?? {}
  const title =
    (typeof payload.title === 'string' && payload.title) ||
    `${row.type.replace(/_/g, ' ')} approval`
  return {
    approval_id: `approvals-table:${row.id}`,
    title,
    items: [{
      id:                 'approve',
      label:              `Approve ${row.type.replace(/_/g, ' ')}`,
      approved_by_default: false,
    }],
  } as ApprovalRequest
}

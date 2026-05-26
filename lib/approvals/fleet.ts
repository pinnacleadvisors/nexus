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

export interface FleetPendingItem {
  /** 'platform' OR 'business:<slug>' — what scope this approval lives in. */
  scope:         string
  /** Human-readable scope name — 'Platform' or the business's display name. */
  scope_label:   string
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
          session_id:    sid,
          session_title: meta.title ?? 'Untitled chat',
          message_id:    m.id,
          created_at:    m.created_at,
          approval:      ar,
        })
      }
    })
  }

  pending.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return pending
}

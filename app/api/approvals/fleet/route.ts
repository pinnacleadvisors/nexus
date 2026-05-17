/**
 * /api/approvals/fleet
 *
 * GET — cross-scope pending-approvals inbox. Unlike /api/views/approvals
 * (per-scope, mounted in each chat surface's Views drawer), this endpoint
 * walks EVERY chat_session the operator owns — platform + every business —
 * and returns the union of unresolved approval-requests, tagged with their
 * originating scope so the UI can route the click back to the right chat
 * surface.
 *
 * Addresses 2026-05-16 audit Section 7 #2 + Section 8 #11 — the unified
 * "where do I need to steer right now?" view at /dashboard. Same isResolved
 * logic as the per-scope route (looks for `APPROVAL [<id>]:` later in the
 * same session); same shape per pending item but enriched with `scope` +
 * `scope_label` so the operator doesn't have to recognize slugs.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'
import { listBusinessesForUser } from '@/lib/business/db'
import type { ApprovalRequest } from '@/lib/chat/approval'

export const runtime    = 'nodejs'
export const maxDuration = 10

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
 * "Resolved" detection — duplicated from /api/views/approvals so this
 * endpoint stays self-contained. If we extract more aggregators sharing
 * this logic, lift it into lib/chat/approvals-resolver.ts.
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

interface OkResp { ok: true;  pending: FleetPendingItem[] }
interface ErrResp { ok: false; error: string }

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'approvals:fleet' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) {
    return NextResponse.json<ErrResp>({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json<OkResp>({ ok: true, pending: [] })

  // Pull every chat session the operator owns (across scopes). We cap at
  // 100 sessions × ~50 messages = ~5000 message-rows worst case — comfortable
  // for a single page-load read. If the operator ever exceeds this we add
  // an `?since=<iso>` recency filter; today nobody has anywhere near it.
  const sessionsRes = await (db.from('chat_sessions' as never) as unknown as { select: (c: string) => Chain<ChatSessionRow> })
    .select('id, title, scope')
    .eq('user_id', session.userId)
    .order('last_message_at', { ascending: false })
    .limit(100)
  const sessionRows = sessionsRes.data ?? []
  if (sessionRows.length === 0) {
    return NextResponse.json<OkResp>({ ok: true, pending: [] })
  }

  // Resolve scope labels — businesses by slug (one batch query), platform
  // is just labelled "Platform" since there's only one admin scope.
  const businesses = await listBusinessesForUser(session.userId)
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
    // chat_sessions.scope uses 'platform' for the admin chat. Surface it as
    // 'admin' externally to match the rest of the platform-copilot vocabulary
    // (PR #197 audit + the ViewsDropdown uses 'admin').
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

  // Newest first — the operator's eye starts at fresh approvals.
  pending.sort((a, b) => b.created_at.localeCompare(a.created_at))

  return NextResponse.json<OkResp>({ ok: true, pending })
}

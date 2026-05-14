/**
 * GET /api/views/approvals?scope=<scope>
 *
 * Returns the pending approval-requests for the operator across every
 * chat session in the given scope. "Pending" = the assistant message
 * had an approval_requests block AND no later message in the same
 * session contains an `APPROVAL [<approval_id>]: …` reply.
 *
 * The Approval queue panel in the Views dropdown reads from here so
 * the operator has one inbox of "things waiting on my click" across
 * every chat they have open with the same scope.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'
import { isBusinessSlug } from '@/lib/claw/business-client'
import type { ApprovalRequest } from '@/lib/chat/approval'

export const runtime    = 'nodejs'
export const maxDuration = 10

function validScope(s: string | null): s is string {
  if (!s) return false
  if (s === 'admin') return true
  if (s.startsWith('business:')) return isBusinessSlug(s.slice('business:'.length))
  return false
}

interface ChatMessageRow {
  id:         string
  session_id: string
  role:       'user' | 'assistant' | 'system'
  content:    string
  metadata:   { approval_requests?: ApprovalRequest[] } | null
  created_at: string
}

interface ChatSessionRow { id: string; title: string | null; scope: string; user_id: string }

interface Chain<T> {
  eq:    (c: string, v: unknown) => Chain<T>
  in:    (c: string, v: string[]) => Chain<T>
  order: (c: string, opts: { ascending: boolean }) => Chain<T>
  limit: (n: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
}

/**
 * "Resolved" detection: look at every later message in the same session
 * for an `APPROVAL [<id>]:` line. If found, the approval is closed.
 */
function isResolved(approval: ApprovalRequest, sessionMessages: ChatMessageRow[], thisMsgIdx: number): boolean {
  const re = new RegExp(`APPROVAL\\s*\\[${approval.approval_id.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\]\\s*:`, 'i')
  for (let i = thisMsgIdx + 1; i < sessionMessages.length; i++) {
    if (sessionMessages[i].role === 'user' && re.test(sessionMessages[i].content)) return true
  }
  return false
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'views:approvals' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const scope = new URL(req.url).searchParams.get('scope')
  if (!validScope(scope)) return NextResponse.json({ ok: false, error: 'invalid scope' }, { status: 400 })

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: true, pending: [] })

  // Map scope → chat_sessions.scope value. Admin views use 'platform'
  // scope (the platform-chat tables use that label) — historical naming
  // mismatch; the chat surface for admin work is /manage-platform.
  const chatScope = scope === 'admin' ? 'platform' : scope

  const sessionsRes = await (db.from('chat_sessions' as never) as unknown as { select: (c: string) => Chain<ChatSessionRow> })
    .select('id, title, scope, user_id')
    .eq('user_id', session.userId)
    .eq('scope', chatScope)
    .order('last_message_at', { ascending: false })
    .limit(50)
  const sessionRows = sessionsRes.data ?? []
  if (sessionRows.length === 0) return NextResponse.json({ ok: true, pending: [] })

  const sessionIds = sessionRows.map(s => s.id)
  const messagesRes = await (db.from('chat_messages' as never) as unknown as { select: (c: string) => Chain<ChatMessageRow> })
    .select('id, session_id, role, content, metadata, created_at')
    .in('session_id', sessionIds)
    .order('created_at', { ascending: true })
    .limit(2000)
  const messageRows = messagesRes.data ?? []

  // Group by session, then scan for unresolved approval_requests.
  const bySession = new Map<string, ChatMessageRow[]>()
  for (const m of messageRows) {
    const arr = bySession.get(m.session_id) ?? []
    arr.push(m)
    bySession.set(m.session_id, arr)
  }
  const titleBySession = new Map(sessionRows.map(s => [s.id, s.title ?? 'Untitled chat']))

  const pending: Array<{
    session_id:    string
    session_title: string
    message_id:    string
    created_at:    string
    approval:      ApprovalRequest
  }> = []
  for (const [sid, msgs] of bySession) {
    msgs.forEach((m, idx) => {
      const reqs = m.metadata?.approval_requests
      if (!Array.isArray(reqs)) return
      for (const ar of reqs) {
        if (!isResolved(ar, msgs, idx)) {
          pending.push({
            session_id:    sid,
            session_title: titleBySession.get(sid) ?? 'Untitled chat',
            message_id:    m.id,
            created_at:    m.created_at,
            approval:      ar,
          })
        }
      }
    })
  }
  pending.sort((a, b) => b.created_at.localeCompare(a.created_at))

  return NextResponse.json({ ok: true, pending })
}

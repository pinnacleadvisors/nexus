/**
 * GET /api/platform-chat/sessions/[id]/messages — load message history
 *
 * Phase 4 of task_plan-chat.md. The chat UI calls this when the operator
 * picks a session from the sidebar; returns the full append-only log so
 * the conversation can be re-hydrated.
 *
 * Ownership: the session must belong to the authenticated user. We look
 * up the session row first via getSession() (filters by user_id) before
 * loading messages — service-role RLS lets us read chat_messages by
 * session_id, but the ownership check happens at the app layer.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getSession, listMessages } from '@/lib/chat/sessions'

export const runtime    = 'nodejs'
export const maxDuration = 10

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'platform-chat:sessions:messages' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid session id' }, { status: 400 })
  }

  // Ownership check — getSession filters by user_id.
  const owned = await getSession(session.userId, id)
  if (!owned) {
    return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })
  }

  const messages = await listMessages(id, 500)
  return NextResponse.json({
    ok: true,
    session: { id: owned.id, title: owned.title ?? 'New chat', created_at: owned.created_at, last_message_at: owned.last_message_at },
    messages: messages.map(m => ({
      id:         m.id,
      role:       m.role,
      content:    m.content,
      metadata:   m.metadata,
      created_at: m.created_at,
    })),
  })
}

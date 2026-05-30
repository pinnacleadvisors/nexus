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
import { getSession, listMessages, getInflightTurn } from '@/lib/chat/sessions'

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
  // Durable chat (Phase C) — surface a still-running detached turn so the
  // client re-attaches its poll on reopen. Null when no turn is in flight or
  // it was already drained server-side (getInflightTurn fails soft on a stale
  // schema, so reopen never breaks).
  const inflight = await getInflightTurn(id)
  return NextResponse.json({
    ok: true,
    session: {
      id:                          owned.id,
      title:                       owned.title ?? 'New chat',
      created_at:                  owned.created_at,
      last_message_at:             owned.last_message_at,
      // R9 follow-up — surface the LLM-generated retrospective (migration 092)
      // so the chat view can render it at the top of the message pane. Null
      // when fresh / 092 not applied (lib/chat/sessions.ts fails soft).
      retrospective_md:            owned.retrospective_md ?? null,
      retrospective_generated_at:  owned.retrospective_generated_at ?? null,
      // Durable chat (Phase C) — the live gateway jobId when a turn is still
      // detached, so the UI can resume polling it after a tab/app close.
      inflight_job_id:             inflight?.jobId ?? null,
      inflight_started_at:         inflight?.startedAt ?? null,
    },
    messages: messages.map(m => ({
      id:         m.id,
      role:       m.role,
      content:    m.content,
      metadata:   m.metadata,
      created_at: m.created_at,
    })),
  })
}

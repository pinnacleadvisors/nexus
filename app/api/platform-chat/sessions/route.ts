/**
 * GET    /api/platform-chat/sessions          — list current user's sessions
 * POST   /api/platform-chat/sessions          — create a new session
 *
 * Phase 4 of task_plan-chat.md. Authoritative source-of-truth for the chat
 * sidebar. The client never reads chat_sessions directly — all access
 * routes through here so we can authenticate via Clerk + enforce the
 * user_id filter server-side.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { listSessions, createSession } from '@/lib/chat/sessions'

export const runtime    = 'nodejs'
export const maxDuration = 10

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'platform-chat:sessions:list' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const sessions = await listSessions(session.userId, 'platform', 50)
  return NextResponse.json({
    ok:       true,
    sessions: sessions.map(s => ({
      id:              s.id,
      title:           s.title ?? 'New chat',
      agent_slug:      s.agent_slug,
      created_at:      s.created_at,
      last_message_at: s.last_message_at,
    })),
  })
}

interface CreateBody { title?: string | null }

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'platform-chat:sessions:create' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: CreateBody = {}
  try { body = await req.json() } catch { /* empty body is fine for create */ }

  const row = await createSession({
    userId:    session.userId,
    scope:     'platform',
    agentSlug: 'platform-copilot',
    title:     body.title ?? null,
  })
  if (!row) {
    return NextResponse.json({ ok: false, error: 'failed to create session — check DB connectivity' }, { status: 500 })
  }
  return NextResponse.json({
    ok:      true,
    session: { id: row.id, title: row.title ?? 'New chat', created_at: row.created_at, last_message_at: row.last_message_at },
  })
}

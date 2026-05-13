/**
 * GET    /api/businesses/[slug]/chat/sessions — list this business's sessions
 * POST   /api/businesses/[slug]/chat/sessions — create a new session
 *
 * Per-business mirror of /api/platform-chat/sessions (PR #159). Filters
 * chat_sessions to scope = 'business:<slug>' so the operator can have
 * multiple parallel conversations per business. Phase 5b of task_plan-chat.md.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { isBusinessSlug } from '@/lib/claw/business-client'
import { listSessions, createSession } from '@/lib/chat/sessions'

export const runtime    = 'nodejs'
export const maxDuration = 10

export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'business-chat:sessions:list' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { slug } = await context.params
  if (!isBusinessSlug(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid business slug' }, { status: 400 })
  }

  const sessions = await listSessions(session.userId, `business:${slug}`, 50)
  return NextResponse.json({
    ok: true,
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

export async function POST(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'business-chat:sessions:create' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { slug } = await context.params
  if (!isBusinessSlug(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid business slug' }, { status: 400 })
  }

  let body: CreateBody = {}
  try { body = await req.json() } catch { /* empty body fine */ }

  const row = await createSession({
    userId:    session.userId,
    scope:     `business:${slug}`,
    agentSlug: 'business-copilot',
    title:     body.title ?? null,
  })
  if (!row) return NextResponse.json({ ok: false, error: 'failed to create session' }, { status: 500 })

  return NextResponse.json({
    ok:      true,
    session: { id: row.id, title: row.title ?? 'New chat', created_at: row.created_at, last_message_at: row.last_message_at },
  })
}

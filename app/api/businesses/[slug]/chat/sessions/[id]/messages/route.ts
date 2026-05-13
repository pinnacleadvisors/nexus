/**
 * GET /api/businesses/[slug]/chat/sessions/[id]/messages — load history.
 *
 * Mirror of /api/platform-chat/sessions/[id]/messages with an extra
 * scope check so a platform-scope session id can't be loaded via a
 * per-business URL.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { isBusinessSlug } from '@/lib/claw/business-client'
import { getSession, listMessages } from '@/lib/chat/sessions'

export const runtime    = 'nodejs'
export const maxDuration = 10

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string; id: string }> },
) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'business-chat:sessions:messages' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { slug, id } = await context.params
  if (!isBusinessSlug(slug)) return NextResponse.json({ ok: false, error: 'invalid business slug' }, { status: 400 })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'invalid session id' }, { status: 400 })

  const owned = await getSession(session.userId, id)
  if (!owned || owned.scope !== `business:${slug}`) {
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

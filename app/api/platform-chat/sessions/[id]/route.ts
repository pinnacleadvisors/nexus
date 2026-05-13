/**
 * DELETE /api/platform-chat/sessions/[id] — delete a chat session
 *
 * Cascades to chat_messages via the FK ON DELETE CASCADE in migration 036.
 * Ownership checked server-side (the session's user_id must match the
 * authenticated Clerk user).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { deleteSession } from '@/lib/chat/sessions'

export const runtime    = 'nodejs'
export const maxDuration = 10

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'platform-chat:sessions:delete' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid session id' }, { status: 400 })
  }

  const deleted = await deleteSession(session.userId, id)
  if (!deleted) {
    return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

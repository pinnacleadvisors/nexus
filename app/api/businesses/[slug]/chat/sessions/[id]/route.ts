/**
 * DELETE /api/businesses/[slug]/chat/sessions/[id] — delete a per-business
 * chat session. Cascade-deletes messages via FK in migration 036.
 *
 * Ownership + scope checked server-side: the session's user_id must match
 * the authenticated Clerk user AND scope must be exactly 'business:<slug>'.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { isBusinessSlug } from '@/lib/claw/business-client'
import { getSession, deleteSession } from '@/lib/chat/sessions'

export const runtime    = 'nodejs'
export const maxDuration = 10

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ slug: string; id: string }> },
) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'business-chat:sessions:delete' })
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
  const deleted = await deleteSession(session.userId, id)
  if (!deleted) return NextResponse.json({ ok: false, error: 'delete failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

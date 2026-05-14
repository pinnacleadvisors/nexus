import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { updateSessionStatus } from '@/lib/bug-hunt/sessions'

export const runtime    = 'nodejs'
export const maxDuration = 10

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'bug-hunt:pause' })
  if (!rl.success) return rateLimitResponse(rl)
  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await context.params
  const row = await updateSessionStatus(session.userId, id, 'paused')
  return row
    ? NextResponse.json({ ok: true, session: row })
    : NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })
}

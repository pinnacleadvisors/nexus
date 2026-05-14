import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getSession, updateSessionStatus } from '@/lib/bug-hunt/sessions'
import { resolveClaudeCodeConfig } from '@/lib/claw/business-client'

export const runtime    = 'nodejs'
export const maxDuration = 10

/**
 * POST /api/bug-hunt/[id]/resume
 *
 * Same safety check as start — when `force_plan_window=true`, refuse if
 * routing is no longer Max-plan-backed. Catches the case where the
 * gateway died between pausing and resuming.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'bug-hunt:resume' })
  if (!rl.success) return rateLimitResponse(rl)
  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await context.params
  const row = await getSession(session.userId, id)
  if (!row) return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })
  if (row.force_plan_window) {
    const cfg = await resolveClaudeCodeConfig(session.userId)
    if (!cfg) {
      return NextResponse.json({
        ok:    false,
        error: 'force_plan_window=true but no Claude Max gateway reachable — refusing to resume',
        code:  'no_plan_window_route',
      }, { status: 409 })
    }
  }
  const updated = await updateSessionStatus(session.userId, id, 'active')
  return updated
    ? NextResponse.json({ ok: true, session: updated })
    : NextResponse.json({ ok: false, error: 'update failed' }, { status: 500 })
}

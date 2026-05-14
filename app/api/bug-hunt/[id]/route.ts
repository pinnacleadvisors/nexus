/**
 * GET /api/bug-hunt/[id] — full session detail with findings.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getSession, listFindings } from '@/lib/bug-hunt/sessions'
import { getPlanWindowUsage } from '@/lib/claw/plan-window'

export const runtime    = 'nodejs'
export const maxDuration = 10

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'bug-hunt:detail' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id } = await context.params
  const row = await getSession(session.userId, id)
  if (!row) return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })

  const tagPrefix = `bug-hunt-${row.id}-`
  const [findings, maxUsage, proUsage] = await Promise.all([
    listFindings(row.id),
    getPlanWindowUsage(session.userId, 'claude-max', tagPrefix),
    getPlanWindowUsage(session.userId, 'codex-pro',  tagPrefix),
  ])

  return NextResponse.json({
    ok:       true,
    session:  row,
    findings,
    usage:    { claude_max: maxUsage, codex_pro: proUsage },
  })
}

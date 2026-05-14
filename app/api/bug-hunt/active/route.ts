/**
 * GET /api/bug-hunt/active?scope=<scope>
 *
 * Returns the active bug-hunt session for this user+scope (if any),
 * plus live plan-window usage and finding counts. The BugHuntView
 * polls this every few seconds while the panel is open.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getActiveSession, listFindings } from '@/lib/bug-hunt/sessions'
import { getPlanWindowUsage } from '@/lib/claw/plan-window'

export const runtime    = 'nodejs'
export const maxDuration = 10

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 120, window: '1 m', prefix: 'bug-hunt:active' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const scope = new URL(req.url).searchParams.get('scope') ?? 'admin'
  const row = await getActiveSession(session.userId, scope)
  if (!row) return NextResponse.json({ ok: true, session: null })

  // Plan-window usage — session-share slice uses 'bug-hunt-<id>-' prefix so
  // turns tagged for this session count toward its slice. Other operator
  // chats counted in the "window" total but NOT the session slice.
  const tagPrefix = `bug-hunt-${row.id}-`
  const [maxUsage, proUsage, findings] = await Promise.all([
    getPlanWindowUsage(session.userId, 'claude-max', tagPrefix),
    getPlanWindowUsage(session.userId, 'codex-pro',  tagPrefix),
    listFindings(row.id),
  ])

  const findingsCounts = {
    open:        findings.filter(f => f.status === 'open').length,
    pr_opened:   findings.filter(f => f.status === 'pr-opened').length,
    merged:      findings.filter(f => f.status === 'merged').length,
    wont_fix:    findings.filter(f => f.status === 'wont-fix').length,
  }

  return NextResponse.json({
    ok:       true,
    session:  row,
    usage:    { claude_max: maxUsage, codex_pro: proUsage },
    findings: findingsCounts,
  })
}

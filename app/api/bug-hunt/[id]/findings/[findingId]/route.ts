/**
 * PATCH /api/bug-hunt/[id]/findings/[findingId]
 *
 * Update a finding's status / PR linkage. Operator hits this from the
 * Bug-hunt panel (e.g. "Mark wont-fix") or the agent updates it during
 * an iteration when it opens a PR.
 *
 * Body: { status?, pr_url?, branch? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { updateFinding, type FindingStatus } from '@/lib/bug-hunt/sessions'

export const runtime    = 'nodejs'
export const maxDuration = 10

const ALLOWED_STATUS = new Set<FindingStatus>(['open', 'pr-opened', 'merged', 'wont-fix'])

interface Body {
  status?:  string
  pr_url?:  string | null
  branch?:  string | null
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string; findingId: string }> }) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'bug-hunt:finding-patch' })
  if (!rl.success) return rateLimitResponse(rl)
  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { findingId } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(findingId)) return NextResponse.json({ ok: false, error: 'invalid finding id' }, { status: 400 })

  let body: Body = {}
  try { body = await req.json() } catch { /* fall through */ }
  const patch: { status?: FindingStatus; pr_url?: string | null; branch?: string | null } = {}
  if (typeof body.status === 'string' && ALLOWED_STATUS.has(body.status as FindingStatus)) patch.status = body.status as FindingStatus
  if (body.pr_url !== undefined) patch.pr_url = body.pr_url
  if (body.branch !== undefined) patch.branch = body.branch
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400 })

  const updated = await updateFinding(session.userId, findingId, patch)
  return updated
    ? NextResponse.json({ ok: true, finding: updated })
    : NextResponse.json({ ok: false, error: 'finding not found' }, { status: 404 })
}

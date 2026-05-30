/**
 * /api/loops/[id] — single Loop.
 *
 *   GET   → the Loop + its full iteration log (dashboard).
 *   PATCH → operator controls: status transitions (pause / resume / kill /
 *           done) + cost / iteration / time cap amendments.
 *
 * Auth: operator only (authenticateOps). 200 + {ok:false} on transient
 * failure / missing migration.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { getLoopWithIterations, patchLoop } from '@/lib/loops/store'
import { isLoopStatus, type LoopPatchInput } from '@/lib/loops/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: 'invalid loop id' })

  const a = await authenticateOps(req, {})
  if ('response' in a) return a.response

  const res = await getLoopWithIterations(id, a.userId)
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error })
  if (!res.loop) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, loop: res.loop, iterations: res.iterations })
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: 'invalid loop id' })

  let body: Partial<LoopPatchInput> & { userId?: string } = {}
  try { body = (await req.json()) as typeof body } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' })
  }

  const a = await authenticateOps(req, { bodyUserId: body.userId })
  if ('response' in a) return a.response

  if (body.status !== undefined && !isLoopStatus(body.status)) {
    return NextResponse.json({ ok: false, error: 'status must be active | paused | done | killed' })
  }

  const patch: LoopPatchInput = {}
  if (body.status !== undefined) patch.status = body.status
  for (const k of ['cost_cap_usd', 'iteration_cap', 'time_cap_hours'] as const) {
    if (body[k] !== undefined) {
      const v = body[k]
      patch[k] = v === null ? null : (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null)
    }
  }

  const res = await patchLoop(id, a.userId, patch)
  if (!res.ok) {
    const status = res.error === 'not_found' ? 404 : 200
    return NextResponse.json({ ok: false, error: res.error }, { status })
  }
  return NextResponse.json({ ok: true, loop: res.loop })
}

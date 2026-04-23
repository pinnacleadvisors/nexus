/**
 * POST /api/runs/[id]/advance — move a run to a new phase.
 *   Body: { to: RunPhase, payload?: Record<string, unknown> }
 *
 * Only the run's owner can advance it. The phase transition, plus any payload
 * context (e.g. `{ prdRef: '...' }`), is appended to run_events so the trail
 * is replayable.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { advancePhase, getRun } from '@/lib/runs/controller'
import { audit } from '@/lib/audit'
import { RUN_PHASE_ORDER, type RunPhase } from '@/lib/types'

export const runtime = 'nodejs'

const VALID_PHASES = new Set<RunPhase>(RUN_PHASE_ORDER)

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'runs:advance' },
  })
  if ('response' in g) return g.response

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as { to?: RunPhase; payload?: Record<string, unknown> }

  if (!body.to || !VALID_PHASES.has(body.to)) {
    return NextResponse.json({ error: 'invalid phase' }, { status: 400 })
  }

  const current = await getRun(id)
  if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (current.userId !== g.userId) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const run = await advancePhase(id, body.to, body.payload ?? {})
  if (!run) return NextResponse.json({ error: 'advance failed' }, { status: 500 })

  audit(req, {
    action: 'run.advance',
    resource: 'run',
    resourceId: id,
    userId: g.userId,
    metadata: { from: current.phase, to: body.to },
  })

  return NextResponse.json({ run })
}

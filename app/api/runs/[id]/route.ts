/**
 * GET /api/runs/[id] — fetch a single run + its event log (most recent 100)
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { getRun, listEvents } from '@/lib/runs/controller'

export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'runs:get' },
  })
  if ('response' in g) return g.response

  const { id } = await ctx.params
  const run = await getRun(id)
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // RLS enforces user scoping in DB, but defensive recheck for the service-role
  // client path which bypasses RLS.
  if (run.userId !== g.userId) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const events = await listEvents(id)
  return NextResponse.json({ run, events })
}

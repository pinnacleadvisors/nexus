/**
 * GET /api/dashboard/worst-offenders — C1 observability surface.
 *
 * Returns the top-N agents ranked by a composite score of latency p95 +
 * cost p50 + (1 − approve rate). The dashboard widget uses this to surface
 * agents the optimiser should look at next.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { getWorstOffenders } from '@/lib/observability'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'obs:worst' },
  })
  if ('response' in g) return g.response

  const url = new URL(req.url)
  const n  = Math.min(parseInt(url.searchParams.get('n') ?? '5', 10) || 5, 20)
  const hrs = Math.min(parseInt(url.searchParams.get('windowHours') ?? '168', 10) || 168, 720)

  const offenders = await getWorstOffenders(g.userId, n, hrs)
  return NextResponse.json({ offenders, windowHours: hrs })
}

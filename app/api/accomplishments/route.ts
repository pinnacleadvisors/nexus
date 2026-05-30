/**
 * GET /api/accomplishments — the operator's achievement board.
 *
 * Pure read-model over real revenue (experiment_metrics) + business/niche
 * counts. Returns the evaluated tiers, operator level, and the closest next
 * tier. No writes. Always 200 + {ok:false} on a transient failure (retry-storm
 * rule) so the page never 5xx-loops.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { evaluate } from '@/lib/accomplishments/evaluate'

export const runtime     = 'nodejs'
export const maxDuration = 10

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'accomplishments:get' },
  })
  if ('response' in g) return g.response

  try {
    const state = await evaluate(g.userId)
    return NextResponse.json({ ok: true, ...state })
  } catch (e) {
    return NextResponse.json({
      ok:               false,
      error:            e instanceof Error ? e.message : 'failed to evaluate accomplishments',
      achievements:     [],
      unlocked:         [],
      locked:           [],
      operatorLevel:    0,
      nextTier:         null,
      liveEventLevel:   5,
      liveEventUnlocked: false,
      combinedRevenue:  0,
      businessCount:    0,
      nicheCount:       0,
    })
  }
}

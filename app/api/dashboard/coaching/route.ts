/**
 * GET /api/dashboard/coaching — operator coaching insights.
 *
 * R5 of the UX consultation. Surface for the CoachingCard on /dashboard.
 *
 * Generates insights from `lib/coaching/insights.ts`. Pure read. Filters
 * by Clerk userId so the operator only sees insights for their own
 * businesses.
 *
 * Cached for 60 s on the client side (the underlying queries hit 4
 * tables in parallel; refreshing every render would be wasteful).
 *
 * Retry-storm safe: 200 + {ok: false} on transient errors.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { generateCoachingInsights } from '@/lib/coaching/insights'

export const runtime = 'nodejs'
export const maxDuration = 15

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'dashboard:coaching' },
  })
  if ('response' in g) return g.response

  try {
    const insights = await generateCoachingInsights(g.userId)
    return NextResponse.json({
      ok: true,
      insights,
      generated_at: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json({
      ok:       false,
      error:    err instanceof Error ? err.message : 'unknown',
      insights: [],
    })
  }
}

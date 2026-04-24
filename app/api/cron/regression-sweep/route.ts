/**
 * POST /api/cron/regression-sweep — manual trigger for the C2 daily sweep.
 *
 * Owner-only. Compares each user's last-24h metrics against their 7-day
 * baseline and files `perf-regression: ...` feedback rows the optimiser
 * picks up. Returns `{ detected, filed }` for verification.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { runRegressionSweep } from '@/lib/observability/regression'
import { feedRouterFromMetricSamples } from '@/lib/swarm/Router'

export const runtime = 'nodejs'

function getAllowedUserIds(): Set<string> | null {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map(id => id.trim()).filter(Boolean))
}

function isOwner(userId: string): boolean {
  const allowed = getAllowedUserIds()
  if (!allowed) return true
  return allowed.has(userId)
}

export async function POST(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 10, window: '1 m', prefix: 'cron:regression' },
  })
  if ('response' in g) return g.response

  if (!isOwner(g.userId)) return NextResponse.json({ error: 'owner only' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { userId?: string }
  const targetUserId = body.userId && typeof body.userId === 'string' ? body.userId : g.userId

  const result = await runRegressionSweep(targetUserId)
  // C6 — pipe the same metric samples into the router bandit so Q-values
  // track reality even when no swarm has run recently.
  const routerFeed = await feedRouterFromMetricSamples(targetUserId, 24)
  return NextResponse.json({ ok: true, targetUserId, ...result, router: routerFeed })
}

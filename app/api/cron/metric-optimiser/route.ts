/**
 * POST /api/cron/metric-optimiser — manual trigger for the hourly Inngest sweep.
 *
 * Owner-only (ALLOWED_USER_IDS gate inside). Returns `{ detected, filed }` so
 * the owner can verify the workflow-feedback queue picked up drift signals.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { runMetricOptimiser } from '@/lib/runs/metric-triggers'

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
    rateLimit: { limit: 10, window: '1 m', prefix: 'cron:metric' },
  })
  if ('response' in g) return g.response

  if (!isOwner(g.userId)) {
    return NextResponse.json({ error: 'owner only' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { userId?: string }
  const targetUserId = body.userId && typeof body.userId === 'string' ? body.userId : g.userId

  const result = await runMetricOptimiser(targetUserId)
  return NextResponse.json({ ok: true, targetUserId, ...result })
}

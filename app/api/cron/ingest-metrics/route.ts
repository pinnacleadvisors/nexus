/**
 * POST /api/cron/ingest-metrics — manual trigger for the A11 measure-phase sweep.
 *
 * Owner-only; goes through guardRequest() so CSRF + auth + rate-limit are
 * enforced. Returns the per-run result list so the owner can verify ingestion.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { ingestMetricsForUser } from '@/lib/runs/measure-ingester'

export const runtime = 'nodejs'
export const maxDuration = 60

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
    rateLimit: { limit: 10, window: '1 m', prefix: 'cron:ingest' },
  })
  if ('response' in g) return g.response

  if (!isOwner(g.userId)) return NextResponse.json({ error: 'owner only' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { userId?: string }
  const targetUserId = body.userId && typeof body.userId === 'string' ? body.userId : g.userId

  const results = await ingestMetricsForUser(targetUserId)
  return NextResponse.json({ ok: true, targetUserId, results })
}

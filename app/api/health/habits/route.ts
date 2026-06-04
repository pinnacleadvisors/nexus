/**
 * GET/POST /api/health/habits — the operator's Health life-domain habit log.
 *
 * GET  → { ok, days:[{day,payload}], streak, loggedToday } (last 120d).
 * POST → log a day ({ day?, payload? }; defaults to today).
 *
 * Pure life-domain surface — NO revenue / cost-guard / kill-switch (life
 * domains bypass that machinery by design). Always 200 + {ok:false} on a
 * transient failure (retry-storm rule). Fail-soft: missing migration 102 → the
 * lib/life/db helpers return empty and this still renders an empty board.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { ensureHealthDomain, logHabit, getHabitLog } from '@/lib/life/db'
import { HEALTH_DOMAIN_SLUG } from '@/lib/life/types'

export const runtime     = 'nodejs'
export const maxDuration = 10

function todayStr(): string { return new Date().toISOString().slice(0, 10) }

/** Consecutive logged days ending today OR yesterday (operator may not have
 *  logged today yet). */
function computeStreak(loggedDays: string[]): number {
  const set = new Set(loggedDays)
  const today = todayStr()
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const anchor = set.has(today) ? today : (set.has(yesterday) ? yesterday : null)
  if (!anchor) return 0
  let streak = 0
  let cursor = new Date(anchor)
  while (set.has(cursor.toISOString().slice(0, 10))) {
    streak++
    cursor = new Date(cursor.getTime() - 86_400_000)
  }
  return streak
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'health:habits:get' })
  if (!rl.success) return rateLimitResponse(rl)
  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  try {
    await ensureHealthDomain(session.userId)
    const days   = await getHabitLog(session.userId, HEALTH_DOMAIN_SLUG, 120)
    const streak = computeStreak(days.map(d => d.day))
    return NextResponse.json({ ok: true, days, streak, loggedToday: days.some(d => d.day === todayStr()) })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed', days: [], streak: 0, loggedToday: false })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'health:habits:post' })
  if (!rl.success) return rateLimitResponse(rl)
  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: { day?: string; payload?: Record<string, unknown> } = {}
  try { body = await req.json() } catch { /* defaults below */ }
  const day     = (typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day)) ? body.day : todayStr()
  const payload = (body.payload && typeof body.payload === 'object') ? body.payload : { logged: true }

  try {
    await ensureHealthDomain(session.userId)
    const ok = await logHabit(session.userId, HEALTH_DOMAIN_SLUG, day, payload)
    return NextResponse.json({ ok, day })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed' })
  }
}

/**
 * POST /api/teams/spawn — materialise a department for a business.
 *
 * Body: { businessSlug, departmentSlug, niche?, ecosystemOverrides? }
 *
 * Returns { ok, team } with the newly-inserted row + members. v1 only
 * writes to Postgres — the per-business container mount happens later
 * (the operator can already spawn paused teams and rebind ecosystems
 * from the /teams UI before activation).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { materialiseTeam } from '@/lib/teams/template'
import { createTeam } from '@/lib/teams/store'
import { getDepartment, type DepartmentSlug } from '@/lib/teams/departments'

export const runtime     = 'nodejs'
export const maxDuration = 15

interface SpawnBody {
  businessSlug?:       string | null
  departmentSlug?:     string
  niche?:              string | null
  ecosystemOverrides?: Record<string, string>
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 20, window: '1 m', prefix: 'teams:spawn' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: SpawnBody = {}
  try { body = await req.json() } catch { /* validated below */ }

  const dept = body.departmentSlug ? getDepartment(body.departmentSlug) : null
  if (!dept) return NextResponse.json({ ok: false, error: 'invalid department slug' }, { status: 400 })

  const result = materialiseTeam({
    userId:             session.userId,
    businessSlug:       body.businessSlug ?? null,
    departmentSlug:     dept.slug as DepartmentSlug,
    niche:              body.niche ?? null,
    ecosystemOverrides: body.ecosystemOverrides,
  })
  if (!result.ok || !result.payload) {
    return NextResponse.json({ ok: false, error: result.reason ?? 'materialise failed' }, { status: 400 })
  }

  const team = await createTeam(result.payload)
  if (!team) {
    // Retry-storm safe — 200 + ok:false so the optimistic UI doesn't 5xx
    // the spawn button.
    return NextResponse.json({ ok: false, error: 'insert failed' }, { status: 200 })
  }

  return NextResponse.json({ ok: true, team })
}

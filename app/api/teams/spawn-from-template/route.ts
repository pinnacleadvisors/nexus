/**
 * POST /api/teams/spawn-from-template
 *   { templateId, businessSlug }
 *
 * Spawns every team in the template's blueprint against the target
 * business, then re-links parent_team_id by walking the blueprint's
 * parent_idx pointers.
 *
 * Returns { ok, teams: [...] } — the operator can immediately rebind
 * any ecosystem on /teams afterward.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { spawnFromTemplate } from '@/lib/teams/templates'
import { createServerClient } from '@/lib/supabase'

export const runtime     = 'nodejs'
export const maxDuration = 30

interface PostBody { templateId?: string; businessSlug?: string }

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'teams:spawn-from-template' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: PostBody = {}
  try { body = await req.json() } catch { /* validated below */ }

  if (!body.templateId || !body.businessSlug) {
    return NextResponse.json({ ok: false, error: 'templateId and businessSlug required' }, { status: 400 })
  }
  if (!/^[0-9a-f-]{36}$/i.test(body.templateId)) {
    return NextResponse.json({ ok: false, error: 'invalid templateId' }, { status: 400 })
  }

  let niche: string | null = null
  const db = createServerClient()
  if (db) {
    type Chain<T> = { eq: (c: string, v: string) => Chain<T>; single: () => Promise<{ data: T | null }> }
    const res = await (db.from('businesses' as never) as unknown as { select: (c: string) => Chain<{ niche: string | null }> })
      .select('niche').eq('slug', body.businessSlug).single()
    niche = res.data?.niche ?? null
  }

  const teams = await spawnFromTemplate(session.userId, body.templateId, body.businessSlug, niche)
  if (teams.length === 0) {
    return NextResponse.json({ ok: false, error: 'template not found OR no teams spawned (perhaps depts already exist for this business)' }, { status: 200 })
  }
  return NextResponse.json({ ok: true, teams })
}

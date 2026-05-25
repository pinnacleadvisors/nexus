/**
 * GET  /api/teams/templates                          — list operator's saved templates
 * POST /api/teams/templates  { businessSlug, name }  — snapshot the business's current org as a new template
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { captureTemplate, listTemplates } from '@/lib/teams/templates'
import { createServerClient } from '@/lib/supabase'

export const runtime     = 'nodejs'
export const maxDuration = 15

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'teams:templates:list' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const templates = await listTemplates(session.userId)
  return NextResponse.json({ ok: true, templates })
}

interface PostBody { businessSlug?: string; name?: string }

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'teams:templates:create' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: PostBody = {}
  try { body = await req.json() } catch { /* validated below */ }

  if (!body.businessSlug || !body.name) {
    return NextResponse.json({ ok: false, error: 'businessSlug and name required' }, { status: 400 })
  }

  // Resolve niche from the business row for the niche-scoped template lookup.
  let niche: string | null = null
  const db = createServerClient()
  if (db) {
    type Chain<T> = { eq: (c: string, v: string) => Chain<T>; single: () => Promise<{ data: T | null }> }
    const res = await (db.from('businesses' as never) as unknown as { select: (c: string) => Chain<{ niche: string | null }> })
      .select('niche').eq('slug', body.businessSlug).single()
    niche = res.data?.niche ?? null
  }

  const tmpl = await captureTemplate(session.userId, body.businessSlug, body.name, niche)
  if (!tmpl) return NextResponse.json({ ok: false, error: 'no teams to snapshot (or insert failed)' }, { status: 200 })

  return NextResponse.json({ ok: true, template: tmpl })
}

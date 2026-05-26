/**
 * PATCH /api/skills/:slug — update the per-operator model override.
 * DELETE /api/skills/:slug — clear the override (revert to frontmatter default).
 *
 * Body for PATCH:
 *   { model: string, rationale?: string }
 *
 * The model id is loosely validated (length + slug-safe chars). The
 * recommender path passes rationale so the UI can show why; manual
 * picks pass an empty rationale.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { setOverride, clearOverride } from '@/lib/skills/overrides'

export const runtime = 'nodejs'
export const maxDuration = 15

interface RouteCtx { params: Promise<{ slug: string }> }

interface PatchBody { model?: unknown; rationale?: unknown }

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'skills:patch' },
  })
  if ('response' in g) return g.response

  const { slug } = await ctx.params
  if (!/^[a-z0-9_-]+$/i.test(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid_slug' })
  }
  const body = await req.json().catch(() => ({})) as PatchBody
  const model = typeof body.model === 'string' ? body.model.trim() : ''
  if (!model) return NextResponse.json({ ok: false, error: 'model required' })

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const rationale = typeof body.rationale === 'string' ? body.rationale.slice(0, 500) : undefined
  const out = await setOverride(db, g.userId, slug, model, rationale)
  return NextResponse.json(out)
}

export async function DELETE(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 10, window: '1 m', prefix: 'skills:delete-override' },
  })
  if ('response' in g) return g.response

  const { slug } = await ctx.params
  if (!/^[a-z0-9_-]+$/i.test(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid_slug' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const out = await clearOverride(db, g.userId, slug)
  return NextResponse.json(out)
}

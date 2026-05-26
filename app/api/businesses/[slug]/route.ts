/**
 * /api/businesses/[slug]
 *
 * GET   — single business overview (currently not used; the page does its own
 *         read via createServerClient). Reserved for future client-side reads.
 * PATCH — narrow updater for mutable fields the operator can edit inline:
 *           - mission (string | null)
 *         Additional editable fields land here over time. Each field is
 *         allow-listed to prevent privilege escalation through over-posting.
 *
 * Auth: Clerk session + ALLOWED_USER_IDS (via guardRequest). The business
 * row must belong to the caller — verified before any write.
 *
 * Returns 200 always (retry-storm rule) — the operator's inline editor
 * polls error state from the response body, never from HTTP status.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

interface PatchBody {
  mission?: unknown
}

interface RouteCtx {
  params: Promise<{ slug: string }>
}

/** Limit mission length so a paste-bomb can't blow up the DB row. */
const MISSION_MAX_LEN = 1_000

function sanitizeMission(input: unknown): string | null {
  if (input === null) return null
  if (typeof input !== 'string') return null
  const trimmed = input.trim().slice(0, MISSION_MAX_LEN)
  return trimmed.length === 0 ? null : trimmed
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 20, window: '1 m', prefix: 'business:patch' },
  })
  if ('response' in g) return g.response

  const { slug } = await ctx.params
  if (!slug || !/^[a-z0-9-]{1,60}$/.test(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid_slug' })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' })
  }

  // Allow-list of editable fields. Add new mutable fields here as we expose
  // them in the UI — never trust the body shape.
  const updates: Record<string, string | null> = {}
  if ('mission' in body) {
    updates.mission = sanitizeMission(body.mission)
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, error: 'no_editable_fields' })
  }

  const db = createServerClient()
  if (!db) {
    return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })
  }

  // Ownership check — the business must belong to the caller.
  try {
    const owner = await (db.from('business_operators' as never) as unknown as {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{ data: { user_id: string } | null; error: { message: string } | null }>
        }
      }
    }).select('user_id').eq('slug', slug).maybeSingle()
    if (owner.error)                  return NextResponse.json({ ok: false, error: 'query_failed' })
    if (!owner.data)                  return NextResponse.json({ ok: false, error: 'not_found' })
    if (owner.data.user_id !== g.userId) return NextResponse.json({ ok: false, error: 'forbidden' })
  } catch (err) {
    console.warn('[/api/businesses/PATCH] ownership check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'query_failed' })
  }

  try {
    const upd = await (db.from('business_operators' as never) as unknown as {
      update: (rec: Record<string, unknown>) => {
        eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>
      }
    }).update(updates).eq('slug', slug)
    if (upd.error) {
      console.warn('[/api/businesses/PATCH] update failed:', upd.error.message)
      return NextResponse.json({ ok: false, error: 'update_failed' })
    }
    return NextResponse.json({ ok: true, updated: Object.keys(updates) })
  } catch (err) {
    console.warn('[/api/businesses/PATCH] update exception:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'update_failed' })
  }
}

/**
 * PATCH  /api/org/roles/[id]  — update an agent_role.
 * DELETE /api/org/roles/[id]  — delete an agent_role (children promoted via ON DELETE SET NULL).
 *
 * PATCH body: same shape as POST /api/org/roles, all fields optional except
 * the constraints enforced at the DB layer (single-assignee).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

function isOwner(userId: string): boolean {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return true
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean)).has(userId)
}

const ALLOWED_FIELDS = [
  'role_title',
  'parent_role_id',
  'business_slug',
  'assigned_agent_slug',
  'assigned_user_id',
  'responsibilities',
  'reports_to_summary',
  'sort_order',
] as const

interface RouteCtx { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  if (!isOwner(session.userId)) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }) }

  const update: Record<string, unknown> = {}
  for (const f of ALLOWED_FIELDS) {
    if (f in body) update[f] = body[f]
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'no editable fields in body' }, { status: 400 })
  }

  // Single-assignee XOR — when both keys come in, reject.
  if (update.assigned_agent_slug && update.assigned_user_id) {
    return NextResponse.json({ ok: false, error: 'single-assignee invariant' }, { status: 400 })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'database not configured' }, { status: 503 })

  const res = await ((db.from('agent_roles' as never) as unknown as {
    update: (r: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
  }).update(update).eq('id', id))

  if (res.error) return NextResponse.json({ ok: false, error: res.error.message })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  if (!isOwner(session.userId)) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'database not configured' }, { status: 503 })

  const res = await ((db.from('agent_roles' as never) as unknown as {
    delete: () => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
  }).delete().eq('id', id))

  if (res.error) return NextResponse.json({ ok: false, error: res.error.message })
  return NextResponse.json({ ok: true })
}

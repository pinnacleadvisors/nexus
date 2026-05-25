/**
 * POST /api/org/seed
 *
 * Seed the agent_roles table with a default CEO / CTO / Engineer / Designer
 * hierarchy. Idempotent — only inserts when the (business_slug, role_title)
 * pair doesn't already exist. Used by the empty-state CTA on /org.
 *
 * Body: { businessSlug?: string | null }
 * Returns: { ok: true, inserted: number } | { ok: false, error }
 *
 * Auth: Clerk + ALLOWED_USER_IDS.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { listRoles, upsertRole, DEFAULT_ROLES } from '@/lib/org/roles'

export const runtime = 'nodejs'

function isOwner(userId: string): boolean {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return true
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean)).has(userId)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  if (!isOwner(session.userId)) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

  let body: { businessSlug?: string | null } = {}
  try { body = await req.json() } catch { /* allow empty body */ }
  const businessSlug = body.businessSlug?.trim() || null

  const existing = await listRoles({ businessSlug })
  const existingTitles = new Set(existing.map(r => r.role_title.toLowerCase()))

  // First pass: insert top-level (CEO). Capture its id so the rest can link.
  let ceoId: string | null = existing.find(r => r.role_title.toLowerCase() === 'ceo')?.id ?? null
  let inserted = 0

  if (!ceoId) {
    const seed = DEFAULT_ROLES[0]
    const res = await upsertRole({ ...seed, business_slug: businessSlug, parent_role_id: null })
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error })
    ceoId = res.id
    inserted++
  }

  // Second pass: link the rest under CEO. CTO + Designer are direct reports;
  // Engineer reports to CTO. We resolve the CTO id after its insert.
  let ctoId: string | null = existing.find(r => r.role_title.toLowerCase() === 'cto')?.id ?? null
  if (!ctoId && !existingTitles.has('cto')) {
    const seed = DEFAULT_ROLES[1]
    const res = await upsertRole({ ...seed, business_slug: businessSlug, parent_role_id: ceoId })
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error })
    ctoId = res.id
    inserted++
  }

  if (!existingTitles.has('engineer')) {
    const seed = DEFAULT_ROLES[2]
    const res = await upsertRole({ ...seed, business_slug: businessSlug, parent_role_id: ctoId ?? ceoId })
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error })
    inserted++
  }

  if (!existingTitles.has('designer')) {
    const seed = DEFAULT_ROLES[3]
    const res = await upsertRole({ ...seed, business_slug: businessSlug, parent_role_id: ceoId })
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error })
    inserted++
  }

  return NextResponse.json({ ok: true, inserted })
}

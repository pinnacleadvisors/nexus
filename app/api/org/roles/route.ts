/**
 * POST /api/org/roles  — create a new agent_role.
 *
 * Body: {
 *   role_title:           string
 *   parent_role_id?:      string | null
 *   business_slug?:       string | null
 *   assigned_agent_slug?: string | null
 *   assigned_user_id?:    string | null
 *   responsibilities?:    string | null
 *   reports_to_summary?:  string | null
 *   sort_order?:          number
 * }
 *
 * Returns: { ok: true, id } | { ok: false, error }
 *
 * Auth: Clerk + ALLOWED_USER_IDS.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { upsertRole } from '@/lib/org/roles'

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

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }) }

  const title = typeof body.role_title === 'string' ? body.role_title.trim() : ''
  if (!title) return NextResponse.json({ ok: false, error: 'role_title required' }, { status: 400 })
  if (title.length > 200) return NextResponse.json({ ok: false, error: 'role_title too long (max 200)' }, { status: 400 })

  const res = await upsertRole({
    role_title:           title,
    parent_role_id:       typeof body.parent_role_id === 'string' ? body.parent_role_id : null,
    business_slug:        typeof body.business_slug === 'string' ? body.business_slug : null,
    assigned_agent_slug:  typeof body.assigned_agent_slug === 'string' ? body.assigned_agent_slug : null,
    assigned_user_id:     typeof body.assigned_user_id === 'string' ? body.assigned_user_id : null,
    responsibilities:     typeof body.responsibilities === 'string' ? body.responsibilities : null,
    reports_to_summary:   typeof body.reports_to_summary === 'string' ? body.reports_to_summary : null,
    sort_order:           typeof body.sort_order === 'number' ? body.sort_order : 0,
  })
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error })
  return NextResponse.json({ ok: true, id: res.id })
}

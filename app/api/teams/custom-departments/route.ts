/**
 * GET  /api/teams/custom-departments — list custom departments owned by the operator.
 * POST /api/teams/custom-departments — create one.
 *
 * Custom departments live alongside the 7 starter departments in the org-
 * chart UI. Same lifecycle (spawn / rebind / pause / archive); the only
 * difference is the slug + roster come from `departments_custom` instead
 * of the compile-time DEPARTMENTS registry.
 *
 * Part 4 of task_plan-departments-and-ecosystems.md, v1.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'

export const runtime     = 'nodejs'
export const maxDuration = 10

interface CustomDeptRow {
  id:           string
  user_id:      string
  slug:         string
  label:        string
  purpose:      string
  roles:        string[]
  default_ecosystem_kinds: string[]
  approval_gates: string[]
  created_at:   string
}

interface PostBody {
  slug?:         string
  label?:        string
  purpose?:      string
  roles?:        string[]
  defaultEcosystemKinds?: string[]
  approvalGates?: string[]
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'teams:custom-dept:list' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: true, departments: [] })

  type Chain<T> = { eq: (c: string, v: unknown) => Chain<T>; order: (c: string, opts: { ascending: boolean }) => Chain<T>; limit: (n: number) => Promise<{ data: T[] | null }> }
  const res = await (db.from('departments_custom' as never) as unknown as { select: (c: string) => Chain<CustomDeptRow> })
    .select('*').eq('user_id', session.userId).order('created_at', { ascending: false }).limit(100)
  return NextResponse.json({ ok: true, departments: res.data ?? [] })
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'teams:custom-dept:create' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: PostBody = {}
  try { body = await req.json() } catch { /* validate below */ }

  if (!body.slug || !body.label || !body.purpose) {
    return NextResponse.json({ ok: false, error: 'slug, label, purpose required' }, { status: 400 })
  }
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(body.slug)) {
    return NextResponse.json({ ok: false, error: 'slug must be lowercase + hyphens, 2-41 chars, starts with a letter' }, { status: 400 })
  }
  // Reserved slugs — can't shadow the 7 starters.
  const STARTERS = ['executive', 'engineering', 'design', 'content', 'sales-cs', 'operations', 'research']
  if (STARTERS.includes(body.slug)) {
    return NextResponse.json({ ok: false, error: `slug "${body.slug}" is reserved for the starter departments` }, { status: 400 })
  }

  const row = {
    user_id:                 session.userId,
    slug:                    body.slug,
    label:                   body.label.slice(0, 120),
    purpose:                 body.purpose.slice(0, 500),
    roles:                   (body.roles ?? []).filter(r => typeof r === 'string').slice(0, 20),
    default_ecosystem_kinds: (body.defaultEcosystemKinds ?? []).filter(r => typeof r === 'string'),
    approval_gates:          (body.approvalGates ?? []).filter(r => typeof r === 'string'),
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'db unavailable' }, { status: 200 })

  const res = await (db.from('departments_custom' as never) as unknown as {
    insert: (r: typeof row) => { select: () => { single: () => Promise<{ data: CustomDeptRow | null; error?: { message: string } }> } }
  }).insert(row).select().single()

  if (!res.data) {
    return NextResponse.json({ ok: false, error: res.error?.message ?? 'insert failed' }, { status: 200 })
  }
  return NextResponse.json({ ok: true, department: res.data })
}

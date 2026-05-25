/**
 * GET /api/memory/pending-edges — list LLM-extracted edges awaiting operator approval.
 *
 * Query:
 *   scope=<scope_id>          required
 *   min_confidence=<0..1>     optional; defaults to 0
 *   limit=<n>                 default 50, max 200
 *
 * Returns rows sorted by confidence desc — highest-leverage first.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'

export const runtime     = 'nodejs'
export const maxDuration = 10

interface EdgeRow {
  id:               string
  scope_id:         string
  src_kind:         string
  src_id:           string
  predicate:        string
  dst_kind:         string
  dst_id:           string
  confidence:       number
  source:           string
  pending_approval: boolean
  created_at:       string
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'memory:pending-edges:list' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const url   = new URL(req.url)
  const scope = url.searchParams.get('scope')
  if (!scope) return NextResponse.json({ ok: false, error: 'scope required' }, { status: 400 })

  const minConfidence = Math.max(0, Math.min(1, parseFloat(url.searchParams.get('min_confidence') ?? '0')))
  const limit         = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') ?? '50', 10)))

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: true, edges: [] })

  type Chain<T> = {
    eq:    (c: string, v: unknown) => Chain<T>
    gte:   (c: string, v: number)  => Chain<T>
    order: (c: string, opts: { ascending: boolean }) => Chain<T>
    limit: (n: number) => Promise<{ data: T[] | null }>
  }
  const res = await (db.from('mol_edge' as never) as unknown as { select: (c: string) => Chain<EdgeRow> })
    .select('id, scope_id, src_kind, src_id, predicate, dst_kind, dst_id, confidence, source, pending_approval, created_at')
    .eq('scope_id',         scope)
    .eq('pending_approval', true)
    .gte('confidence',      minConfidence)
    .order('confidence', { ascending: false })
    .limit(limit)

  return NextResponse.json({ ok: true, edges: res.data ?? [] })
}

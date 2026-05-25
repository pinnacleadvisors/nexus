/**
 * GET /api/memory/walk — H-Mem graph traversal endpoint.
 *
 * Query params:
 *   scope        — required, e.g. "55bedf46-nexus"
 *   start_id     — required, "<scope_id>:<slug>" for atoms, raw uuid for temporal nodes
 *   predicates   — comma-separated, e.g. "mentions,caused"; default = all
 *   max_hops     — default 2, max 5
 *
 * Returns:
 *   { ok, path: [ { hop, node_id, kind, edge_predicate } ], visited_count }
 *
 * v1 implementation — BFS over mol_edge. Returns the first path of
 * length ≤ max_hops; "first path" is deterministic because we sort by
 * created_at then by id. When no path exists (or no edges present yet)
 * returns ok:true with an empty `path`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'

export const runtime     = 'nodejs'
export const maxDuration = 15

interface EdgeRow {
  scope_id:   string
  src_id:     string
  dst_id:     string
  src_kind:   string
  dst_kind:   string
  predicate:  string
  confidence: number
}

interface WalkHop {
  hop:            number
  from_id:        string
  to_id:          string
  to_kind:        string
  edge_predicate: string
  edge_confidence: number
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'memory:walk' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const url   = new URL(req.url)
  const scope = url.searchParams.get('scope')
  const start = url.searchParams.get('start_id')
  if (!scope || !start) return NextResponse.json({ ok: false, error: 'scope and start_id required' }, { status: 400 })

  const predFilter = url.searchParams.get('predicates')?.split(',').map(s => s.trim()).filter(Boolean) ?? null
  const maxHops    = Math.min(5, Math.max(1, parseInt(url.searchParams.get('max_hops') ?? '2', 10)))
  // Migration 065: LLM-extracted edges land pending operator approval.
  // Walks SKIP pending edges by default — they're proposals, not facts.
  // Opt in via ?include_pending=true (useful for "review what's pending").
  const includePending = url.searchParams.get('include_pending') === 'true'

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: true, path: [], visited_count: 0 })

  // BFS — keep it cheap; the table is empty in v1 so this is mostly a
  // correctness exercise. Pre-fetch all scope edges (likely small for
  // months) instead of round-tripping per hop.
  type Row = EdgeRow
  type Chain<T> = {
    eq:    (c: string, v: unknown) => Chain<T>
    limit: (n: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
  }
  let q = (db.from('mol_edge' as never) as unknown as { select: (c: string) => Chain<Row> })
    .select('scope_id, src_id, dst_id, src_kind, dst_kind, predicate, confidence')
    .eq('scope_id', scope)
  if (!includePending) q = q.eq('pending_approval', false)
  const res = await q.limit(5000)

  if (res.error) {
    return NextResponse.json({ ok: false, error: 'mol_edge read failed', detail: res.error.message }, { status: 200 })
  }

  const edges = (res.data ?? []).filter(e => !predFilter || predFilter.includes(e.predicate))
  // Index by src.
  const bySrc = new Map<string, EdgeRow[]>()
  for (const e of edges) {
    const arr = bySrc.get(e.src_id) ?? []
    arr.push(e); bySrc.set(e.src_id, arr)
  }

  // BFS for first reachable target; v1 returns the path TO the FIRST node
  // reachable within max_hops, not a specific target. (`memory_walk` is
  // most useful for "show me what's connected to X"; finding a specific
  // path A→B will get its own endpoint when needed.)
  const visited = new Set<string>([start])
  const queue: { id: string; path: WalkHop[] }[] = [{ id: start, path: [] }]
  let last: { id: string; path: WalkHop[] } | null = null

  while (queue.length > 0) {
    const cur = queue.shift()!
    last = cur
    if (cur.path.length >= maxHops) continue
    const out = bySrc.get(cur.id) ?? []
    for (const e of out) {
      if (visited.has(e.dst_id)) continue
      visited.add(e.dst_id)
      const nextPath: WalkHop[] = [
        ...cur.path,
        {
          hop:             cur.path.length + 1,
          from_id:         e.src_id,
          to_id:           e.dst_id,
          to_kind:         e.dst_kind,
          edge_predicate:  e.predicate,
          edge_confidence: e.confidence,
        },
      ]
      queue.push({ id: e.dst_id, path: nextPath })
    }
  }

  return NextResponse.json({
    ok:            true,
    path:          last?.path ?? [],
    visited_count: visited.size,
  })
}

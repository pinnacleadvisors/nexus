/**
 * POST/GET /api/cron/ecosystem-index (Akashic Thread A).
 *
 * Persists the structural ecosystem graph (agent→uses→tool, …) into mol_edge so
 * /api/memory/walk can traverse it — the queryable half of what /graph already
 * renders. Reads the live registries via buildEcosystemGraph(), maps each edge
 * to a `source='indexer'`, `pending_approval=false` mol_edge row (definitive —
 * not LLM-inferred, so no approval gate), and inserts the ones not already
 * present (dedup on src|dst|predicate).
 *
 * Auth: CRON_SECRET via `?secret=` (matches the hmem cron family; registered via
 * scripts/sync-crons-hmem.mjs). Retry-storm safe: always 200 (+{ok:false} on a
 * transient failure / before migration 101 widens the kind CHECK) — never 5xx.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { buildEcosystemGraph } from '@/lib/graph/ecosystem-index'
import { structuralIdFromNode } from '@/lib/graph/structural-id'

export const runtime     = 'nodejs'
export const maxDuration = 60

// Canonical scope-id for repo pinnacleadvisors/nexus (sha1 of the canonical
// scope JSON, truncated + human suffix) — same id the memory-hq graph uses.
const NEXUS_SCOPE = '55bedf46-nexus'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = new URL(req.url).searchParams.get('secret') ?? ''
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'db unavailable' })

  let graph: { nodes: unknown[]; edges: Array<{ source: string; target: string; relation: string }> }
  try {
    graph = await buildEcosystemGraph()
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'graph build failed' })
  }

  // Dedup against existing indexer edges for this scope.
  const seen = new Set<string>()
  try {
    const res = await (db.from('mol_edge' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ data: Array<{ src_id: string; dst_id: string; predicate: string }> | null; error: unknown }> } }
    }).select('src_id, dst_id, predicate').eq('scope_id', NEXUS_SCOPE).eq('source', 'indexer')
    for (const r of res.data ?? []) seen.add(`${r.src_id}|${r.dst_id}|${r.predicate}`)
  } catch {
    /* fail-soft — treat as none seen */
  }

  const newRows: Record<string, unknown>[] = []
  for (const e of graph.edges) {
    const src = structuralIdFromNode(e.source)
    const dst = structuralIdFromNode(e.target)
    const key = `${src}|${dst}|${e.relation}`
    if (seen.has(key)) continue
    seen.add(key)
    newRows.push({
      scope_id:         NEXUS_SCOPE,
      src_kind:         'structural',
      src_id:           src,
      predicate:        e.relation,
      dst_kind:         'structural',
      dst_id:           dst,
      confidence:       1.0,
      source:           'indexer',
      pending_approval: false,
    })
  }

  let inserted = 0
  if (newRows.length > 0) {
    try {
      const res = await (db.from('mol_edge' as never) as unknown as {
        insert: (rows: unknown[]) => Promise<{ error: { message: string } | null }>
      }).insert(newRows)
      if (res.error) {
        // Before migration 101 the kind/source CHECK rejects 'structural'/'indexer'.
        return NextResponse.json({ ok: false, error: res.error.message, edges_total: graph.edges.length, inserted: 0 })
      }
      inserted = newRows.length
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'insert failed' })
    }
  }

  return NextResponse.json({ ok: true, edges_total: graph.edges.length, inserted, skipped: graph.edges.length - inserted })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req)
}

/**
 * lib/molecular/hybrid.ts — E5
 *
 * Hybrid retrieval over molecular memory: combines the symbolic graph search
 * (`buildMemoryGraph` + `scoreNodeRelevance`) with QMD's BM25 + vector + LLM
 * re-rank pipeline via Reciprocal Rank Fusion. Auto-touches the top atoms so
 * the decay tier (E2) reflects what's actually being retrieved.
 *
 * Falls back to graph-only retrieval when QMD_ENABLED is unset or the sidecar
 * is unreachable. Never throws — failures are surfaced via `result.errors`.
 */

import path from 'node:path'
import { buildMemoryGraph } from '@/lib/graph/memory-builder'
import { scoreNodeRelevance } from '@/lib/graph/builder'
import type { GraphNode } from '@/lib/graph/types'
import { qmdQuery, type QmdHit } from './qmd-client'
import { touchAtomsByNodeIds } from './decay'

export type MolecularKind = 'atom' | 'entity' | 'moc' | 'source' | 'synthesis' | 'doc'

export interface HybridHit {
  /** `mem-<slug>` style identifier when the hit maps to a graph node, otherwise null. */
  nodeId:   string | null
  slug:     string
  kind:     MolecularKind
  title:    string
  /** RRF-fused score. Higher is better. */
  score:    number
  /** Which retrievers contributed to this hit. */
  sources:  Array<'graph' | 'qmd'>
  /** Per-source rank (1-based) — for debugging / explainability. */
  ranks:    Partial<Record<'graph' | 'qmd', number>>
  /** Repo-relative path, e.g. `memory/molecular/atoms/foo.md`. */
  path:     string
  /** Snippet emitted by QMD (when available). */
  snippet?: string
}

export interface HybridSearchResult {
  query:    string
  hits:     HybridHit[]
  used:     { graph: boolean; qmd: boolean }
  latency:  { graph: number; qmd: number; total: number }
  errors:   string[]
}

export interface HybridSearchOpts {
  /** Number of hits to return (default 12). */
  k?:         number
  /** Auto-bump accessCount on returned atoms (default true). */
  autoTouch?: boolean
  /** RRF constant — Cormack et al. recommend 60. */
  rrfK?:      number
  /** When true, only return hits that have a graph node (filters out QMD-only orphans). */
  graphOnly?: boolean
  /** Hard timeout for the QMD call. */
  qmdTimeoutMs?: number
}

const DEFAULT_K = 12
const DEFAULT_RRF_K = 60
const KIND_FROM_PREFIX: Record<string, MolecularKind> = {
  atoms:     'atom',
  entities:  'entity',
  mocs:      'moc',
  sources:   'source',
  synthesis: 'synthesis',
}

function kindFromPath(p: string): MolecularKind {
  const norm = p.replace(/\\/g, '/')
  for (const prefix of Object.keys(KIND_FROM_PREFIX)) {
    if (norm.includes(`molecular/${prefix}/`) || norm.startsWith(`${prefix}/`)) {
      return KIND_FROM_PREFIX[prefix]
    }
  }
  return 'doc'
}

function slugFromPath(p: string): string {
  return path.basename(p, '.md')
}

function nodeIdFromGraphNode(n: GraphNode): string {
  return n.id
}

function nodeIdFromQmdPath(p: string): string {
  // Mirrors the `mem-${meta.id}` rule in lib/graph/memory-builder.ts when an
  // atom has frontmatter `id:` — and atoms always do, since cli.mjs writes it.
  return `mem-${slugFromPath(p)}`
}

export async function hybridSearch(
  query: string,
  opts: HybridSearchOpts = {},
): Promise<HybridSearchResult> {
  const k        = Math.max(1, Math.min(opts.k ?? DEFAULT_K, 50))
  const rrfK     = opts.rrfK ?? DEFAULT_RRF_K
  const auto     = opts.autoTouch ?? true
  const errors: string[] = []
  const startedAt = Date.now()

  // ── Graph leg ──
  const graphStart = Date.now()
  let graphHits: Array<{ slug: string; nodeId: string; kind: MolecularKind; title: string; path: string; rank: number }> = []
  let graphUsed = false
  try {
    const graph = await buildMemoryGraph()
    if (graph && graph.nodes.length) {
      graphUsed = true
      const scored = graph.nodes
        .map(n => ({ n, s: scoreNodeRelevance(n, query) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, k * 2)
      graphHits = scored.map((x, i) => {
        const md = (x.n.metadata ?? {}) as Record<string, unknown>
        const filePath = typeof md.path === 'string' ? `memory/${md.path}` : ''
        const slug = (md.slug as string | undefined) ?? slugFromPath(filePath || x.n.id)
        return {
          slug,
          nodeId: nodeIdFromGraphNode(x.n),
          kind:   kindFromPath(filePath || x.n.type),
          title:  x.n.label,
          path:   filePath,
          rank:   i + 1,
        }
      })
    }
  } catch (e) {
    errors.push(`graph: ${e instanceof Error ? e.message : 'unknown'}`)
  }
  const graphLatency = Date.now() - graphStart

  // ── QMD leg ──
  const qmdStart = Date.now()
  const qmd = await qmdQuery(query, { k: k * 2, timeoutMs: opts.qmdTimeoutMs })
  if (qmd.error) errors.push(`qmd: ${qmd.error}`)
  const qmdHits = (qmd.hits ?? []).map((h: QmdHit, i: number) => {
    const norm = h.path.replace(/\\/g, '/')
    const slug = slugFromPath(norm)
    return {
      slug,
      kind:    kindFromPath(norm),
      title:   h.title || slug,
      path:    norm.startsWith('memory/') ? norm : `memory/molecular/${norm}`,
      rank:    i + 1,
      snippet: h.snippet,
    }
  })
  const qmdLatency = Date.now() - qmdStart

  // ── RRF fusion ──
  const fused = new Map<string, HybridHit>()
  function fuse(slug: string, src: 'graph' | 'qmd', rank: number, draft: Partial<HybridHit>) {
    const key = slug
    const inc = 1 / (rrfK + rank)
    const existing = fused.get(key)
    if (existing) {
      existing.score   += inc
      existing.sources.push(src)
      existing.ranks[src] = rank
      if (!existing.snippet && draft.snippet) existing.snippet = draft.snippet
      if (!existing.title && draft.title)     existing.title   = draft.title
      if (!existing.path && draft.path)        existing.path    = draft.path
      if (!existing.nodeId && draft.nodeId)    existing.nodeId  = draft.nodeId
    } else {
      fused.set(key, {
        nodeId:  draft.nodeId ?? null,
        slug,
        kind:    (draft.kind ?? 'doc') as MolecularKind,
        title:   draft.title ?? slug,
        score:   inc,
        sources: [src],
        ranks:   { [src]: rank },
        path:    draft.path ?? '',
        snippet: draft.snippet,
      })
    }
  }

  for (const g of graphHits) {
    fuse(g.slug, 'graph', g.rank, {
      nodeId: g.nodeId,
      kind:   g.kind,
      title:  g.title,
      path:   g.path,
    })
  }
  for (const q of qmdHits) {
    fuse(q.slug, 'qmd', q.rank, {
      nodeId:  nodeIdFromQmdPath(q.path),
      kind:    q.kind,
      title:   q.title,
      path:    q.path,
      snippet: q.snippet,
    })
  }

  let hits = [...fused.values()].sort((a, b) => b.score - a.score)
  if (opts.graphOnly) hits = hits.filter(h => h.sources.includes('graph'))
  hits = hits.slice(0, k)

  // ── Auto-touch ──
  if (auto) {
    const atomNodeIds = hits
      .filter(h => h.kind === 'atom' && h.nodeId)
      .map(h => h.nodeId!) as string[]
    if (atomNodeIds.length) void touchAtomsByNodeIds(atomNodeIds).catch(() => undefined)
  }

  return {
    query,
    hits,
    used:    { graph: graphUsed, qmd: qmd.enabled },
    latency: { graph: graphLatency, qmd: qmdLatency, total: Date.now() - startedAt },
    errors,
  }
}

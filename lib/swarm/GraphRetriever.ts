/**
 * lib/swarm/GraphRetriever.ts — A7
 *
 * Graph-keyed context retrieval for the Queen. Instead of shipping the full
 * prior-results blob into every Claude call, we extract keywords from the goal,
 * rank nodes in the knowledge graph, and emit a compact preamble of the top-N
 * atoms + entity summaries.
 *
 * When the graph returns nothing (cold start, fresh project) the caller should
 * fall back to `buildSwarmContext` — this module signals that via `hit:false`.
 *
 * Budget: 12 000 tokens hard cap on retrieved context (approximated as chars/4).
 */

import { buildGraph, scoreNodeRelevance } from '@/lib/graph/builder'
import type { GraphNode } from '@/lib/graph/types'
import { approxTokens } from './TokenOptimiser'
import { touchAtomsByNodeIds } from '@/lib/molecular/decay'

const MAX_CONTEXT_TOKENS  = 12_000
const MAX_NODES           = 24
const MEMORY_TYPES        = new Set(['memory_atom', 'memory_entity', 'memory_moc'])

// ── Stop-word list for keyword extraction ────────────────────────────────────
const STOP = new Set([
  'the','a','an','is','are','was','were','be','been','being','to','of','in','on',
  'at','for','with','and','or','but','if','as','by','from','that','this','these',
  'those','it','its','we','our','you','your','i','me','my','do','does','did','done',
  'have','has','had','will','would','should','could','can','may','might','must',
  'not','no','so','up','out','into','over','under','about','than','then','also',
  'some','any','all','many','much','more','most','less','each','every','other',
])

export function extractKeywords(goal: string, roleHint?: string): string[] {
  const raw = `${goal} ${roleHint ?? ''}`.toLowerCase()
  const words = raw
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w))
  // Deduplicate preserving order, take top 12
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words) {
    if (seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= 12) break
  }
  return out
}

function nodeSummary(n: GraphNode): string {
  const md = n.metadata ?? {}
  const ex = (md as Record<string, unknown>).excerpt
  const bl = (md as Record<string, unknown>).blurb
  const de = (md as Record<string, unknown>).description
  const snippet = typeof ex === 'string' ? ex
                : typeof bl === 'string' ? bl
                : typeof de === 'string' ? de
                : ''
  const clean = snippet.replace(/\s+/g, ' ').trim().slice(0, 400)
  return `- **[${n.type}] ${n.label}**${clean ? `: ${clean}` : ''}`
}

export interface GraphRetrievalResult {
  /** Retrieved preamble, ready to prepend to the model prompt. Empty string when `hit:false`. */
  text:     string
  /** Node IDs touched — emit on a `graph.retrieved` RunEvent for observability. */
  nodeIds:  string[]
  /** True when retrieval found usable nodes. False → caller should fall back to buildSwarmContext. */
  hit:      boolean
  /** Approximate tokens the preamble consumes. */
  tokens:   number
}

/**
 * Retrieve the top-N graph nodes relevant to the goal + role, clip to the token
 * budget, and return a preamble plus node IDs for observability.
 */
export async function retrieveGraphContext(
  goal:      string,
  roleHint?: string,
): Promise<GraphRetrievalResult> {
  const keywords = extractKeywords(goal, roleHint)
  if (keywords.length === 0) {
    return { text: '', nodeIds: [], hit: false, tokens: 0 }
  }

  const query = keywords.join(' ')
  const graph = await buildGraph().catch(() => null)
  if (!graph || graph.nodes.length === 0) {
    return { text: '', nodeIds: [], hit: false, tokens: 0 }
  }

  const scored = graph.nodes
    .map(n => ({ node: n, score: scoreNodeRelevance(n, query) }))
    .filter(s => s.score > 0)
    // Prefer memory-* nodes (atoms, entities, MOCs) — they carry domain knowledge,
    // whereas code / project / agent nodes rarely belong in a Queen preamble.
    .sort((a, b) => {
      const aMem = MEMORY_TYPES.has(a.node.type) ? 1 : 0
      const bMem = MEMORY_TYPES.has(b.node.type) ? 1 : 0
      if (aMem !== bMem) return bMem - aMem
      return b.score - a.score
    })
    .slice(0, MAX_NODES)

  if (scored.length === 0) {
    return { text: '', nodeIds: [], hit: false, tokens: 0 }
  }

  // Build preamble, clipping on token budget
  const lines: string[] = [
    `## Relevant prior knowledge (graph-retrieved)`,
    ``,
    `_These entries were pulled from the Nexus knowledge graph by keyword match against the goal. Use them to avoid re-researching and to cross-reference decisions. Do not treat them as ground truth — verify against sources when critical._`,
    ``,
  ]
  const nodeIds: string[] = []
  let tokens = approxTokens(lines.join('\n'))

  for (const { node } of scored) {
    const line = nodeSummary(node)
    const added = approxTokens(line) + 1
    if (tokens + added > MAX_CONTEXT_TOKENS) break
    lines.push(line)
    nodeIds.push(node.id)
    tokens += added
  }

  if (nodeIds.length === 0) {
    return { text: '', nodeIds: [], hit: false, tokens: 0 }
  }

  // Fire-and-forget atom decay bump (Felixcraft hot/warm/cold tiering — E3).
  // Filter to memory_atom IDs; entities and MOCs are not bumped here.
  const atomNodeIds = scored
    .filter(s => s.node.type === 'memory_atom' && nodeIds.includes(s.node.id))
    .map(s => s.node.id)
  if (atomNodeIds.length > 0) {
    void touchAtomsByNodeIds(atomNodeIds).catch(() => undefined)
  }

  return { text: lines.join('\n'), nodeIds, hit: true, tokens }
}

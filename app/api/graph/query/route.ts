/**
 * POST /api/graph/query
 * Natural language graph query — returns a ranked subgraph of relevant nodes.
 *
 * Body: { query: string; limit?: number }
 * Returns: { nodes: GraphNode[]; edges: GraphEdge[]; explanation: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildGraph, scoreNodeRelevance } from '@/lib/graph/builder'
import type { GraphEdge } from '@/lib/graph/types'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json() as { query?: string; limit?: number }
  if (!body.query?.trim()) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }

  const graph   = await buildGraph()
  const limit   = Math.min(body.limit ?? 20, 50)
  const query   = body.query.trim()

  // Score all nodes
  const scored = graph.nodes
    .map(n => ({ node: n, score: scoreNodeRelevance(n, query) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  const nodeIds  = new Set(scored.map(s => s.node.id))
  const nodes    = scored.map(s => s.node)
  const edges: GraphEdge[] = graph.edges.filter(
    e => nodeIds.has(e.source) && nodeIds.has(e.target),
  )

  const topTypes = [...new Set(nodes.slice(0, 5).map(n => n.type))].join(', ')
  const explanation = nodes.length > 0
    ? `Found ${nodes.length} relevant node(s) for "${query}". Top types: ${topTypes}.`
    : `No nodes matched "${query}".`

  return NextResponse.json({ nodes, edges, explanation, query })
}

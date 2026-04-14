/**
 * POST /api/graph/context
 *
 * Agent Context API — Phase 14
 *
 * Given a task description, returns a minimal subgraph of the most relevant
 * nodes so agents can understand the full relational context before starting
 * work — without scanning every file.
 *
 * Inspired by Graphify's 71× token reduction: instead of scanning raw files,
 * agents call this endpoint and receive a pre-computed relational subgraph.
 *
 * Body:
 *   { task: string; maxNodes?: number }
 *
 * Response:
 *   { nodes: GraphNode[]; edges: GraphEdge[]; summary: string; tokenEstimate: number }
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildGraph, getNodeNeighbourhood, scoreNodeRelevance } from '@/lib/graph/builder'
import type { GraphNode, GraphEdge } from '@/lib/graph/types'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json() as { task?: string; maxNodes?: number }

  if (!body.task?.trim()) {
    return NextResponse.json({ error: 'task is required' }, { status: 400 })
  }

  const graph    = await buildGraph()
  const maxNodes = Math.min(body.maxNodes ?? 20, 50)
  const task     = body.task.trim()

  // Find anchor nodes (highest relevance)
  const scored = graph.nodes
    .map(n => ({ node: n, score: scoreNodeRelevance(n, task) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)

  const anchors     = scored.slice(0, 3).map(s => s.node)
  const nodeIds     = new Set<string>(anchors.map(n => n.id))
  const subgraphEdges: GraphEdge[] = []

  // Expand 1 hop from each anchor
  for (const anchor of anchors) {
    const { neighbours, edges } = getNodeNeighbourhood(graph, anchor.id, 1)
    for (const n of neighbours) {
      if (nodeIds.size < maxNodes) nodeIds.add(n.id)
    }
    for (const e of edges) subgraphEdges.push(e)
  }

  const subgraphNodes: GraphNode[] = graph.nodes.filter(n => nodeIds.has(n.id))
  const uniqueEdges = subgraphEdges.filter(
    (e, i, arr) => arr.findIndex(x => x.id === e.id) === i &&
      nodeIds.has(e.source) && nodeIds.has(e.target),
  )

  // Rough token estimate: ~20 tokens per node summary line
  const tokenEstimate = subgraphNodes.length * 20 + uniqueEdges.length * 10

  const typeBreakdown = Object.entries(
    subgraphNodes.reduce<Record<string, number>>((acc, n) => {
      acc[n.type] = (acc[n.type] ?? 0) + 1; return acc
    }, {}),
  ).map(([t, c]) => `${c} ${t}(s)`).join(', ')

  const summary = [
    `Task: ${task}`,
    `Relevant context: ${subgraphNodes.length} nodes (${typeBreakdown}), ${uniqueEdges.length} relationships.`,
    anchors.length > 0
      ? `Anchor nodes: ${anchors.map(n => `${n.label} [${n.type}]`).join(', ')}.`
      : 'No high-confidence anchors found.',
  ].join(' ')

  return NextResponse.json({
    nodes:         subgraphNodes,
    edges:         uniqueEdges,
    summary,
    tokenEstimate,
    anchorNodeIds: anchors.map(n => n.id),
  })
}

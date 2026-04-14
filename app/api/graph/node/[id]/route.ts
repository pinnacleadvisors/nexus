/**
 * GET /api/graph/node/:id
 * Returns a single node plus its 1-hop neighbourhood.
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildGraph, getNodeNeighbourhood } from '@/lib/graph/builder'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id }  = await params
  const graph   = await buildGraph()
  const result  = getNodeNeighbourhood(graph, id, 1)

  if (!result.node) {
    return NextResponse.json({ error: `Node "${id}" not found` }, { status: 404 })
  }

  return NextResponse.json({
    node:        result.node,
    neighbours:  result.neighbours,
    edges:       result.edges,
  })
}

/**
 * GET /api/graph/path?from=<nodeId>&to=<nodeId>
 * Returns the shortest path between two nodes (BFS).
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildGraph, findShortestPath } from '@/lib/graph/builder'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get('from')
  const to   = req.nextUrl.searchParams.get('to')

  if (!from || !to) {
    return NextResponse.json({ error: '"from" and "to" query params are required' }, { status: 400 })
  }

  const graph  = await buildGraph()
  const result = findShortestPath(graph, from, to)

  if (result.path.length === 0) {
    return NextResponse.json({ error: `No path found between "${from}" and "${to}"` }, { status: 404 })
  }

  return NextResponse.json({
    path:   result.path,
    edges:  result.edges,
    hops:   result.path.length - 1,
  })
}

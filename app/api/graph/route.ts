/**
 * GET /api/graph
 * Returns the full serialised knowledge graph.
 * Cached for 60 s server-side; forced rebuild with ?rebuild=1
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildGraph } from '@/lib/graph/builder'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const rebuild = req.nextUrl.searchParams.get('rebuild') === '1'
  const graph   = await buildGraph(rebuild)
  return NextResponse.json(graph, {
    headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
  })
}

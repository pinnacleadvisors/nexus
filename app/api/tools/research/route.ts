/**
 * GET /api/tools/research
 *
 * Queries the curated tool database and returns a compatibility matrix.
 *
 * Query params:
 *   q        — keyword search (optional)
 *   category — filter by category (optional)
 *   n8n_only — 'true' to return only tools with n8n nodes (optional)
 *
 * Response: { tools: ToolEntry[], categories: string[], total: number }
 */

import { NextRequest } from 'next/server'
import {
  TOOLS_DATABASE,
  TOOL_CATEGORIES,
  searchTools,
  getToolsByCategory,
  getN8nCompatibleTools,
} from '@/lib/n8n/tools-db'
import type { ToolEntry } from '@/lib/n8n/types'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q       = searchParams.get('q')?.trim()
  const cat     = searchParams.get('category')?.trim()
  const n8nOnly = searchParams.get('n8n_only') === 'true'

  let tools: ToolEntry[] = TOOLS_DATABASE

  if (q)       tools = searchTools(q)
  if (cat)     tools = getToolsByCategory(cat)
  if (n8nOnly) tools = getN8nCompatibleTools()

  // If multiple filters, intersect
  if (q && cat) {
    tools = searchTools(q).filter(t => t.category.toLowerCase() === cat.toLowerCase())
  }
  if (n8nOnly) {
    tools = tools.filter(t => t.n8nNodes.length > 0)
  }

  return new Response(
    JSON.stringify({
      tools,
      categories: TOOL_CATEGORIES,
      total: tools.length,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

/**
 * GET  /api/graph/mcp          — MCP manifest
 * POST /api/graph/mcp/:tool    — Tool invocation
 *
 * Exposes the knowledge graph as an MCP tool so OpenClaw and Claude Code
 * can call `get_graph_context` natively before starting any task.
 *
 * Usage (Claude Code):
 *   claude mcp add nexus-graph <your-vercel-url>/api/graph/mcp/manifest
 *
 * Available tools:
 *   get_graph_context(task_description, max_nodes?) → subgraph JSON
 *   query_graph(query, limit?)                      → ranked nodes
 *   get_node(node_id)                               → node + neighbours
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildGraph, getNodeNeighbourhood, scoreNodeRelevance } from '@/lib/graph/builder'
import type { McpToolDefinition } from '@/lib/graph/types'

export const runtime = 'nodejs'

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: McpToolDefinition[] = [
  {
    name:        'get_graph_context',
    description: 'Returns a minimal subgraph of the most relevant nodes for a given task description. Use this before starting any agent task to understand the full relational context — businesses, projects, milestones, agents, tools, and workflows — without scanning raw files. Target: 50–70x token reduction vs file scanning.',
    inputSchema: {
      type: 'object',
      properties: {
        task_description: { type: 'string', description: 'What you are about to do (task, goal, or question)' },
        max_nodes:        { type: 'number', description: 'Max nodes to return (default 20, max 50)' },
      },
      required: ['task_description'],
    },
  },
  {
    name:        'query_graph',
    description: 'Runs a keyword-based search across the knowledge graph and returns ranked matching nodes with their edges.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['query'],
    },
  },
  {
    name:        'get_node',
    description: 'Returns a specific node and its 1-hop neighbourhood (direct relationships).',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Node ID (e.g. "biz-1", "agent-1")' },
      },
      required: ['node_id'],
    },
  },
]

// ── GET — manifest ────────────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    schema_version: 'v1',
    name_for_human: 'Nexus Knowledge Graph',
    name_for_model: 'nexus_graph',
    description_for_human: 'Query the Nexus relational knowledge graph — businesses, projects, agents, tools, and workflows.',
    description_for_model: 'Query the Nexus knowledge graph to get relational context before starting tasks. Returns node subgraphs, shortest paths, and context-relevant subgraphs.',
    api:   { type: 'openapi', url: '/api/graph/mcp/openapi.json' },
    tools: TOOLS,
  })
}

// ── POST — tool invocation ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json() as { tool: string; input: Record<string, unknown> }
  const graph = await buildGraph()

  if (body.tool === 'get_graph_context') {
    const task     = String(body.input.task_description ?? '')
    const maxNodes = Math.min(Number(body.input.max_nodes ?? 20), 50)

    const scored = graph.nodes
      .map(n => ({ node: n, score: scoreNodeRelevance(n, task) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)

    const anchors  = scored.slice(0, 3).map(s => s.node)
    const nodeIds  = new Set<string>(anchors.map(n => n.id))

    for (const anchor of anchors) {
      const { neighbours } = getNodeNeighbourhood(graph, anchor.id, 1)
      for (const n of neighbours) if (nodeIds.size < maxNodes) nodeIds.add(n.id)
    }

    const nodes = graph.nodes.filter(n => nodeIds.has(n.id))
    const edges = graph.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))

    return NextResponse.json({
      nodes,
      edges,
      summary:       `${nodes.length} nodes, ${edges.length} edges for task: "${task}"`,
      tokenEstimate: nodes.length * 20 + edges.length * 10,
    })
  }

  if (body.tool === 'query_graph') {
    const query = String(body.input.query ?? '')
    const limit = Math.min(Number(body.input.limit ?? 20), 50)

    const scored = graph.nodes
      .map(n => ({ node: n, score: scoreNodeRelevance(n, query) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    const nodeIds = new Set(scored.map(s => s.node.id))
    const edges   = graph.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))

    return NextResponse.json({ nodes: scored.map(s => s.node), edges })
  }

  if (body.tool === 'get_node') {
    const id     = String(body.input.node_id ?? '')
    const result = getNodeNeighbourhood(graph, id, 1)
    if (!result.node) return NextResponse.json({ error: `Node "${id}" not found` }, { status: 404 })
    return NextResponse.json({ node: result.node, neighbours: result.neighbours, edges: result.edges })
  }

  return NextResponse.json({ error: `Unknown tool: ${body.tool}` }, { status: 400 })
}

/**
 * POST /api/swarm/mcp/:tool
 *
 * MCP tool endpoint — handles tool calls from OpenClaw / Claude Code.
 * Returns JSON responses compatible with the MCP tool-result format.
 */

import { NextRequest } from 'next/server'
import { AGENT_REGISTRY, findAgentByTags } from '@/lib/swarm/agents/registry'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tool: string }> },
) {
  const { tool } = await params

  // Manifest endpoint
  if (tool === 'manifest') {
    const { getMcpManifest } = await import('@/lib/swarm/mcp')
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    return new Response(JSON.stringify(getMcpManifest(baseUrl)), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ error: 'Use POST for tool calls.' }), { status: 405 })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tool: string }> },
) {
  const { tool } = await params
  const body = await req.json() as Record<string, unknown>

  switch (tool) {
    case 'create_swarm': {
      // Proxy to the dispatch endpoint
      const dispatchUrl = `${req.nextUrl.origin}/api/swarm/dispatch`
      const res = await fetch(dispatchUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', cookie: req.headers.get('cookie') ?? '' },
        body:    JSON.stringify(body),
      })
      const swarmId = res.headers.get('X-Swarm-Id') ?? 'unknown'
      // Collect first event from stream
      const reader  = res.body?.getReader()
      const decoder = new TextDecoder()
      let firstEvent: Record<string, unknown> = {}
      if (reader) {
        const { value } = await reader.read()
        const line = decoder.decode(value).replace('data: ', '').trim()
        try { firstEvent = JSON.parse(line) as Record<string, unknown> } catch { /* ignore */ }
        reader.cancel()
      }
      return new Response(JSON.stringify({
        success: true,
        swarmId,
        message: `Swarm started. Use get_swarm_status(${swarmId}) to poll progress.`,
        firstEvent,
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    case 'get_swarm_status': {
      const swarmId = String(body.swarmId ?? '')
      if (!swarmId) return badRequest('swarmId required')

      const db = createServerClient()
      if (!db) return new Response(JSON.stringify({ error: 'Database not configured.' }), { status: 503 })

      const [runRes, tasksRes] = await Promise.all([
        db.from('swarm_runs').select('*').eq('id', swarmId).single(),
        db.from('swarm_tasks').select('*').eq('swarm_id', swarmId).order('phase'),
      ])

      return new Response(JSON.stringify({
        run:   runRes.data,
        tasks: tasksRes.data ?? [],
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    case 'abort_swarm': {
      const swarmId = String(body.swarmId ?? '')
      if (!swarmId) return badRequest('swarmId required')
      const abortUrl = `${req.nextUrl.origin}/api/swarm/${swarmId}`
      const res = await fetch(abortUrl, {
        method:  'DELETE',
        headers: { cookie: req.headers.get('cookie') ?? '' },
      })
      return new Response(await res.text(), {
        status:  res.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    case 'list_agents': {
      const filter = body.filter ? String(body.filter).toLowerCase() : ''
      const agents = filter
        ? AGENT_REGISTRY.filter(a =>
            a.tags.some(t => t.includes(filter)) ||
            a.name.toLowerCase().includes(filter) ||
            a.description.toLowerCase().includes(filter)
          )
        : AGENT_REGISTRY
      return new Response(JSON.stringify(
        agents.map(a => ({ role: a.role, name: a.name, description: a.description, model: a.preferredModel, tags: a.tags }))
      ), { headers: { 'Content-Type': 'application/json' } })
    }

    default:
      return new Response(JSON.stringify({ error: `Unknown tool: ${tool}` }), { status: 404 })
  }
}

function badRequest(msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * app/api/org/route.ts
 * GET /api/org — returns the full agent hierarchy tree + stats.
 * Supabase-first; falls back to mock data when DB is not configured.
 */

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { buildMockTree, buildMockSwimlanes } from '@/lib/org/mock-data'
import type { OrgAgent, OrgTree, OrgStats, AgentLayer, AgentStatus } from '@/lib/org/types'

export const revalidate = 10   // ISR: revalidate every 10 seconds

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (url && key) {
    try {
      const { createClient } = await import('@supabase/supabase-js')
      const db = createClient(url, key)

      // Fetch agents with recent actions
      const { data: agentsRaw } = await db
        .from('agents')
        .select('*, agent_actions(id, action, description, tokens_used, created_at)')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(200)

      if (agentsRaw && agentsRaw.length > 0) {
        const agents = agentsRaw as (OrgAgent & { agent_actions: OrgAgent['recent_actions'] })[]

        const byId: Record<string, OrgAgent> = {}
        for (const a of agents) {
          byId[a.id] = { ...a, recent_actions: a.agent_actions ?? [], children: [] }
        }

        for (const a of agents) {
          if (a.parent_agent_id && byId[a.parent_agent_id]) {
            byId[a.parent_agent_id].children!.push(byId[a.id])
          }
        }

        const root = Object.values(byId).find(a => !a.parent_agent_id) ?? Object.values(byId)[0]

        const byLayer = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 } as Record<AgentLayer, number>
        const byStatus = { idle: 0, running: 0, error: 0, completed: 0, terminated: 0 } as Record<AgentStatus, number>
        let totalTokens = 0; let totalCost = 0

        for (const a of agents) {
          byLayer[a.layer as AgentLayer]++
          byStatus[a.status as AgentStatus]++
          totalTokens += a.tokens_used ?? 0
          totalCost   += Number(a.cost_usd ?? 0)
        }

        const swarms = [...new Set(agents.map(a => a.swarm_id).filter(Boolean))] as string[]
        const stats: OrgStats = {
          total: agents.length, byLayer, byStatus, totalTokens, totalCost,
          activeSwarms: swarms.filter(s =>
            agents.some(a => a.swarm_id === s && a.status === 'running'),
          ).length,
        }

        const tree: OrgTree = { root, agents, byId, swarms, stats }
        const swimlanes = buildSwimlanes(agents)
        return NextResponse.json({ tree, swimlanes })
      }
    } catch (err) {
      console.error('[api/org] Supabase error — using mock data:', err)
    }
  }

  // Mock fallback
  const tree      = buildMockTree()
  const swimlanes = buildMockSwimlanes()
  return NextResponse.json({ tree, swimlanes })
}

function buildSwimlanes(agents: OrgAgent[]) {
  const map: Record<string, { id: string; label: string; agents: OrgAgent[] }> = {}
  for (const a of agents) {
    const key   = a.business_id ?? 'unassigned'
    const label = key === 'unassigned' ? 'Platform / Global' : key
    if (!map[key]) map[key] = { id: key, label, agents: [] }
    map[key].agents.push(a)
  }
  return Object.values(map).filter(s => s.agents.length > 0)
}

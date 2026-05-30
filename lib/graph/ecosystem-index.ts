/**
 * lib/graph/ecosystem-index.ts — Akashic structural index.
 *
 * Builds a structural graph of the agent ecosystem — agents, the tools each
 * one uses, and the installed skills — read from `.claude/` at request time.
 * Merged into the /graph view by lib/graph/builder.ts so the operator sees the
 * real platform structure (loop-runner, eng-builder, …) alongside the memory
 * knowledge graph, instead of only memory atoms.
 *
 * Fail-soft: a filesystem read error yields an empty partition rather than
 * breaking the whole graph.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { listAgents } from '@/lib/agents/registry'
import type { GraphNode, GraphEdge } from './types'

export interface EcosystemGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function pos(): { x: number; y: number; z: number } {
  return { x: (Math.random() - 0.5) * 120, y: (Math.random() - 0.5) * 120, z: (Math.random() - 0.5) * 120 }
}
function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}
const now = (): string => new Date().toISOString()

export async function buildEcosystemGraph(): Promise<EcosystemGraph> {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const toolSeen = new Set<string>()

  // Agents + the tools they use (agent → uses → tool).
  try {
    const agents = await listAgents()
    for (const a of agents) {
      const agentId = `agent:${a.slug}`
      nodes.push({
        id: agentId, type: 'agent', label: a.slug,
        metadata: { source: 'ecosystem', name: a.name, model: a.model, description: a.description.slice(0, 160) },
        position3d: pos(), clusterId: 0, pageRank: 0, connections: 0, createdAt: now(),
      })
      for (const tool of a.tools) {
        const toolId = `tool:${tool}`
        if (!toolSeen.has(tool)) {
          toolSeen.add(tool)
          nodes.push({
            id: toolId, type: 'tool', label: tool, metadata: { source: 'ecosystem' },
            position3d: pos(), clusterId: 0, pageRank: 0, connections: 0, createdAt: now(),
          })
        }
        edges.push({ id: uid(), source: agentId, target: toolId, relation: 'uses', weight: 0.6, createdAt: now() })
      }
    }
  } catch (err) {
    console.warn('[ecosystem-index] agents read failed:', err instanceof Error ? err.message : err)
  }

  // Skills — one node per `.claude/skills/<name>/SKILL.md`.
  try {
    const skillsDir = path.join(process.cwd(), '.claude', 'skills')
    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      try { await fs.access(path.join(skillsDir, e.name, 'SKILL.md')) } catch { continue }
      nodes.push({
        id: `skill:${e.name}`, type: 'skill', label: e.name, metadata: { source: 'ecosystem' },
        position3d: pos(), clusterId: 0, pageRank: 0, connections: 0, createdAt: now(),
      })
    }
  } catch (err) {
    console.warn('[ecosystem-index] skills read failed:', err instanceof Error ? err.message : err)
  }

  return { nodes, edges }
}

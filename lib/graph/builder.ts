/**
 * lib/graph/builder.ts
 *
 * Builds an in-memory GraphData from Supabase (when configured) or
 * falls back to rich mock data. Assigns 3D positions via a simple
 * force-directed spring simulation and detects clusters via Louvain
 * community detection (graphology-communities-louvain).
 */

import Graph from 'graphology'
import louvain from 'graphology-communities-louvain'
import { createServerClient } from '@/lib/supabase'
import type { GraphData, GraphNode, GraphEdge, NodeType, EdgeRelation } from './types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function iso(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString()
}

// ── Force-directed layout (simplified, server-side) ───────────────────────────
// Runs a fixed number of iterations to spread nodes in 3D space without
// needing a browser or WebGL context.

interface Vec3 { x: number; y: number; z: number }

function runForceLayout(
  nodes: Array<{ id: string; position3d: Vec3 }>,
  edges: Array<{ source: string; target: string }>,
  iterations = 80,
): void {
  const posMap = new Map<string, Vec3>()
  for (const n of nodes) posMap.set(n.id, { ...n.position3d })

  const REPULSION  = 6000
  const ATTRACTION = 0.08
  const DAMPING    = 0.85
  const velMap     = new Map<string, Vec3>()
  for (const n of nodes) velMap.set(n.id, { x: 0, y: 0, z: 0 })

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const pi = posMap.get(nodes[i].id)!
        const pj = posMap.get(nodes[j].id)!
        const dx = pi.x - pj.x, dy = pi.y - pj.y, dz = pi.z - pj.z
        const dist2 = Math.max(1, dx * dx + dy * dy + dz * dz)
        const force  = REPULSION / dist2
        const dist   = Math.sqrt(dist2)
        const vi = velMap.get(nodes[i].id)!
        const vj = velMap.get(nodes[j].id)!
        vi.x += (dx / dist) * force; vi.y += (dy / dist) * force; vi.z += (dz / dist) * force
        vj.x -= (dx / dist) * force; vj.y -= (dy / dist) * force; vj.z -= (dz / dist) * force
      }
    }
    // Attraction along edges
    for (const e of edges) {
      const ps = posMap.get(e.source), pt = posMap.get(e.target)
      if (!ps || !pt) continue
      const dx = pt.x - ps.x, dy = pt.y - ps.y, dz = pt.z - ps.z
      const vs = velMap.get(e.source)!, vt = velMap.get(e.target)!
      vs.x += dx * ATTRACTION; vs.y += dy * ATTRACTION; vs.z += dz * ATTRACTION
      vt.x -= dx * ATTRACTION; vt.y -= dy * ATTRACTION; vt.z -= dz * ATTRACTION
    }
    // Apply velocity + damping
    for (const n of nodes) {
      const p = posMap.get(n.id)!
      const v = velMap.get(n.id)!
      p.x += v.x; p.y += v.y; p.z += v.z
      v.x *= DAMPING; v.y *= DAMPING; v.z *= DAMPING
    }
  }

  // Write back
  for (const n of nodes) {
    const p = posMap.get(n.id)!
    n.position3d.x = p.x
    n.position3d.y = p.y
    n.position3d.z = p.z
  }
}

// ── Louvain cluster assignment ────────────────────────────────────────────────

function assignClusters(
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  if (nodes.length === 0) return
  const g = new Graph({ type: 'undirected' })
  for (const n of nodes) g.addNode(n.id)
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      try { g.addEdge(e.source, e.target) } catch { /* duplicate edge */ }
    }
  }
  const communities = louvain(g)
  for (const n of nodes) {
    n.clusterId = communities[n.id] ?? 0
  }
}

// ── PageRank (simple power iteration) ────────────────────────────────────────

function assignPageRank(nodes: GraphNode[], edges: GraphEdge[]): void {
  const N    = nodes.length
  if (N === 0) return
  const d    = 0.85
  const ids  = nodes.map(n => n.id)
  const idxOf = new Map<string, number>(ids.map((id, i) => [id, i]))

  // Build adjacency
  const out: number[][] = Array.from({ length: N }, () => [])
  for (const e of edges) {
    const si = idxOf.get(e.source), ti = idxOf.get(e.target)
    if (si !== undefined && ti !== undefined) out[si].push(ti)
  }

  let pr = new Array<number>(N).fill(1 / N)
  for (let iter = 0; iter < 30; iter++) {
    const next = new Array<number>(N).fill((1 - d) / N)
    for (let i = 0; i < N; i++) {
      const share = out[i].length > 0 ? (d * pr[i]) / out[i].length : 0
      for (const j of out[i]) next[j] += share
    }
    pr = next
  }

  const max = Math.max(...pr)
  for (let i = 0; i < N; i++) {
    nodes[i].pageRank = max > 0 ? pr[i] / max : 0
  }
}

// ── Mock data ─────────────────────────────────────────────────────────────────

function buildMockGraph(): GraphData {
  const makeNode = (
    id: string,
    type: NodeType,
    label: string,
    meta: Record<string, unknown> = {},
    daysAgo = 0,
  ): GraphNode => ({
    id,
    type,
    label,
    metadata:   meta,
    position3d: {
      x: (Math.random() - 0.5) * 120,
      y: (Math.random() - 0.5) * 120,
      z: (Math.random() - 0.5) * 120,
    },
    clusterId:   0,
    pageRank:    0,
    connections: 0,
    createdAt:   iso(daysAgo),
  })

  const makeEdge = (
    source: string,
    target: string,
    relation: EdgeRelation,
    weight = 0.7,
  ): GraphEdge => ({
    id:        uid(),
    source,
    target,
    relation,
    weight,
    createdAt: iso(Math.floor(Math.random() * 30)),
  })

  const nodes: GraphNode[] = [
    // Businesses
    makeNode('biz-1', 'business', 'Acme SaaS', { industry: 'B2B SaaS', arr: '$120k' }, 90),
    makeNode('biz-2', 'business', 'RetailBrand Co', { industry: 'eCommerce' }, 60),

    // Projects
    makeNode('proj-1', 'project', 'Landing Page Redesign', { status: 'in-progress' }, 45),
    makeNode('proj-2', 'project', 'Email Automation', { status: 'review' }, 30),
    makeNode('proj-3', 'project', 'Competitor Analysis', { status: 'completed' }, 20),
    makeNode('proj-4', 'project', 'Social Media Campaign', { status: 'backlog' }, 10),

    // Milestones
    makeNode('ms-1', 'milestone', 'Design mockups', { phase: 1, status: 'done' }, 40),
    makeNode('ms-2', 'milestone', 'Copywriting', { phase: 1, status: 'done' }, 35),
    makeNode('ms-3', 'milestone', 'A/B test setup', { phase: 2, status: 'in-progress' }, 15),
    makeNode('ms-4', 'milestone', 'Launch email sequence', { phase: 1, status: 'pending' }, 25),
    makeNode('ms-5', 'milestone', 'Write research report', { phase: 1, status: 'done' }, 18),

    // Agents
    makeNode('agent-1', 'agent', 'Content Agent', { model: 'claude-sonnet-4-6', tasks: 24 }, 60),
    makeNode('agent-2', 'agent', 'Research Agent', { model: 'claude-sonnet-4-6', tasks: 11 }, 50),
    makeNode('agent-3', 'agent', 'SEO Agent', { model: 'claude-haiku-4-5', tasks: 8 }, 40),
    makeNode('agent-4', 'agent', 'Strategic Queen', { model: 'claude-opus-4-6', tasks: 5 }, 30),

    // Tools
    makeNode('tool-1', 'tool', 'HubSpot CRM', { category: 'CRM', n8nNode: 'n8n-nodes-base.hubspot' }, 80),
    makeNode('tool-2', 'tool', 'Resend', { category: 'Email', n8nNode: 'n8n-nodes-base.emailSend' }, 70),
    makeNode('tool-3', 'tool', 'Supabase', { category: 'Database' }, 90),
    makeNode('tool-4', 'tool', 'Stripe', { category: 'Payments', n8nNode: 'n8n-nodes-base.stripe' }, 75),

    // Workflows
    makeNode('wf-1', 'workflow', 'Lead Capture → CRM', { active: true, lastRun: 'success' }, 25),
    makeNode('wf-2', 'workflow', 'Weekly Analytics Digest', { active: true, lastRun: 'success' }, 15),
    makeNode('wf-3', 'workflow', 'Invoice Generation', { active: false, lastRun: 'error' }, 10),

    // Repository
    makeNode('repo-1', 'repository', 'pinnacleadvisors/nexus', { stars: 0, branch: 'main' }, 90),

    // Assets
    makeNode('asset-1', 'asset', 'Landing Page Copy v2', { type: 'document', url: '#' }, 15),
    makeNode('asset-2', 'asset', 'Competitor Report Q1', { type: 'report', url: '#' }, 18),
    makeNode('asset-3', 'asset', 'Email Sequence Draft', { type: 'document', url: '#' }, 22),

    // Prompts
    makeNode('prompt-1', 'prompt', 'Neuro-Content Generator', { version: 2, format: 'linkedin' }, 45),
    makeNode('prompt-2', 'prompt', 'Consultant System Prompt', { version: 1 }, 60),

    // Skills
    makeNode('skill-1', 'skill', 'LinkedIn Outreach', { requiresOpenClaw: true }, 30),
    makeNode('skill-2', 'skill', 'PDF Analysis', { requiresOpenClaw: false }, 20),
  ]

  const edges: GraphEdge[] = [
    // Business → Projects
    makeEdge('biz-1', 'proj-1', 'manages', 0.9),
    makeEdge('biz-1', 'proj-2', 'manages', 0.9),
    makeEdge('biz-1', 'proj-3', 'manages', 0.8),
    makeEdge('biz-2', 'proj-4', 'manages', 0.9),

    // Projects → Milestones
    makeEdge('proj-1', 'ms-1', 'belongs_to', 0.8),
    makeEdge('proj-1', 'ms-2', 'belongs_to', 0.8),
    makeEdge('proj-1', 'ms-3', 'belongs_to', 0.7),
    makeEdge('proj-2', 'ms-4', 'belongs_to', 0.8),
    makeEdge('proj-3', 'ms-5', 'belongs_to', 0.9),

    // Milestones depend on each other
    makeEdge('ms-2', 'ms-1', 'depends_on', 0.6),
    makeEdge('ms-3', 'ms-2', 'depends_on', 0.6),

    // Agents → Assets (created)
    makeEdge('agent-1', 'asset-1', 'created', 0.9),
    makeEdge('agent-2', 'asset-2', 'created', 0.9),
    makeEdge('agent-1', 'asset-3', 'created', 0.8),
    makeEdge('agent-4', 'agent-1', 'manages', 0.7),
    makeEdge('agent-4', 'agent-2', 'manages', 0.7),
    makeEdge('agent-4', 'agent-3', 'manages', 0.6),

    // Agents → Tools (uses)
    makeEdge('agent-1', 'tool-2', 'uses', 0.7),
    makeEdge('agent-2', 'tool-3', 'uses', 0.6),
    makeEdge('agent-1', 'prompt-1', 'uses', 0.8),
    makeEdge('agent-2', 'prompt-2', 'uses', 0.8),
    makeEdge('agent-4', 'prompt-2', 'uses', 0.6),

    // Workflows → Tools
    makeEdge('wf-1', 'tool-1', 'uses', 0.9),
    makeEdge('wf-1', 'tool-3', 'uses', 0.7),
    makeEdge('wf-2', 'tool-3', 'uses', 0.6),
    makeEdge('wf-3', 'tool-4', 'uses', 0.8),

    // Workflows → Milestones (triggers)
    makeEdge('wf-1', 'ms-4', 'triggers', 0.5),

    // Assets belong to milestones
    makeEdge('asset-1', 'ms-2', 'belongs_to', 0.7),
    makeEdge('asset-2', 'ms-5', 'belongs_to', 0.9),
    makeEdge('asset-3', 'ms-4', 'belongs_to', 0.7),

    // Repo
    makeEdge('repo-1', 'biz-1', 'belongs_to', 0.9),
    makeEdge('agent-4', 'repo-1', 'uses', 0.5),

    // Skills
    makeEdge('agent-1', 'skill-2', 'uses', 0.6),
    makeEdge('skill-1', 'wf-1', 'extends', 0.4),
  ]

  // Count connections
  const degMap = new Map<string, number>()
  for (const e of edges) {
    degMap.set(e.source, (degMap.get(e.source) ?? 0) + 1)
    degMap.set(e.target, (degMap.get(e.target) ?? 0) + 1)
  }
  for (const n of nodes) n.connections = degMap.get(n.id) ?? 0

  // Layout + clustering
  runForceLayout(nodes, edges)
  assignClusters(nodes, edges)
  assignPageRank(nodes, edges)

  return {
    nodes,
    edges,
    builtAt:   new Date().toISOString(),
    nodeCount: nodes.length,
    edgeCount: edges.length,
  }
}

// ── Supabase-sourced graph (with mock fallback) ───────────────────────────────

let _cache: GraphData | null = null
let _cacheAt  = 0
const CACHE_TTL = 60_000   // 60 s

export async function buildGraph(forceRebuild = false): Promise<GraphData> {
  if (_cache && !forceRebuild && Date.now() - _cacheAt < CACHE_TTL) return _cache

  const db = createServerClient()
  if (!db) {
    _cache  = buildMockGraph()
    _cacheAt = Date.now()
    return _cache
  }

  // Try to pull real data; fall back to mock on error
  try {
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []

    // Businesses
    const { data: businesses } = await db.from('businesses').select('id,name,created_at').limit(50)
    for (const b of businesses ?? []) {
      nodes.push({
        id: `biz-${b.id}`, type: 'business', label: b.name ?? 'Business',
        metadata: {}, position3d: { x: (Math.random() - 0.5) * 120, y: (Math.random() - 0.5) * 120, z: (Math.random() - 0.5) * 120 },
        clusterId: 0, pageRank: 0, connections: 0, createdAt: b.created_at ?? iso(),
      })
    }

    // Projects — select only typed columns; business_id handled via cast to bypass
    // strict Supabase column inference (column exists in DB but not all type definitions)
    type ProjectRow = { id: string; name: string | null; business_id?: string | null; created_at: string | null }
    const { data: projects } = await (db as unknown as {
      from: (t: string) => { select: (c: string) => { limit: (n: number) => Promise<{ data: ProjectRow[] | null }> } }
    }).from('projects').select('id,name,business_id,created_at').limit(100)
    for (const p of projects ?? []) {
      nodes.push({
        id: `proj-${p.id}`, type: 'project', label: p.name ?? 'Project',
        metadata: {}, position3d: { x: (Math.random() - 0.5) * 120, y: (Math.random() - 0.5) * 120, z: (Math.random() - 0.5) * 120 },
        clusterId: 0, pageRank: 0, connections: 0, createdAt: p.created_at ?? iso(),
      })
      if (p.business_id) edges.push({ id: uid(), source: `biz-${p.business_id}`, target: `proj-${p.id}`, relation: 'manages', weight: 0.9, createdAt: p.created_at ?? iso() })
    }

    // Milestones
    const { data: milestones } = await db.from('milestones').select('id,title,project_id,created_at').limit(200)
    for (const m of milestones ?? []) {
      nodes.push({
        id: `ms-${m.id}`, type: 'milestone', label: m.title ?? 'Milestone',
        metadata: {}, position3d: { x: (Math.random() - 0.5) * 120, y: (Math.random() - 0.5) * 120, z: (Math.random() - 0.5) * 120 },
        clusterId: 0, pageRank: 0, connections: 0, createdAt: m.created_at ?? iso(),
      })
      if (m.project_id) edges.push({ id: uid(), source: `proj-${m.project_id}`, target: `ms-${m.id}`, relation: 'belongs_to', weight: 0.8, createdAt: m.created_at ?? iso() })
    }

    // Agents
    const { data: agents } = await db.from('agents').select('id,name,status,created_at').limit(50)
    for (const a of agents ?? []) {
      nodes.push({
        id: `agent-${a.id}`, type: 'agent', label: a.name ?? 'Agent',
        metadata: { status: a.status }, position3d: { x: (Math.random() - 0.5) * 120, y: (Math.random() - 0.5) * 120, z: (Math.random() - 0.5) * 120 },
        clusterId: 0, pageRank: 0, connections: 0, createdAt: a.created_at ?? iso(),
      })
    }

    // Tasks (assets)
    const { data: tasks } = await db.from('tasks').select('id,title,assignee,project_id,created_at').limit(100)
    for (const t of tasks ?? []) {
      nodes.push({
        id: `asset-${t.id}`, type: 'asset', label: t.title ?? 'Asset',
        metadata: {}, position3d: { x: (Math.random() - 0.5) * 120, y: (Math.random() - 0.5) * 120, z: (Math.random() - 0.5) * 120 },
        clusterId: 0, pageRank: 0, connections: 0, createdAt: t.created_at ?? iso(),
      })
      if (t.project_id) edges.push({ id: uid(), source: `asset-${t.id}`, target: `proj-${t.project_id}`, relation: 'belongs_to', weight: 0.6, createdAt: t.created_at ?? iso() })
    }

    // If we got nothing meaningful, use mock
    if (nodes.length < 5) {
      _cache  = buildMockGraph()
      _cacheAt = Date.now()
      return _cache
    }

    // Count connections
    const degMap = new Map<string, number>()
    for (const e of edges) {
      degMap.set(e.source, (degMap.get(e.source) ?? 0) + 1)
      degMap.set(e.target, (degMap.get(e.target) ?? 0) + 1)
    }
    for (const n of nodes) n.connections = degMap.get(n.id) ?? 0

    runForceLayout(nodes, edges)
    assignClusters(nodes, edges)
    assignPageRank(nodes, edges)

    _cache  = { nodes, edges, builtAt: new Date().toISOString(), nodeCount: nodes.length, edgeCount: edges.length }
    _cacheAt = Date.now()
    return _cache
  } catch (err) {
    console.error('[graph/builder] Supabase query failed, using mock:', err)
    _cache  = buildMockGraph()
    _cacheAt = Date.now()
    return _cache
  }
}

// ── Subgraph helpers ──────────────────────────────────────────────────────────

export function getNodeNeighbourhood(
  graph: GraphData,
  nodeId: string,
  hops  = 1,
): { node: GraphNode | undefined; edges: GraphEdge[]; neighbours: GraphNode[] } {
  const node   = graph.nodes.find(n => n.id === nodeId)
  const nodeIds = new Set<string>([nodeId])
  let frontier  = [nodeId]

  for (let h = 0; h < hops; h++) {
    const next: string[] = []
    for (const e of graph.edges) {
      if (frontier.includes(e.source) && !nodeIds.has(e.target)) { nodeIds.add(e.target); next.push(e.target) }
      if (frontier.includes(e.target) && !nodeIds.has(e.source)) { nodeIds.add(e.source); next.push(e.source) }
    }
    frontier = next
  }

  const edges      = graph.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
  const neighbours = graph.nodes.filter(n => nodeIds.has(n.id) && n.id !== nodeId)
  return { node, edges, neighbours }
}

export function findShortestPath(
  graph: GraphData,
  fromId: string,
  toId:   string,
): { path: GraphNode[]; edges: GraphEdge[] } {
  // BFS
  const prev = new Map<string, string>()
  const queue = [fromId]
  prev.set(fromId, '')
  const adjEdge = new Map<string, GraphEdge>()

  while (queue.length) {
    const cur = queue.shift()!
    if (cur === toId) break
    for (const e of graph.edges) {
      let next: string | null = null
      if (e.source === cur && !prev.has(e.target)) { next = e.target; adjEdge.set(e.target, e) }
      if (e.target === cur && !prev.has(e.source)) { next = e.source; adjEdge.set(e.source, e) }
      if (next) { prev.set(next, cur); queue.push(next) }
    }
  }

  if (!prev.has(toId)) return { path: [], edges: [] }

  const pathIds: string[] = []
  let cur = toId
  while (cur) { pathIds.unshift(cur); cur = prev.get(cur) ?? '' }

  const pathEdges: GraphEdge[] = pathIds.slice(1).map(id => adjEdge.get(id)!).filter(Boolean)
  const pathNodes = pathIds.map(id => graph.nodes.find(n => n.id === id)!).filter(Boolean)
  return { path: pathNodes, edges: pathEdges }
}

/** Keyword-relevance scoring for the agent context API */
export function scoreNodeRelevance(node: GraphNode, query: string): number {
  const q = query.toLowerCase()
  const label = node.label.toLowerCase()
  const meta  = JSON.stringify(node.metadata).toLowerCase()
  let score = 0
  if (label.includes(q)) score += 10
  for (const word of q.split(/\s+/)) {
    if (label.includes(word)) score += 3
    if (meta.includes(word))  score += 1
  }
  score += node.pageRank * 5
  score += Math.min(node.connections, 10)
  return score
}

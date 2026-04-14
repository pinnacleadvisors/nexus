/**
 * lib/graph/types.ts
 * Type definitions for the Phase 14 relational knowledge graph.
 */

// ── Node types ────────────────────────────────────────────────────────────────

export type NodeType =
  | 'business'
  | 'project'
  | 'milestone'
  | 'agent'
  | 'tool'
  | 'workflow'
  | 'repository'
  | 'asset'
  | 'prompt'
  | 'skill'

export type EdgeRelation =
  | 'uses'
  | 'created'
  | 'depends_on'
  | 'triggers'
  | 'belongs_to'
  | 'generates'
  | 'manages'
  | 'tagged_with'
  | 'runs_on'
  | 'extends'

// ── Core graph data ───────────────────────────────────────────────────────────

export interface GraphNode {
  id:         string
  type:       NodeType
  label:      string
  metadata:   Record<string, unknown>
  position3d: { x: number; y: number; z: number }
  clusterId:  number
  pageRank:   number      // 0–1, used for node size
  connections: number     // degree count
  createdAt:  string
}

export interface GraphEdge {
  id:        string
  source:    string
  target:    string
  relation:  EdgeRelation
  weight:    number       // 0–1, controls line opacity
  createdAt: string
}

export interface GraphData {
  nodes:     GraphNode[]
  edges:     GraphEdge[]
  builtAt:   string
  nodeCount: number
  edgeCount: number
}

// ── Subgraph (returned by context + path APIs) ────────────────────────────────

export interface Subgraph {
  nodes:       GraphNode[]
  edges:       GraphEdge[]
  anchorId?:   string    // focal node ID
  relevance?:  number    // 0–1 confidence
  explanation: string
}

// ── MCP tool schema ───────────────────────────────────────────────────────────

export interface McpToolDefinition {
  name:        string
  description: string
  inputSchema: Record<string, unknown>
}

// ── Visual encoding ───────────────────────────────────────────────────────────

export const NODE_COLORS: Record<NodeType, string> = {
  business:   '#f59e0b',   // gold
  project:    '#6366f1',   // indigo
  milestone:  '#14b8a6',   // teal
  agent:      '#a855f7',   // purple
  tool:       '#6b7280',   // grey
  workflow:   '#f97316',   // orange
  repository: '#22c55e',   // green
  asset:      '#ec4899',   // pink
  prompt:     '#38bdf8',   // sky blue
  skill:      '#fbbf24',   // amber
}

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  business:   'Business',
  project:    'Project',
  milestone:  'Milestone',
  agent:      'Agent',
  tool:       'Tool',
  workflow:   'Workflow',
  repository: 'Repository',
  asset:      'Asset',
  prompt:     'Prompt',
  skill:      'Skill',
}

export const EDGE_COLORS: Record<EdgeRelation, string> = {
  uses:       '#4ade80',
  created:    '#a855f7',
  depends_on: '#f87171',
  triggers:   '#f97316',
  belongs_to: '#6366f1',
  generates:  '#14b8a6',
  manages:    '#fbbf24',
  tagged_with: '#6b7280',
  runs_on:    '#38bdf8',
  extends:    '#ec4899',
}

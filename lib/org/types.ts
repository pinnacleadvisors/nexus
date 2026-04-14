/**
 * lib/org/types.ts
 * Type definitions for the Phase 16 Organisation Chart & Agent Hierarchy.
 */

// ── Layer definitions ─────────────────────────────────────────────────────────
export type AgentLayer = 0 | 1 | 2 | 3 | 4

export const LAYER_META: Record<AgentLayer, { label: string; shortLabel: string; color: string; bg: string; description: string }> = {
  0: { label: 'User',               shortLabel: 'L0', color: '#f59e0b', bg: '#2e2818', description: 'Approves, rejects, redirects work' },
  1: { label: 'Strategic Queen',    shortLabel: 'L1', color: '#818cf8', bg: '#1a1a2e', description: 'Goal decomposition & phase planning' },
  2: { label: 'Tactical Queen',     shortLabel: 'L2', color: '#22d3ee', bg: '#1a2428', description: 'Task assignment & resource allocation' },
  3: { label: 'Specialist Agent',   shortLabel: 'L3', color: '#4ade80', bg: '#1a2e1a', description: 'Execution — coder, researcher, marketer etc.' },
  4: { label: 'Background Worker',  shortLabel: 'L4', color: '#9090b0', bg: '#12121e', description: 'Inngest jobs, webhooks, cron tasks' },
}

// ── Agent status ──────────────────────────────────────────────────────────────
export type AgentStatus = 'idle' | 'running' | 'error' | 'completed' | 'terminated'

export const STATUS_META: Record<AgentStatus, { color: string; bg: string; pulse?: boolean }> = {
  idle:       { color: '#55556a', bg: '#12121e' },
  running:    { color: '#4ade80', bg: '#1a2e1a', pulse: true },
  error:      { color: '#f87171', bg: '#2e1a1a', pulse: true },
  completed:  { color: '#818cf8', bg: '#1a1a2e' },
  terminated: { color: '#55556a', bg: '#12121e' },
}

// ── Core agent node ───────────────────────────────────────────────────────────
export interface OrgAgent {
  id:               string
  user_id:          string
  name:             string
  role:             string
  layer:            AgentLayer
  status:           AgentStatus
  parent_agent_id:  string | null
  swarm_id:         string | null
  business_id:      string | null
  project_id:       string | null
  model:            string
  current_task:     string | null
  tasks_completed:  number
  tokens_used:      number
  cost_usd:         number
  last_active_at:   string | null
  created_at:       string
  // Populated client-side from agent_actions
  recent_actions?:  AgentAction[]
  // Populated when building tree
  children?:        OrgAgent[]
}

// ── Agent action ──────────────────────────────────────────────────────────────
export interface AgentAction {
  id:          string
  agent_id:    string
  action:      string
  description: string | null
  tokens_used: number
  created_at:  string
}

// ── Hierarchy tree ────────────────────────────────────────────────────────────
export interface OrgTree {
  root:    OrgAgent           // L0 user node
  agents:  OrgAgent[]         // flat list (all layers)
  byId:    Record<string, OrgAgent>
  swarms:  string[]           // unique swarm IDs
  stats:   OrgStats
}

export interface OrgStats {
  total:          number
  byLayer:        Record<AgentLayer, number>
  byStatus:       Record<AgentStatus, number>
  totalTokens:    number
  totalCost:      number
  activeSwarms:   number
}

// ── Swimlane (by project/business) ───────────────────────────────────────────
export interface Swimlane {
  id:      string           // business_id or project_id or 'unassigned'
  label:   string
  agents:  OrgAgent[]
}

// ── View mode ─────────────────────────────────────────────────────────────────
export type OrgViewMode = 'tree' | 'swimlane'

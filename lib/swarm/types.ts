/**
 * lib/swarm/types.ts
 * Core type definitions for the Nexus multi-agent swarm orchestration layer.
 */

// ── Model cost table (USD per 1M tokens) ─────────────────────────────────────
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':           { input: 15,  output: 75  },
  'claude-sonnet-4-6':         { input: 3,   output: 15  },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4   },
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const costs = MODEL_COSTS[model] ?? MODEL_COSTS['claude-sonnet-4-6']
  return (inputTokens / 1_000_000) * costs.input + (outputTokens / 1_000_000) * costs.output
}

// ── Enums ─────────────────────────────────────────────────────────────────────
export type ConsensusType = 'raft' | 'bft' | 'gossip'
export type QueenType     = 'strategic' | 'tactical' | 'adaptive'
export type SwarmStatus   = 'pending' | 'planning' | 'running' | 'consensus' | 'completed' | 'failed' | 'aborted'
export type TaskStatus    = 'pending' | 'assigned' | 'running' | 'consensus' | 'approved' | 'rejected' | 'failed'
export type Complexity    = 'low' | 'medium' | 'high'

export type AgentRole =
  | 'researcher'       | 'analyst'         | 'strategist'      | 'coder'
  | 'reviewer'         | 'tester'          | 'architect'        | 'security-auditor'
  | 'marketer'         | 'copywriter'      | 'seo-specialist'   | 'social-media'
  | 'email-specialist' | 'designer'        | 'data-analyst'     | 'finance-analyst'
  | 'legal-advisor'    | 'customer-support'| 'devops'           | 'product-manager'
  | 'qa-engineer'      | 'brand-strategist'

// ── Agent definition ──────────────────────────────────────────────────────────
export interface AgentDefinition {
  role:           AgentRole
  name:           string
  description:    string
  systemPrompt:   string
  preferredModel: string
  fallbackModel:  string
  maxTokens:      number
  temperature:    number
  /** Task type keywords this agent handles best */
  tags:           string[]
  /** Estimated complexity this agent is optimised for */
  complexity:     Complexity
}

// ── Swarm task ────────────────────────────────────────────────────────────────
export interface SwarmTask {
  id:          string
  swarmId:     string
  phase:       number
  title:       string
  description: string
  role:        AgentRole
  status:      TaskStatus
  result?:     string
  votes?:      TaskVote[]
  tokensUsed?: number
  model?:      string
  durationMs?: number
  createdAt:   string
  updatedAt:   string
}

export interface TaskVote {
  agentRole:  AgentRole
  approve:    boolean
  confidence: number   // 0-1
  rationale:  string
}

// ── Swarm phase ───────────────────────────────────────────────────────────────
export interface SwarmPhase {
  phase:   number
  title:   string
  taskIds: string[]
  status:  'pending' | 'running' | 'completed' | 'failed'
}

// ── Swarm run ─────────────────────────────────────────────────────────────────
export interface SwarmRun {
  id:            string
  goal:          string
  context?:      string
  queenType:     QueenType
  consensusType: ConsensusType
  status:        SwarmStatus
  phases:        SwarmPhase[]
  currentPhase:  number
  totalTokens:   number
  totalCostUsd:  number
  budgetUsd?:    number
  createdAt:     string
  updatedAt:     string
  completedAt?:  string
  error?:        string
}

// ── Swarm SSE events ──────────────────────────────────────────────────────────
export type SwarmEventType =
  | 'status'       | 'plan'         | 'phase_start'  | 'phase_end'
  | 'task_start'   | 'task_end'     | 'task_chunk'   | 'consensus'
  | 'drift'        | 'error'        | 'complete'

export interface SwarmEvent {
  type:    SwarmEventType
  swarmId: string
  payload: Record<string, unknown>
  ts:      number
}

// ── Reasoning pattern (ReasoningBank) ────────────────────────────────────────
export interface ReasoningPattern {
  id:            string
  taskType:      string
  taskHash:      string
  agentRole:     AgentRole
  model:         string
  promptHash:    string
  resultQuality: number  // 0-1
  tokensUsed:    number
  durationMs:    number
  approved:      boolean
  createdAt:     string
}

// ── Router Q-table ────────────────────────────────────────────────────────────
export interface RouterStateKey {
  taskType:   string
  complexity: Complexity
}

export interface RouterAction {
  agentRole: AgentRole
  model:     string
}

export interface QEntry {
  qValue:     number
  visitCount: number
}

// ── Swarm config (dispatch body) ──────────────────────────────────────────────
export interface SwarmConfig {
  goal:             string
  context?:         string
  queenType?:       QueenType
  consensusType?:   ConsensusType
  budgetUsd?:       number
  maxPhases?:       number
  driftThreshold?:  number
  checkpointEvery?: number
}

// ── Emitter helper ────────────────────────────────────────────────────────────
export type EventEmitter = (event: SwarmEvent) => void

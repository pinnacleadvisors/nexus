// ── Kanban ────────────────────────────────────────────────────────────────────
export type ColumnId = 'backlog' | 'in-progress' | 'review' | 'completed'

export interface KanbanCard {
  id: string
  title: string
  description: string
  columnId: ColumnId
  assignee?: string
  priority: 'low' | 'medium' | 'high'
  assetUrl?: string
  createdAt: string
  revisionNote?: string
}

export interface KanbanColumn {
  id: ColumnId
  label: string
  cards: KanbanCard[]
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export interface RevenueDataPoint {
  month: string
  revenue: number
  cost: number
}

export interface KpiCard {
  label: string
  value: string
  delta?: number
  unit?: string
  color?: 'default' | 'green' | 'red' | 'purple'
}

export interface AgentRow {
  id: string
  name: string
  status: 'active' | 'idle' | 'error'
  tasksCompleted: number
  tokensUsed: number
  costUsd: number
  errorCount?: number
  lastActive: string
}

// ── Forge ─────────────────────────────────────────────────────────────────────
export interface ForgeProject {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface Milestone {
  id: string
  title: string
  description: string
  targetDate?: string
  status: 'pending' | 'in-progress' | 'done'
  phase: number
}

export interface GanttTask {
  id: string
  name: string
  startWeek: number
  durationWeeks: number
  phase: number
  status: 'pending' | 'active' | 'done'
  agent?: string
}

// ── Dashboard filters & alerts ────────────────────────────────────────────────
export type DateRange = '7d' | '30d' | '90d' | 'all'

export interface AlertThreshold {
  id: string
  metric: 'daily_cost' | 'error_rate' | 'agent_down'
  threshold: number
  channel: 'email' | 'slack'
  destination: string
  enabled: boolean
}

// ── AI Model configuration ────────────────────────────────────────────────────
export interface ModelOption {
  id: string
  label: string
  note: string
  /** USD per 1M input tokens */
  costInput: number
  /** USD per 1M output tokens */
  costOutput: number
}

export const ADVISOR_MODELS: ModelOption[] = [
  {
    id: 'claude-opus-4-6',
    label: 'Opus 4.6',
    note: 'Best quality · strategic reasoning',
    costInput: 15,
    costOutput: 75,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    note: 'Fast · balanced cost',
    costInput: 3,
    costOutput: 15,
  },
]

export const EXECUTOR_MODELS: ModelOption[] = [
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    note: 'Balanced · implementation tasks',
    costInput: 3,
    costOutput: 15,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
    note: 'Cheapest · simple tasks',
    costInput: 0.8,
    costOutput: 4,
  },
]

export interface ModelConfig {
  advisorModel: string
  executorModel: string
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  advisorModel: 'claude-opus-4-6',
  executorModel: 'claude-sonnet-4-6',
}

// ── Tools ─────────────────────────────────────────────────────────────────────
export type ToolCategory = 'AI' | 'Analytics' | 'Automation' | 'Communication' | 'DevOps' | 'Finance' | 'Database'
export type ToolStatus = 'available' | 'coming-soon' | 'beta'

export interface Tool {
  id: string
  name: string
  description: string
  icon: string
  category: ToolCategory
  status: ToolStatus
  href?: string
}

// ── OpenClaw / MyClaw ─────────────────────────────────────────────────────────
export interface ClawConfig {
  gatewayUrl: string
  hookToken: string
}

// ── OAuth ─────────────────────────────────────────────────────────────────────
export type OAuthProviderName = 'google' | 'github' | 'slack' | 'notion'

export interface OAuthProvider {
  id: OAuthProviderName
  name: string
  icon: string
  description: string
  scopes: string[]
  color: string
  authUrl: string
  envClientId: string
}

export interface OAuthConnection {
  provider: OAuthProviderName
  connectedAt: string
}

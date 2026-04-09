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

/**
 * lib/n8n/types.ts
 * Type definitions for the n8n workflow automation layer.
 */

// ── n8n Workflow JSON schema ──────────────────────────────────────────────────
export interface N8nNode {
  id:          string
  name:        string
  type:        string          // e.g. 'n8n-nodes-base.webhook'
  typeVersion: number
  position:    [number, number]
  parameters:  Record<string, unknown>
  credentials?: Record<string, { id: string; name: string }>
  disabled?:   boolean
}

export interface N8nConnection {
  node:  string
  type:  'main'
  index: number
}

export interface N8nWorkflow {
  id?:   string
  name:  string
  nodes: N8nNode[]
  connections: Record<string, { main: N8nConnection[][] }>
  active:   boolean
  settings: {
    executionOrder?:       'v1' | 'v0'
    saveManualExecutions?: boolean
    callerPolicy?:         string
    errorWorkflow?:        string
  }
  tags?: string[]
  meta?: { templateId?: string }
}

// ── Workflow templates ────────────────────────────────────────────────────────
export type WorkflowCategory =
  | 'content'
  | 'marketing'
  | 'sales'
  | 'operations'
  | 'finance'
  | 'support'
  | 'monitoring'

export interface WorkflowTemplate {
  id:                     string
  name:                   string
  description:            string
  category:               WorkflowCategory
  estimatedSetupMinutes:  number
  requiredCredentials:    string[]   // n8n credential type names
  requiredEnvVars:        string[]   // Doppler keys needed
  triggers:               string[]   // human-readable trigger descriptions
  workflow:               N8nWorkflow
  setupChecklist:         string[]
  openClawSteps:          string[]   // steps that need browser automation
}

// ── Tool research ─────────────────────────────────────────────────────────────
export interface ToolEntry {
  name:              string
  category:          string
  n8nNodes:          string[]   // n8n node types
  complexity:        'low' | 'medium' | 'high'
  setupMinutes:      number
  monthlyCost:       string
  requiresOpenClaw:  boolean
  description:       string
}

export interface ToolCompatibilityResult extends ToolEntry {
  compatible: boolean   // does user's stack support this?
}

// ── Consultant output ─────────────────────────────────────────────────────────
export interface AutomationRecommendation {
  priority:              number    // 1 = highest
  title:                 string
  description:           string
  tools:                 string[]
  workflowTemplateId?:   string
  estimatedSetupMinutes: number
  monthlyCostSaving:     string
  requiresOpenClaw:      boolean
  rationale:             string
  complexity:            'low' | 'medium' | 'high'
}

export interface ConsultantReport {
  businessSummary:         string
  automationOpportunities: AutomationRecommendation[]
  openClawEscalations:     string[]
  nextSteps:               string[]
  totalEstimatedSavingHrs: number
}

// ── n8n API responses ─────────────────────────────────────────────────────────
export interface N8nWorkflowStatus {
  id:             string
  name:           string
  active:         boolean
  createdAt:      string
  updatedAt:      string
  tags:           Array<{ id: string; name: string }>
  lastExecution?: {
    id:         string
    startedAt:  string
    stoppedAt?: string
    status:     'running' | 'success' | 'error' | 'waiting'
  }
}

export interface N8nExecutionResult {
  id:         string
  workflowId: string
  startedAt:  string
  stoppedAt?: string
  status:     'running' | 'success' | 'error' | 'waiting'
  data?:      Record<string, unknown>
}

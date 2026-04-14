/**
 * lib/build/types.ts
 * Type definitions for Phase 19a — Dev Console (Nexus Builds Nexus).
 */

// ── Request types ─────────────────────────────────────────────────────────────
export type BuildRequestType = 'feature' | 'bug' | 'error'

export interface BuildRequest {
  type:        BuildRequestType
  description: string   // free-text: feature idea, bug description, or pasted error
}

// ── Plan produced by Claude Opus ──────────────────────────────────────────────
export type Complexity = 'S' | 'M' | 'L' | 'XL'
export type RiskLevel  = 'low' | 'medium' | 'high'

export interface BuildStep {
  order:       number
  action:      string   // e.g. "Edit app/api/agent/route.ts"
  description: string
  file?:       string   // primary file affected
}

export interface BuildPlan {
  title:        string
  summary:      string
  type:         BuildRequestType
  complexity:   Complexity
  risk:         RiskLevel
  affectedFiles: string[]
  steps:        BuildStep[]
  branchName:   string    // claude/<slug>
  commitMessage: string
  testInstructions: string
  estimatedMinutes: number
}

// ── Task stored on the Board ──────────────────────────────────────────────────
export type BuildTaskStatus =
  | 'planning'        // Claude Opus generating plan
  | 'plan_ready'      // plan shown to user, awaiting approval
  | 'dispatching'     // sending to OpenClaw
  | 'in_progress'     // OpenClaw executing
  | 'review'          // PR opened, awaiting user review
  | 'completed'       // merged / applied
  | 'rejected'        // user rejected plan or diff
  | 'error'           // something failed

export interface BuildTask {
  id:          string
  request:     BuildRequest
  plan:        BuildPlan | null
  status:      BuildTaskStatus
  sessionId:   string | null   // OpenClaw session ID
  branchUrl:   string | null   // GitHub branch URL
  prUrl:       string | null   // GitHub PR URL
  boardCardId: string | null
  output:      string          // streamed text from OpenClaw
  error:       string | null
  createdAt:   string
  updatedAt:   string
}

// ── API response shapes ───────────────────────────────────────────────────────
export interface PlanResponse {
  plan: BuildPlan
}

export interface DispatchResponse {
  ok:          boolean
  sessionId?:  string
  branchUrl?:  string
  boardCardId?: string
  error?:      string
}

// ── File tree entry ───────────────────────────────────────────────────────────
export interface FileTreeEntry {
  path:  string
  type:  'file' | 'dir'
  depth: number
}

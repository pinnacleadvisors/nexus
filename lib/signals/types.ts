/**
 * lib/signals/types.ts
 *
 * Signals = the platform-improvement inbox. The owner drops in fleeting
 * ideas, links to interesting tools, recurring errors, and open questions;
 * a nightly LLM council triages each one and writes back a verdict.
 */

export type SignalKind   = 'idea' | 'link' | 'error' | 'question'
export type SignalStatus =
  | 'new'         // freshly captured, not yet reviewed
  | 'triaging'    // a council pass is in flight (set + cleared by the cron)
  | 'accepted'    // council recommends building it — promoted to roadmap PENDING
  | 'rejected'    // already covered, off-strategy, or low value
  | 'deferred'    // good idea, wrong moment
  | 'implemented' // shipped — set manually by the owner once a PR lands

export type CouncilRole = 'scout' | 'memory' | 'architect' | 'tester' | 'judge'

export interface Signal {
  id:             string
  userId:         string
  kind:           SignalKind
  title:          string
  body:           string
  url?:           string
  status:         SignalStatus
  decidedReason?: string
  decidedAt?:     string
  createdAt:      string
  updatedAt:      string
}

export interface SignalEvaluation {
  id:         string
  signalId:   string
  userId:     string
  role:       CouncilRole
  verdict?:   string
  reasoning:  string
  model?:     string
  createdAt:  string
}

export interface CreateSignalInput {
  kind:  SignalKind
  title: string
  body?: string
  url?:  string
}

export interface SignalWithEvaluations extends Signal {
  evaluations: SignalEvaluation[]
}

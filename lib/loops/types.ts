/**
 * lib/loops/types.ts — shared types for the Loops primitive.
 *
 * A "Loop" is an operator-declared, bounded, inspectable iteration runtime:
 * the operator declares a North Star + end-outcome predicate + a delegated
 * agent, sets cost/iteration/time caps + approval gates, and the platform
 * runs the loop within those bounds (dispatching the `loop-runner` agent
 * through the existing claude-gateway — NO new runtime).
 *
 * Maps to Life-Harness `h4` (trajectory regulation) — see AGENTS.md
 * "Harness taxonomy". Inherits every Ralph-loop invariant (AGENTS.md
 * "Operator-gated loop pattern").
 *
 * Tables: `loops` (migration 094), `loop_iterations` (095),
 * `gateway_turns.loop_id` (096). v2 (harness synthesis) folds `mode` +
 * `explorer_model` + `verifier_model` + `review_modality` into the loops
 * table with `iterate` defaults so v1 rows are unaffected.
 *
 * NOTE: this file is intentionally self-contained (no imports) so it can be
 * duplicated verbatim into the API + UI branches that consume it before the
 * schema PR merges — identical add/add resolves cleanly on rebase.
 */

/** Lifecycle of a Loop. */
export type LoopStatus = 'active' | 'paused' | 'done' | 'killed'
export const LOOP_STATUSES: readonly LoopStatus[] = ['active', 'paused', 'done', 'killed']

/**
 * v1 Loops `iterate` against a moving target. v2 Loops `synthesize` a
 * reusable sub-harness for a goal never achieved before (two-tier
 * explorer→verifier). A row's mode is fixed at creation.
 */
export type LoopMode = 'iterate' | 'synthesize'
export const LOOP_MODES: readonly LoopMode[] = ['iterate', 'synthesize']

/**
 * Which verifier the synthesize loop routes its final review to — a vision
 * deliverable gets a vision-capable verifier, etc. Null = code/text default.
 */
export type ReviewModality = 'vision' | 'audio' | 'code' | 'text'
export const REVIEW_MODALITIES: readonly ReviewModality[] = ['vision', 'audio', 'code', 'text']

/** Outcome of a single iteration. `running` = in flight, not yet resolved. */
export type LoopIterationOutcome = 'running' | 'success' | 'partial' | 'error' | 'cancelled'

/** The decision the iteration-result endpoint hands back to the loop-runner. */
export type LoopNextInstruction = 'continue' | 'stop' | 'await-approval'

export interface Loop {
  id:                   string
  user_id:              string
  business_slug:        string | null
  name:                 string
  north_star_md:        string
  end_outcome_md:       string
  delegated_agent_slug: string
  delegated_team_id:    string | null
  cost_cap_usd:         number | null
  iteration_cap:        number | null
  time_cap_hours:       number | null
  /** Gate keys (e.g. `deploy_to_prod`) whose scope changes need operator OK. */
  approval_gates:       string[]
  status:               LoopStatus
  mode:                 LoopMode
  explorer_model:       string | null
  verifier_model:       string | null
  review_modality:      ReviewModality | null
  created_at:           string
  ended_at:             string | null
}

export interface LoopIteration {
  id:                 string
  loop_id:            string
  iteration_n:        number
  /** The iteration-plan typed-block approval_id this row corresponds to. */
  iteration_plan_id:  string | null
  scope:              string | null
  intent:             string | null
  started_at:         string
  ended_at:           string | null
  outcome:            LoopIterationOutcome
  summary_md:         string | null
  gateway_turn_ids:   string[]
  cost_usd:           number
}

/** Loop + a lightweight rollup for the list view. */
export interface LoopSummary extends Loop {
  iteration_count: number
  total_cost_usd:  number
  last_activity:   string | null
}

/** Payload accepted by POST /api/loops (create). */
export interface LoopCreateInput {
  name:                  string
  business_slug?:        string | null
  north_star_md:         string
  end_outcome_md:        string
  delegated_agent_slug:  string
  delegated_team_id?:    string | null
  cost_cap_usd?:         number | null
  iteration_cap?:        number | null
  time_cap_hours?:       number | null
  approval_gates?:       string[]
  mode?:                 LoopMode
  explorer_model?:       string | null
  verifier_model?:       string | null
  review_modality?:      ReviewModality | null
}

/** Payload accepted by PATCH /api/loops/[id] (operator controls). */
export interface LoopPatchInput {
  status?:        LoopStatus
  cost_cap_usd?:  number | null
  iteration_cap?: number | null
  time_cap_hours?: number | null
}

/** Payload posted by the loop-runner to /api/loops/[id]/iteration-result. */
export interface LoopIterationResultInput {
  iteration_n:        number
  iteration_plan_id?: string | null
  scope?:             string | null
  intent?:            string | null
  outcome:            Exclude<LoopIterationOutcome, 'running'>
  summary_md?:        string | null
  gateway_turn_ids?:  string[]
  cost_usd?:          number
}

export function isLoopStatus(v: unknown): v is LoopStatus {
  return typeof v === 'string' && (LOOP_STATUSES as readonly string[]).includes(v)
}

export function isLoopMode(v: unknown): v is LoopMode {
  return typeof v === 'string' && (LOOP_MODES as readonly string[]).includes(v)
}

export function isReviewModality(v: unknown): v is ReviewModality {
  return typeof v === 'string' && (REVIEW_MODALITIES as readonly string[]).includes(v)
}

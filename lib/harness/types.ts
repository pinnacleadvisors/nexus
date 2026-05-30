/**
 * lib/harness/types.ts — shared types for sub-harnesses (v2 harness synthesis).
 *
 * A sub-harness is the reusable COMPOSITE artifact a mode=synthesize Loop
 * crystallizes (skills + agent refs + tool manifest + self-authored tests +
 * a typed review-spec). Maps to Life-Harness `h5`. Table: migration 097.
 *
 * Self-contained (no imports) so it can be carried verbatim into the E2/E4
 * branches before the schema PR merges — identical add/add resolves cleanly.
 */

export type SubHarnessStatus = 'draft' | 'verified' | 'failed'
export const SUB_HARNESS_STATUSES: readonly SubHarnessStatus[] = ['draft', 'verified', 'failed']

/** Modality the verifier reviewed under — mirrors loops.review_modality. */
export type HarnessReviewModality = 'vision' | 'audio' | 'code' | 'text'

/**
 * One self-authored test the explorer ran in the sandbox. `passed` is the
 * evidence the verifier requires BEFORE it spends a single smart-model token
 * (TDD-evidence-before-review discipline).
 */
export interface SubHarnessTest {
  name:     string
  /** Shell/command the explorer ran in nexus-sandbox to produce evidence. */
  command?: string
  /** Human-readable assertion the command's output had to satisfy. */
  assert?:  string
  /** Evidence: did this test pass in the sandbox? */
  passed?:  boolean
}

export interface SubHarnessReviewSpec {
  modality: HarnessReviewModality
  criteria: string[]
}

/** The replayable bundle. Kept SMALL + auditable (Pi.dev 4-core-tool minimalism). */
export interface SubHarnessManifest {
  /** `.claude/skills/<name>` refs the harness composes. */
  skills:      string[]
  /** `.claude/agents/<slug>` refs the harness dispatches. */
  agent_refs:  string[]
  /** Tool / MCP ids the harness needs (≥ 2 plausible per the tool-budget rule). */
  tools:       string[]
  /** Self-authored tests + their pass evidence. */
  tests:       SubHarnessTest[]
  /** What the verifier checked + the modality it used. */
  review_spec: SubHarnessReviewSpec | null
}

export function emptyManifest(): SubHarnessManifest {
  return { skills: [], agent_refs: [], tools: [], tests: [], review_spec: null }
}

export interface SubHarness {
  id:          string
  loop_id:     string | null
  user_id:     string
  slug:        string
  goal_md:     string
  manifest:    SubHarnessManifest
  status:      SubHarnessStatus
  created_at:  string
  verified_at: string | null
  verified_by: string | null
}

export interface SubHarnessCreateInput {
  slug:      string
  goal_md:   string
  manifest:  SubHarnessManifest
  loop_id?:  string | null
}

/**
 * THE replay gate — the single source of truth shared by the invoke endpoint
 * (E4) and any validation. A sub-harness is replayable ONLY when verified
 * (same gate as the skill router refusing un-promoted skills).
 */
export function isSubHarnessReplayable(status: string): boolean {
  return status === 'verified'
}

export function isSubHarnessStatus(v: unknown): v is SubHarnessStatus {
  return typeof v === 'string' && (SUB_HARNESS_STATUSES as readonly string[]).includes(v)
}

const SLUG_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/
export function isHarnessSlug(s: unknown): s is string {
  return typeof s === 'string' && SLUG_RE.test(s)
}

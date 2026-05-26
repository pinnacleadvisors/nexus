/**
 * lib/simulation/export.ts — JSON export / import for hyperbolic-chamber
 * runs (v2-C, PR #367).
 *
 * Export: serialize a finished run + all its events into a portable
 * JSON blob. Operator can save it as a file, share it, or re-import
 * elsewhere.
 *
 * Import: create a NEW run with the imported config. Same seed +
 * same business + same policy = same timeline → deterministic replay.
 * The result of the replayed run should match the original within
 * the bounds of the engine's randomness (which is RNG-controlled and
 * thus stable per seed).
 *
 * Schema versioning: bumping `SCHEMA_VERSION` lets us evolve the
 * export shape without breaking older exports. v1 includes
 * compare_group_id and synthetic_voice when present (v2-A/v2-B); they
 * round-trip through optional fields.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const SCHEMA_VERSION = 1

export interface ExportPayload {
  schema_version: number
  exported_at:    string
  run: {
    business_slug:        string
    mode:                 'manual' | 'auto'
    compress_days:        number
    wallclock_budget_sec: number
    approver_policy:      string | null
    seed:                 string
    status:               string
    started_at:           string | null
    ended_at:             string | null
    result:               Record<string, unknown> | null
    compare_group_id?:    string | null
    synthetic_voice?:     string | null
  }
  events: Array<{
    sim_day:        number
    sim_hour:       number
    kind:           string
    payload:        Record<string, unknown>
    outcome:        Record<string, unknown> | null
    approval_state: string | null
    approved_by:    string | null
  }>
}

interface RawRunRow {
  business_slug:        string
  mode:                 'manual' | 'auto'
  compress_days:        number
  wallclock_budget_sec: number
  approver_policy:      string | null
  seed:                 string
  status:               string
  started_at:           string | null
  ended_at:             string | null
  result:               Record<string, unknown> | null
  compare_group_id?:    string | null
  synthetic_voice?:     string | null
}

interface RawEventRow {
  sim_day:        number
  sim_hour:       number
  kind:           string
  payload:        Record<string, unknown>
  outcome:        Record<string, unknown> | null
  approval_state: string | null
  approved_by:    string | null
}

export async function exportRun(db: SupabaseClient, userId: string, runId: string): Promise<ExportPayload | null> {
  // Run row
  const runRes = await (db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: RawRunRow | null }> } } }
  }).select('business_slug, mode, compress_days, wallclock_budget_sec, approver_policy, seed, status, started_at, ended_at, result, compare_group_id, synthetic_voice')
    .eq('id', runId).eq('user_id', userId).maybeSingle()
  if (!runRes.data) return null

  // Events (ordered chronologically so re-import preserves the feed)
  const evRes = await (db.from('simulation_events' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: RawEventRow[] | null }> } } }
  }).select('sim_day, sim_hour, kind, payload, outcome, approval_state, approved_by')
    .eq('run_id', runId)
    .order('sim_day',  { ascending: true })
    .order('sim_hour', { ascending: true })
  const events = evRes.data ?? []

  return {
    schema_version: SCHEMA_VERSION,
    exported_at:    new Date().toISOString(),
    run: {
      business_slug:        runRes.data.business_slug,
      mode:                 runRes.data.mode,
      compress_days:        runRes.data.compress_days,
      wallclock_budget_sec: runRes.data.wallclock_budget_sec,
      approver_policy:      runRes.data.approver_policy,
      seed:                 runRes.data.seed,
      status:               runRes.data.status,
      started_at:           runRes.data.started_at,
      ended_at:             runRes.data.ended_at,
      result:               runRes.data.result,
      ...(runRes.data.compare_group_id !== undefined && { compare_group_id: runRes.data.compare_group_id }),
      ...(runRes.data.synthetic_voice  !== undefined && { synthetic_voice:  runRes.data.synthetic_voice }),
    },
    events: events.map(e => ({
      sim_day:        e.sim_day,
      sim_hour:       e.sim_hour,
      kind:           e.kind,
      payload:        e.payload,
      outcome:        e.outcome,
      approval_state: e.approval_state,
      approved_by:    e.approved_by,
    })),
  }
}

export interface ImportRunInput {
  db:       SupabaseClient
  userId:   string
  payload:  ExportPayload
  /** Override the business slug — useful when importing into a different sim business. */
  targetSlug?: string
}

export interface ImportRunResult {
  ok:        boolean
  run_id?:   string
  error?:    string
}

/**
 * Create a new simulation_runs row from an imported payload. Sets
 * status='pending' so the operator clicks "Run to completion" (auto
 * mode) or "Next event" (manual) to replay. The seed is preserved so
 * the timeline is identical to the original.
 *
 * Does NOT replay events — that's the engine's job once the operator
 * starts the run. If the operator wants the EXACT same outcomes
 * (including manual decisions), they need to re-make those decisions
 * on the new run; auto-mode policies should reproduce identically.
 */
export async function importRun(input: ImportRunInput): Promise<ImportRunResult> {
  const p = input.payload
  if (typeof p !== 'object' || p === null) {
    return { ok: false, error: 'invalid_payload' }
  }
  if (p.schema_version !== SCHEMA_VERSION) {
    return { ok: false, error: `unsupported_schema_version:${p.schema_version}` }
  }
  if (!p.run?.seed || !p.run.business_slug) {
    return { ok: false, error: 'missing_run_fields' }
  }

  const slug = input.targetSlug ?? p.run.business_slug
  // Verify the target business is a sim
  const bizRes = await (input.db.from('business_operators' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { simulation?: boolean } | null }> } }
  }).select('simulation').eq('slug', slug).maybeSingle()
  if (!bizRes.data) return { ok: false, error: 'target_business_not_found' }
  if (!bizRes.data.simulation) return { ok: false, error: 'target_not_a_simulation_business' }

  const row: Record<string, unknown> = {
    user_id:              input.userId,
    business_slug:        slug,
    mode:                 p.run.mode,
    compress_days:        p.run.compress_days,
    wallclock_budget_sec: p.run.wallclock_budget_sec,
    approver_policy:      p.run.approver_policy ?? null,
    seed:                 p.run.seed,
    status:               'pending',
    total_events:         p.events.length,
    started_at:           null,
  }
  // Optional fields — only include if present in the payload so importing
  // into a deployment that hasn't applied 072/073 doesn't crash.
  if (p.run.synthetic_voice  !== undefined) row.synthetic_voice  = p.run.synthetic_voice
  // Don't carry compare_group_id on import — it would put the imported run
  // in the same A/B group, which probably isn't intended.

  const ins = await (input.db.from('simulation_runs' as never) as unknown as {
    insert: (r: unknown) => { select: (c: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } }
  }).insert(row).select('id').single()
  if (ins.error || !ins.data) return { ok: false, error: ins.error?.message ?? 'insert_failed' }
  return { ok: true, run_id: ins.data.id }
}

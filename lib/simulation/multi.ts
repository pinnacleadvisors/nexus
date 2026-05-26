/**
 * lib/simulation/multi.ts — A/B comparison support for the hyperbolic
 * chamber. Operator picks 2-4 approver policies, engine spawns one
 * `simulation_runs` row per policy, all sharing:
 *
 *   - the same business
 *   - the same Monte Carlo seed (→ identical timeline)
 *   - the same compress_days + wallclock_budget
 *
 * Only the policy varies. Result = trading-backtest comparison: which
 * strategy yields the most approvals / highest sim revenue / fewest
 * critical failures against the IDENTICAL chaos input.
 *
 * Groups share a `compare_group_id` uuid. The migration-072 partial
 * unique index only enforces "one solo live run per business" — A/B
 * groups can have multiple concurrent rows.
 */

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateTimeline } from './timeline'
import { precomputeVoicesForSeed } from './voice-cache'
import type { ApproverPolicy } from './auto-approver'

export interface StartABInput {
  db:                   SupabaseClient
  userId:               string
  businessSlug:         string
  policies:             ApproverPolicy[]   // 2-4 entries, no duplicates
  compress_days:        number
  wallclock_budget_sec: number
  /**
   * Per-row voice. 'template' is free + deterministic. 'llm' multiplies
   * the run's wall-cost by the number of policies — each engine generates
   * its own ticket bodies independently. Caveat: LLM sampling means
   * identical (persona, ticket) inputs produce DIFFERENT outputs per
   * policy, which adds noise to the comparison. For routine A/B sanity
   * checks, prefer 'template'. For "how does each policy handle the same
   * LLM-flavoured chaos at p99 realism", flip to 'llm' and accept the
   * cost + sampling variance.
   */
  synthetic_voice?:     'template' | 'llm'
}

export interface StartABResult {
  ok:           boolean
  group_id?:    string
  run_ids?:     string[]
  shared_seed?: string
  error?:       string
}

/**
 * Create N parallel runs sharing the same seed. Insert order matches
 * the input `policies` order so the UI can render the comparison in a
 * predictable column layout.
 *
 * Doesn't actually advance the runs — that's still each caller's job
 * via /api/simulations/:id/run. The grouping is structural.
 */
export async function startAB(input: StartABInput): Promise<StartABResult> {
  if (input.policies.length < 2)  return { ok: false, error: 'a-b_needs_at_least_two_policies' }
  if (input.policies.length > 4)  return { ok: false, error: 'a-b_capped_at_four_policies' }
  if (new Set(input.policies).size !== input.policies.length) {
    return { ok: false, error: 'a-b_policies_must_be_unique' }
  }

  // Verify business + simulation flag
  const bizRes = await (input.db.from('business_operators' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { simulation?: boolean; kpi_targets?: Record<string, unknown> | null; approval_gates?: string[] | null; niche?: string | null; money_model?: Record<string, unknown> | null } | null }> } }
  }).select('simulation, kpi_targets, approval_gates, niche, money_model')
    .eq('slug', input.businessSlug).maybeSingle()
  if (!bizRes.data) return { ok: false, error: 'business_not_found' }
  if (!bizRes.data.simulation) return { ok: false, error: 'not_a_simulation_business' }

  // Shared seed — every policy gets the same timeline
  const sharedSeed = `${input.businessSlug}-ab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const timeline   = generateTimeline({
    seed: sharedSeed,
    compress_days: input.compress_days,
    business: bizRes.data,
  })
  const groupId = randomUUID()

  const voice = input.synthetic_voice ?? 'template'
  const rows = input.policies.map(policy => ({
    user_id:              input.userId,
    business_slug:        input.businessSlug,
    mode:                 'auto',
    compress_days:        input.compress_days,
    wallclock_budget_sec: input.wallclock_budget_sec,
    approver_policy:      policy,
    synthetic_voice:      voice,
    seed:                 sharedSeed,
    status:               'running',
    total_events:         timeline.length,
    started_at:           new Date().toISOString(),
    compare_group_id:     groupId,
  }))

  const insRes = await (input.db.from('simulation_runs' as never) as unknown as {
    insert: (rs: unknown[]) => { select: (c: string) => Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }> }
  }).insert(rows).select('id')
  if (insRes.error || !insRes.data) {
    return { ok: false, error: insRes.error?.message ?? 'insert_failed' }
  }

  // For A/B + LLM voices: pre-compute one body per event up-front so
  // all N policy runs share. Single LLM call per event regardless of
  // policy count. Best-effort + fail-soft: if pre-compute errors out,
  // engines fall back to live voiceLLM() on demand (same UX as solo runs).
  if (voice === 'llm') {
    // Fire-and-forget so the route returns fast (operator's UI redirects
    // to the comparison page; pre-compute fills the cache in the
    // background; engines hit the cache as they tick).
    void precomputeVoicesForSeed({
      db:            input.db,
      seed:          sharedSeed,
      compress_days: input.compress_days,
      business:      bizRes.data,
    }).catch((err: unknown) => {
      console.warn('[startAB] voice pre-compute failed (engines will fall back):', err instanceof Error ? err.message : err)
    })
  }

  return {
    ok:          true,
    group_id:    groupId,
    run_ids:     insRes.data.map(r => r.id),
    shared_seed: sharedSeed,
  }
}

export interface ABGroupSummary {
  group_id:    string
  runs: Array<{
    id:                string
    approver_policy:   ApproverPolicy
    status:            string
    current_event_idx: number
    total_events:      number
    result:            Record<string, unknown> | null
    started_at:        string | null
    ended_at:          string | null
  }>
  shared_seed:    string | null
  compress_days:  number | null
  business_slug:  string | null
  created_at:     string | null
}

/**
 * Fetch every run in an A/B group, sorted so the UI lays them out in
 * stable policy order. Used by GET /api/simulations/group/:gid.
 */
export async function loadABGroup(db: SupabaseClient, userId: string, groupId: string): Promise<ABGroupSummary | null> {
  const res = await (db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: Array<{ id: string; approver_policy: ApproverPolicy; status: string; current_event_idx: number; total_events: number; result: Record<string, unknown> | null; started_at: string | null; ended_at: string | null; seed: string; compress_days: number; business_slug: string; created_at: string }> | null }> } } }
  }).select('id, approver_policy, status, current_event_idx, total_events, result, started_at, ended_at, seed, compress_days, business_slug, created_at')
    .eq('compare_group_id', groupId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  const rows = res.data ?? []
  if (rows.length === 0) return null

  return {
    group_id:      groupId,
    runs:          rows.map(r => ({
      id:                r.id,
      approver_policy:   r.approver_policy,
      status:            r.status,
      current_event_idx: r.current_event_idx,
      total_events:      r.total_events,
      result:            r.result,
      started_at:        r.started_at,
      ended_at:          r.ended_at,
    })),
    shared_seed:   rows[0]?.seed         ?? null,
    compress_days: rows[0]?.compress_days ?? null,
    business_slug: rows[0]?.business_slug ?? null,
    created_at:    rows[0]?.created_at    ?? null,
  }
}

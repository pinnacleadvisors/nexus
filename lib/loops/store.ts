/**
 * lib/loops/store.ts — Supabase persistence for the Loops primitive.
 *
 * Centralises the untyped-shim query pattern (the `loops` /
 * `loop_iterations` tables are migrations 094/095 — not yet in the generated
 * Supabase types, same escape hatch as cost-guard's experiment_metrics
 * queries) and the fail-soft "migration not applied" detection (mirrors
 * app/api/cron/chat-retrospectives/route.ts), so every route degrades
 * identically when the operator hasn't applied the migrations yet.
 *
 * All functions return a discriminated `{ ok: true, ... } | { ok: false,
 * error }` so callers can return 200 + {ok:false} per the retry-storm rule
 * (schedulers / agents call these endpoints and auto-retry on 5xx).
 */

import { createServerClient } from '@/lib/supabase'
import type {
  Loop, LoopIteration, LoopSummary, LoopCreateInput, LoopPatchInput, LoopIterationResultInput,
} from './types'

// ── Loose PostgREST shim (loops/loop_iterations not in generated types) ──────

interface PgResult { data: unknown; error: { message: string } | null }
interface PgQuery extends PromiseLike<PgResult> {
  select(cols?: string):                       PgQuery
  insert(row: Record<string, unknown>):        PgQuery
  update(row: Record<string, unknown>):        PgQuery
  eq(col: string, val: unknown):               PgQuery
  in(col: string, vals: unknown[]):            PgQuery
  is(col: string, val: unknown):               PgQuery
  order(col: string, o: { ascending: boolean }): PgQuery
  limit(n: number):                            PgQuery
  single():                                    PgQuery
  maybeSingle():                               PgQuery
}
interface PgClient { from(table: string): PgQuery }

function client(): PgClient | null {
  const db = createServerClient()
  return db ? (db as unknown as PgClient) : null
}

export type StoreResult<T> = { ok: true } & T | { ok: false; error: string }

const SUPABASE_UNCONFIGURED = 'supabase_unconfigured'

/** Map a "table/column does not exist" error to the canonical migration hint. */
function migrationError(message: string): string | null {
  if (!message) return null
  if (/loop_iterations/i.test(message) && /(does not exist|find the table)/i.test(message)) {
    return 'migration_095_not_applied'
  }
  if (/\bloops\b/i.test(message) && /(does not exist|find the table)/i.test(message)) {
    return 'migration_094_not_applied'
  }
  if (/loop_id/i.test(message) && /does not exist/i.test(message)) {
    return 'migration_096_not_applied'
  }
  return null
}

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: migrationError(message) ?? message }
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createLoop(input: LoopCreateInput, userId: string): Promise<StoreResult<{ id: string }>> {
  const c = client()
  if (!c) return { ok: false, error: SUPABASE_UNCONFIGURED }
  const row: Record<string, unknown> = {
    user_id:              userId,
    business_slug:        input.business_slug ?? null,
    name:                 input.name,
    north_star_md:        input.north_star_md ?? '',
    end_outcome_md:       input.end_outcome_md ?? '',
    delegated_agent_slug: input.delegated_agent_slug,
    delegated_team_id:    input.delegated_team_id ?? null,
    cost_cap_usd:         input.cost_cap_usd ?? null,
    iteration_cap:        input.iteration_cap ?? null,
    time_cap_hours:       input.time_cap_hours ?? null,
    approval_gates:       input.approval_gates ?? [],
    mode:                 input.mode ?? 'iterate',
    explorer_model:       input.explorer_model ?? null,
    verifier_model:       input.verifier_model ?? null,
    review_modality:      input.review_modality ?? null,
  }
  try {
    const res = await c.from('loops').insert(row).select('id').single()
    if (res.error) return fail(res.error.message)
    return { ok: true, id: (res.data as { id: string }).id }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'create_failed')
  }
}

// ── List (with per-loop rollup) ───────────────────────────────────────────────

export async function listLoops(userId: string, businessSlug?: string | null): Promise<StoreResult<{ loops: LoopSummary[] }>> {
  const c = client()
  if (!c) return { ok: false, error: SUPABASE_UNCONFIGURED }
  try {
    let q = c.from('loops').select('*').eq('user_id', userId)
    if (businessSlug) q = q.eq('business_slug', businessSlug)
    const res = await q.order('created_at', { ascending: false })
    if (res.error) return fail(res.error.message)
    const loops = (res.data ?? []) as Loop[]
    if (loops.length === 0) return { ok: true, loops: [] }

    // One batched query for all iterations across these loops → aggregate in JS.
    const ids = loops.map(l => l.id)
    const itRes = await c.from('loop_iterations').select('loop_id, cost_usd, started_at, ended_at').in('loop_id', ids)
    const iterations = (itRes.error ? [] : (itRes.data ?? [])) as Array<{ loop_id: string; cost_usd: number | null; started_at: string; ended_at: string | null }>

    const byLoop = new Map<string, { count: number; cost: number; last: string | null }>()
    for (const it of iterations) {
      const agg = byLoop.get(it.loop_id) ?? { count: 0, cost: 0, last: null }
      agg.count += 1
      agg.cost  += it.cost_usd ?? 0
      const ts = it.ended_at ?? it.started_at
      if (ts && (!agg.last || ts > agg.last)) agg.last = ts
      byLoop.set(it.loop_id, agg)
    }

    const summaries: LoopSummary[] = loops.map(l => {
      const agg = byLoop.get(l.id) ?? { count: 0, cost: 0, last: null }
      return { ...l, iteration_count: agg.count, total_cost_usd: agg.cost, last_activity: agg.last ?? l.created_at }
    })
    return { ok: true, loops: summaries }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'list_failed')
  }
}

// ── Read one ───────────────────────────────────────────────────────────────────

export async function getLoop(id: string, userId: string): Promise<StoreResult<{ loop: Loop | null }>> {
  const c = client()
  if (!c) return { ok: false, error: SUPABASE_UNCONFIGURED }
  try {
    const res = await c.from('loops').select('*').eq('id', id).eq('user_id', userId).maybeSingle()
    if (res.error) return fail(res.error.message)
    return { ok: true, loop: (res.data as Loop | null) ?? null }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'read_failed')
  }
}

export async function getLoopWithIterations(id: string, userId: string): Promise<StoreResult<{ loop: Loop | null; iterations: LoopIteration[] }>> {
  const base = await getLoop(id, userId)
  if (!base.ok) return base
  if (!base.loop) return { ok: true, loop: null, iterations: [] }
  return withIterations(base.loop)
}

/**
 * Service-scoped fetch by id ONLY (no user filter). Used exclusively by the
 * iteration-result callback path, which is authed by the per-loop HMAC token
 * rather than an operator session — so there's no userId to scope by.
 */
export async function getLoopByIdService(id: string): Promise<StoreResult<{ loop: Loop | null; iterations: LoopIteration[] }>> {
  const c = client()
  if (!c) return { ok: false, error: SUPABASE_UNCONFIGURED }
  try {
    const res = await c.from('loops').select('*').eq('id', id).maybeSingle()
    if (res.error) return fail(res.error.message)
    const loop = (res.data as Loop | null) ?? null
    if (!loop) return { ok: true, loop: null, iterations: [] }
    return withIterations(loop)
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'read_failed')
  }
}

async function withIterations(loop: Loop): Promise<StoreResult<{ loop: Loop | null; iterations: LoopIteration[] }>> {
  const c = client()!
  try {
    const res = await c.from('loop_iterations').select('*').eq('loop_id', loop.id).order('iteration_n', { ascending: true })
    const iterations = (res.error ? [] : (res.data ?? [])) as LoopIteration[]
    return { ok: true, loop, iterations }
  } catch {
    return { ok: true, loop, iterations: [] }
  }
}

// ── Patch (operator controls) ──────────────────────────────────────────────────

export async function patchLoop(id: string, userId: string, patch: LoopPatchInput): Promise<StoreResult<{ loop: Loop }>> {
  const c = client()
  if (!c) return { ok: false, error: SUPABASE_UNCONFIGURED }
  const row: Record<string, unknown> = {}
  if (patch.status        !== undefined) row.status         = patch.status
  if (patch.cost_cap_usd  !== undefined) row.cost_cap_usd   = patch.cost_cap_usd
  if (patch.iteration_cap !== undefined) row.iteration_cap  = patch.iteration_cap
  if (patch.time_cap_hours !== undefined) row.time_cap_hours = patch.time_cap_hours
  // Terminal statuses stamp ended_at.
  if (patch.status === 'done' || patch.status === 'killed') row.ended_at = new Date().toISOString()
  if (patch.status === 'active') row.ended_at = null
  if (Object.keys(row).length === 0) return { ok: false, error: 'empty_patch' }
  try {
    const res = await c.from('loops').update(row).eq('id', id).eq('user_id', userId).select('*').maybeSingle()
    if (res.error) return fail(res.error.message)
    if (!res.data) return { ok: false, error: 'not_found' }
    return { ok: true, loop: res.data as Loop }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'patch_failed')
  }
}

// ── Iterations ──────────────────────────────────────────────────────────────────

export async function nextIterationN(loopId: string): Promise<number> {
  const c = client()
  if (!c) return 1
  try {
    const res = await c.from('loop_iterations').select('iteration_n').eq('loop_id', loopId).order('iteration_n', { ascending: false }).limit(1).maybeSingle()
    const row = res.data as { iteration_n: number } | null
    return row ? row.iteration_n + 1 : 1
  } catch {
    return 1
  }
}

export async function insertIteration(loopId: string, iterationN: number, opts: { iteration_plan_id?: string | null; scope?: string | null; intent?: string | null } = {}): Promise<StoreResult<{ id: string }>> {
  const c = client()
  if (!c) return { ok: false, error: SUPABASE_UNCONFIGURED }
  try {
    const res = await c.from('loop_iterations').insert({
      loop_id:           loopId,
      iteration_n:       iterationN,
      iteration_plan_id: opts.iteration_plan_id ?? null,
      scope:             opts.scope ?? null,
      intent:            opts.intent ?? null,
      outcome:           'running',
    }).select('id').single()
    if (res.error) return fail(res.error.message)
    return { ok: true, id: (res.data as { id: string }).id }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'insert_iteration_failed')
  }
}

/** Resolve the running iteration for a loop (or insert one if none is open). */
export async function resolveIteration(loopId: string, result: LoopIterationResultInput): Promise<StoreResult<{ id: string }>> {
  const c = client()
  if (!c) return { ok: false, error: SUPABASE_UNCONFIGURED }
  const patch: Record<string, unknown> = {
    outcome:     result.outcome,
    ended_at:    new Date().toISOString(),
    summary_md:  result.summary_md ?? null,
    cost_usd:    result.cost_usd ?? 0,
  }
  if (result.gateway_turn_ids) patch.gateway_turn_ids = result.gateway_turn_ids
  if (result.scope !== undefined) patch.scope = result.scope
  if (result.intent !== undefined) patch.intent = result.intent
  if (result.iteration_plan_id !== undefined) patch.iteration_plan_id = result.iteration_plan_id
  try {
    // Match the row by (loop_id, iteration_n) — the unique index guarantees one.
    const upd = await c.from('loop_iterations').update(patch).eq('loop_id', loopId).eq('iteration_n', result.iteration_n).select('id').maybeSingle()
    if (upd.error) return fail(upd.error.message)
    if (upd.data) return { ok: true, id: (upd.data as { id: string }).id }
    // No matching row (start was skipped / lost) — insert a resolved one.
    const ins = await c.from('loop_iterations').insert({
      loop_id:           loopId,
      iteration_n:       result.iteration_n,
      iteration_plan_id: result.iteration_plan_id ?? null,
      scope:             result.scope ?? null,
      intent:            result.intent ?? null,
      ...patch,
    }).select('id').single()
    if (ins.error) return fail(ins.error.message)
    return { ok: true, id: (ins.data as { id: string }).id }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'resolve_iteration_failed')
  }
}

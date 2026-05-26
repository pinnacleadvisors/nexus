/**
 * lib/simulation/engine.ts — hyperbolic-chamber orchestrator (PR #364,
 * task_plan-hyperbolic-chamber.md).
 *
 * One entry point per operation:
 *   - startRun(opts)            → create simulation_runs row, generate timeline
 *   - tickOnce(db, runId)       → process exactly ONE event (manual-mode)
 *   - runToCompletion(db, id)   → drain remaining events (auto-mode)
 *   - decideManualGate(...)     → record operator approve/reject + advance
 *
 * The engine is timeline-regenerative: each call re-runs generateTimeline()
 * from the run's stored seed instead of persisting the full timeline. This
 * is cheap (poisson + uniform sampling is fast) and means we don't need a
 * second table for the script. Same seed → same script.
 *
 * Safety:
 *   - All paid LLM dispatches inside the run are short-circuited by the
 *     existing simulation cost-guard (lib/cost-guard.ts) — this engine
 *     records what would have been dispatched, never hits a gateway.
 *   - 25-second per-call wallclock cap so Next.js function timeouts don't
 *     mid-process a tick. Caller resumes with another POST.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateTimeline, type SimEvent, type BusinessSnapshot } from './timeline'
import { decideApproval, type ApproverPolicy } from './auto-approver'
import { gradeRun } from './grader'
import { voiceTemplate, voiceLLM } from './persona-voice'
import { SIM_PERSONAS, type SimulationPersona } from './personas'

const PER_CALL_WALLCLOCK_BUDGET_MS = 25_000
const MAX_EVENTS_PER_CALL          = 5_000

// ── Helpers ──────────────────────────────────────────────────────────────────

interface RunRow {
  id:                    string
  user_id:               string
  business_slug:         string
  mode:                  'manual' | 'auto'
  compress_days:         number
  wallclock_budget_sec:  number
  approver_policy:       ApproverPolicy | null
  seed:                  string
  status:                string
  current_event_idx:     number
  total_events:          number
  started_at:            string | null
  synthetic_voice:       'template' | 'llm' | null
}

async function loadRun(db: SupabaseClient, runId: string): Promise<RunRow | null> {
  const res = await (db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: RunRow | null }> } }
  }).select('*').eq('id', runId).maybeSingle()
  return res.data
}

async function loadBusiness(db: SupabaseClient, slug: string): Promise<(BusinessSnapshot & { simulation?: boolean }) | null> {
  const res = await (db.from('business_operators' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: (BusinessSnapshot & { simulation?: boolean }) | null }> } }
  }).select('niche, money_model, kpi_targets, approval_gates, simulation').eq('slug', slug).maybeSingle()
  return res.data
}

function regenerateTimeline(run: RunRow, biz: BusinessSnapshot | null): SimEvent[] {
  return generateTimeline({ seed: run.seed, compress_days: run.compress_days, business: biz })
}

async function synthesizeOutcome(
  event: SimEvent,
  voiceMode: 'template' | 'llm',
  run: RunRow,
): Promise<Record<string, unknown>> {
  switch (event.kind) {
    case 'inbound_ticket': {
      const payload = event.payload as { persona_id?: string; archetype?: string; title?: string }
      const persona = SIM_PERSONAS.find(p => p.id === payload.persona_id)
        ?? ({ id: 'unknown', name: 'Anon', email: 'anon@example.org', archetype: 'happy_customer', notes: '', weight: 1, voice: 'casual' } as SimulationPersona)
      const ticketSeed = {
        title:     String(payload.title ?? 'general inquiry'),
        archetype: persona.archetype,
        sim_day:   event.sim_day,
        sim_hour:  event.sim_hour,
      }
      // Use a tiny per-event RNG seeded from run.seed + indices so the
      // template scramble is deterministic across replays.
      const rng = () => {
        const seed = `${run.seed}:t:${event.sim_day}:${event.sim_hour}`
        let h = 1779033703 ^ seed.length
        for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
        return ((h >>> 0) % 1_000_000) / 1_000_000
      }
      const body = voiceMode === 'llm'
        ? await voiceLLM(persona, ticketSeed)
        : voiceTemplate(persona, ticketSeed, rng)
      return {
        triaged_to: 'sales-support',
        priority:   1 + Math.floor(Math.random() * 3),
        body,
      }
    }
    case 'agent_action':
      return {
        dispatched:           false,
        reason:               'simulation_mode_short_circuit',
        simulated_duration_sec: 10 + Math.floor(Math.random() * 60),
      }
    case 'kpi_snapshot':
      return event.payload   // mirror back so the grader can read it from outcome
    case 'failure':
      return { remediated: Math.random() < 0.7 }
    case 'churn':
      // Customer walked away. Record what we lost (synthetic LTV) so
      // the grader can subtract it from sim_net_cents.
      return {
        lost_customer_ltv_cents: 5_000 + Math.floor(Math.random() * 25_000),
        notified_to:             'sales-cs',
      }
    default:
      return {}
  }
}

// ── startRun ─────────────────────────────────────────────────────────────────

export interface StartRunInput {
  db:                   SupabaseClient
  userId:               string
  businessSlug:         string
  mode:                 'manual' | 'auto'
  compress_days:        number
  wallclock_budget_sec: number
  approver_policy?:     ApproverPolicy
  synthetic_voice?:     'template' | 'llm'
}

export interface StartRunResult {
  ok:        boolean
  run_id?:   string
  error?:    string
  reused?:   boolean
}

export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  const biz = await loadBusiness(input.db, input.businessSlug)
  if (!biz) return { ok: false, error: 'business_not_found' }
  if (!biz.simulation) return { ok: false, error: 'not_a_simulation_business' }

  if (input.mode === 'auto' && !input.approver_policy) {
    return { ok: false, error: 'approver_policy_required_for_auto_mode' }
  }

  // Refuse if there's already a live run — UI redirects to existing
  const existing = await (input.db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { in: (c: string, vs: string[]) => { maybeSingle: () => Promise<{ data: { id: string } | null }> } } }
  }).select('id').eq('business_slug', input.businessSlug).in('status', ['pending', 'running', 'paused']).maybeSingle()
  if (existing.data) return { ok: true, run_id: existing.data.id, reused: true }

  const seed = `${input.businessSlug}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const timeline = generateTimeline({ seed, compress_days: input.compress_days, business: biz })

  const ins = await (input.db.from('simulation_runs' as never) as unknown as {
    insert: (r: unknown) => { select: (c: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } }
  }).insert({
    user_id:              input.userId,
    business_slug:        input.businessSlug,
    mode:                 input.mode,
    compress_days:        input.compress_days,
    wallclock_budget_sec: input.wallclock_budget_sec,
    approver_policy:      input.approver_policy ?? null,
    seed,
    status:               'running',
    total_events:         timeline.length,
    started_at:           new Date().toISOString(),
    synthetic_voice:      input.synthetic_voice ?? 'template',
  }).select('id').single()
  if (ins.error || !ins.data) return { ok: false, error: ins.error?.message ?? 'insert_failed' }

  return { ok: true, run_id: ins.data.id }
}

// ── tickOnce — process exactly one event ─────────────────────────────────────

export interface TickResult {
  ok:            boolean
  done?:         boolean
  paused_gate?:  { event_id: string; sim_day: number; sim_hour: number; payload: Record<string, unknown> }
  processed_kind?: string
  next_idx?:     number
  total_events?: number
  error?:        string
}

export async function tickOnce(db: SupabaseClient, runId: string): Promise<TickResult> {
  const run = await loadRun(db, runId)
  if (!run) return { ok: false, error: 'run_not_found' }
  if (run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') {
    return { ok: true, done: true }
  }

  const biz = await loadBusiness(db, run.business_slug)
  const timeline = regenerateTimeline(run, biz)
  const event = timeline[run.current_event_idx]

  if (!event) {
    await gradeRun(db, runId)
    return { ok: true, done: true, total_events: run.total_events }
  }

  // Approval gate in manual mode → pause + persist pending event
  if (event.kind === 'approval_gate' && run.mode === 'manual') {
    const ins = await (db.from('simulation_events' as never) as unknown as {
      insert: (r: unknown) => { select: (c: string) => { single: () => Promise<{ data: { id: string } | null }> } }
    }).insert({
      run_id:         runId,
      sim_day:        event.sim_day,
      sim_hour:       event.sim_hour,
      kind:           event.kind,
      payload:        event.payload,
      approval_state: 'pending',
    }).select('id').single()
    await (db.from('simulation_runs' as never) as unknown as {
      update: (r: unknown) => { eq: (c: string, v: string) => Promise<unknown> }
    }).update({ status: 'paused' }).eq('id', runId)
    return {
      ok: true,
      paused_gate: {
        event_id: ins.data?.id ?? '',
        sim_day:  event.sim_day,
        sim_hour: event.sim_hour,
        payload:  event.payload,
      },
      next_idx: run.current_event_idx,
      total_events: run.total_events,
    }
  }

  // Approval gate in auto mode → auto-decide
  if (event.kind === 'approval_gate' && run.mode === 'auto' && run.approver_policy) {
    const dec = decideApproval(event, run.approver_policy, `${run.seed}:${run.current_event_idx}`)
    await (db.from('simulation_events' as never) as unknown as {
      insert: (r: unknown) => Promise<unknown>
    }).insert({
      run_id:         runId,
      sim_day:        event.sim_day,
      sim_hour:       event.sim_hour,
      kind:           event.kind,
      payload:        event.payload,
      approval_state: dec.decision === 'approve' ? 'auto_approved' : 'auto_rejected',
      approved_by:    `auto:${run.approver_policy}`,
      decided_at:     new Date().toISOString(),
      outcome:        { rationale: dec.rationale },
    })
    await (db.from('simulation_runs' as never) as unknown as {
      update: (r: unknown) => { eq: (c: string, v: string) => Promise<unknown> }
    }).update({
      current_event_idx: run.current_event_idx + 1,
      current_sim_day:   event.sim_day,
      status:            'running',
    }).eq('id', runId)
    return {
      ok: true,
      processed_kind: 'approval_gate',
      next_idx:       run.current_event_idx + 1,
      total_events:   run.total_events,
    }
  }

  // Non-gate event → process immediately
  const voiceMode = (run.synthetic_voice ?? 'template') as 'template' | 'llm'
  const outcome   = await synthesizeOutcome(event, voiceMode, run)
  await (db.from('simulation_events' as never) as unknown as {
    insert: (r: unknown) => Promise<unknown>
  }).insert({
    run_id:   runId,
    sim_day:  event.sim_day,
    sim_hour: event.sim_hour,
    kind:     event.kind,
    payload:  event.payload,
    outcome,
  })
  await (db.from('simulation_runs' as never) as unknown as {
    update: (r: unknown) => { eq: (c: string, v: string) => Promise<unknown> }
  }).update({
    current_event_idx: run.current_event_idx + 1,
    current_sim_day:   event.sim_day,
    status:            'running',
  }).eq('id', runId)

  return {
    ok: true,
    processed_kind: event.kind,
    next_idx:       run.current_event_idx + 1,
    total_events:   run.total_events,
  }
}

// ── runToCompletion — auto-mode batch runner ─────────────────────────────────

export interface RunToCompletionResult {
  ok:               boolean
  processed:        number
  final_status:     string
  error?:           string
}

export async function runToCompletion(db: SupabaseClient, runId: string): Promise<RunToCompletionResult> {
  const start = Date.now()
  let processed = 0

  for (let i = 0; i < MAX_EVENTS_PER_CALL; i++) {
    const run = await loadRun(db, runId)
    if (!run) return { ok: false, processed, final_status: 'unknown', error: 'run_not_found' }

    if (run.started_at) {
      const elapsedSec = (Date.now() - new Date(run.started_at).getTime()) / 1000
      if (elapsedSec > run.wallclock_budget_sec) {
        await (db.from('simulation_runs' as never) as unknown as {
          update: (r: unknown) => { eq: (c: string, v: string) => Promise<unknown> }
        }).update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', runId)
        return { ok: true, processed, final_status: 'failed' }
      }
    }

    const tick = await tickOnce(db, runId)
    if (!tick.ok) return { ok: false, processed, final_status: 'errored', error: tick.error }
    if (tick.done) return { ok: true, processed, final_status: 'done' }
    if (tick.paused_gate) return { ok: true, processed, final_status: 'paused' }
    processed++

    if (Date.now() - start > PER_CALL_WALLCLOCK_BUDGET_MS) {
      // Caller should re-POST to drain the rest
      return { ok: true, processed, final_status: 'running' }
    }
  }
  return { ok: true, processed, final_status: 'running' }
}

// ── decideManualGate — operator approve/reject a pending gate ────────────────

export async function decideManualGate(
  db: SupabaseClient,
  runId: string,
  eventId: string,
  decision: 'approve' | 'reject',
): Promise<{ ok: boolean; advanced?: boolean; error?: string }> {
  const run = await loadRun(db, runId)
  if (!run) return { ok: false, error: 'run_not_found' }
  if (run.status !== 'paused') return { ok: false, error: `not_paused:${run.status}` }

  const upd = await (db.from('simulation_events' as never) as unknown as {
    update: (r: unknown) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> } }
  }).update({
    approval_state: decision === 'approve' ? 'approved' : 'rejected',
    approved_by:    'operator',
    decided_at:     new Date().toISOString(),
  }).eq('id', eventId).eq('run_id', runId)
  if (upd.error) return { ok: false, error: upd.error.message }

  await (db.from('simulation_runs' as never) as unknown as {
    update: (r: unknown) => { eq: (c: string, v: string) => Promise<unknown> }
  }).update({
    current_event_idx: run.current_event_idx + 1,
    status:            'running',
  }).eq('id', runId)
  return { ok: true, advanced: true }
}

export async function cancelRun(db: SupabaseClient, runId: string): Promise<{ ok: boolean }> {
  await (db.from('simulation_runs' as never) as unknown as {
    update: (r: unknown) => { eq: (c: string, v: string) => Promise<unknown> }
  }).update({ status: 'cancelled', ended_at: new Date().toISOString() }).eq('id', runId)
  return { ok: true }
}

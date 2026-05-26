/**
 * lib/simulation/voice-cache.ts — pre-compute + read-through cache for
 * LLM-generated ticket bodies (PR #380).
 *
 * Wired by:
 *   - lib/simulation/multi.ts startAB() — pre-populates the cache at
 *     A/B-group creation time so all N policy runs read the same
 *     bodies. One LLM call per event, regardless of policy count.
 *   - lib/simulation/engine.ts — engine reads the cache before falling
 *     back to a live voiceLLM() call. Solo runs that haven't been
 *     pre-populated still hit voiceLLM() on demand.
 *
 * Cache key = (seed, sim_day, sim_hour, persona_id). All four match
 * the deterministic Monte Carlo timeline, so the engine can rebuild
 * the lookup key from the event + run row without extra context.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateTimeline } from './timeline'
import { voiceLLM } from './persona-voice'
import { SIM_PERSONAS } from './personas'

// Cap so a malicious / misconfigured run can't fan out into thousands
// of parallel LLM calls. 30 sim-days × ~3 tickets/day = ~90 events;
// 200 leaves a 2× headroom.
const MAX_PARALLEL_LLM_CALLS = 200
const LLM_CALL_TIMEOUT_MS    = 30_000

interface PrecomputeInput {
  db:            SupabaseClient
  seed:          string
  compress_days: number
  /** Optional — passed to the timeline generator. Don't have to match anything. */
  business?:     { approval_gates?: string[] | null } | null
}

export interface PrecomputeResult {
  ok:        boolean
  cached:    number     // newly written rows
  reused:    number     // rows already present (idempotent re-run)
  skipped:   number     // events that weren't inbound_ticket (no body needed)
  errors:    number
}

interface CachedRow {
  sim_day:    number
  sim_hour:   number
  persona_id: string
  body:       string
}

/**
 * Read the cache lazily for a single event. Returns null on miss; engine
 * falls back to voiceLLM() then optionally writes-through. Idempotent.
 */
export async function readCachedVoice(
  db:        SupabaseClient,
  seed:      string,
  sim_day:   number,
  sim_hour:  number,
  personaId: string,
): Promise<string | null> {
  try {
    const res = await (db.from('simulation_voice_cache' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: number) => { eq: (c: string, v: number) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { body: string } | null }> } } } } }
    }).select('body').eq('seed', seed).eq('sim_day', sim_day).eq('sim_hour', sim_hour).eq('persona_id', personaId).maybeSingle()
    return res.data?.body ?? null
  } catch {
    return null
  }
}

/** Write-through after a live voiceLLM() call. Best-effort; non-fatal on conflict. */
export async function writeCachedVoice(
  db:        SupabaseClient,
  seed:      string,
  sim_day:   number,
  sim_hour:  number,
  personaId: string,
  body:      string,
): Promise<void> {
  try {
    await (db.from('simulation_voice_cache' as never) as unknown as {
      upsert: (r: unknown, opts: { onConflict: string }) => Promise<unknown>
    }).upsert({
      seed, sim_day, sim_hour, persona_id: personaId, body,
    }, { onConflict: 'seed,sim_day,sim_hour,persona_id' })
  } catch { /* fail silent — cache is a perf opt, not correctness */ }
}

/**
 * Pre-populate the cache for every inbound_ticket event in the timeline
 * derived from this seed. Idempotent: skips rows already cached.
 *
 * Parallelism bounded by MAX_PARALLEL_LLM_CALLS so we don't exhaust the
 * upstream LLM's rate-limit on a single A/B start.
 */
export async function precomputeVoicesForSeed(input: PrecomputeInput): Promise<PrecomputeResult> {
  const events = generateTimeline({
    seed:          input.seed,
    compress_days: input.compress_days,
    business:      input.business ?? null,
  })

  // Find which (sim_day, sim_hour, persona_id) coords already exist.
  // One read; the unique-PK index serves it cheaply.
  let existing = new Set<string>()
  try {
    const res = await (input.db.from('simulation_voice_cache' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => Promise<{ data: CachedRow[] | null }> }
    }).select('sim_day, sim_hour, persona_id').eq('seed', input.seed)
    existing = new Set((res.data ?? []).map(r => `${r.sim_day}:${r.sim_hour}:${r.persona_id}`))
  } catch { /* fail open — we'll re-upsert anything */ }

  // Filter to inbound_ticket events that aren't already cached.
  const toGenerate = events.filter(ev => {
    if (ev.kind !== 'inbound_ticket') return false
    const p = ev.payload as { persona_id?: string }
    if (!p.persona_id) return false
    const key = `${ev.sim_day}:${ev.sim_hour}:${p.persona_id}`
    return !existing.has(key)
  })

  let cached  = 0
  let errors  = 0
  const reused  = events.filter(e => e.kind === 'inbound_ticket').length - toGenerate.length
  const skipped = events.length - events.filter(e => e.kind === 'inbound_ticket').length

  // Process in parallel batches.
  for (let i = 0; i < toGenerate.length; i += MAX_PARALLEL_LLM_CALLS) {
    const batch = toGenerate.slice(i, i + MAX_PARALLEL_LLM_CALLS)
    const results = await Promise.allSettled(batch.map(async ev => {
      const payload = ev.payload as { persona_id?: string; title?: string }
      const persona = SIM_PERSONAS.find(p => p.id === payload.persona_id)
      if (!persona) return { ok: false }
      const body = await voiceLLM(persona, {
        title:     String(payload.title ?? 'general inquiry'),
        archetype: persona.archetype,
        sim_day:   ev.sim_day,
        sim_hour:  ev.sim_hour,
      }, { signal: AbortSignal.timeout(LLM_CALL_TIMEOUT_MS) })
      await writeCachedVoice(input.db, input.seed, ev.sim_day, ev.sim_hour, persona.id, body)
      return { ok: true }
    }))
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.ok) cached++
      else errors++
    }
  }

  return { ok: errors === 0, cached, reused, skipped, errors }
}

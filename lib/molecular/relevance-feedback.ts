/**
 * Relevance feedback loop — Mission Control Kit Pack 06's third leg.
 *
 * After every /api/chat turn, we want to know: of the atoms the model had
 * access to, which ones did the response actually reference? Bump those.
 * Decay the rest by a small amount.
 *
 * Two paths:
 *   1. recordReferences — synchronous, called when the caller already knows
 *      which atom slugs the response cited (e.g. it parsed `[[slug]]` links).
 *      Cheap and deterministic.
 *   2. inferAndRecordReferences — fire-and-forget, runs a Haiku check to
 *      decide which slugs were actually used. More accurate when the model
 *      paraphrases without citing slugs explicitly. Bounded — if Haiku is
 *      unreachable, we silently no-op.
 *
 * Both update salience + last_used_at on the matched atoms; both log a
 * compact audit row so we can trace why an atom's salience moved.
 */

import { createServerClient } from '@/lib/supabase'
import { audit } from '@/lib/audit'
import type { NextRequest } from 'next/server'

// mol_atoms isn't in lib/database.types.ts yet — same escape-hatch shim.
type LooseChain = {
  select: (cols: string) => LooseChain
  eq:     (k: string, v: unknown) => LooseChain
  in:     (k: string, v: readonly unknown[]) => LooseChain
  update: (patch: Record<string, unknown>) => LooseChain
  then:   <T>(onfulfilled: (v: { data: unknown; error: { message: string } | null }) => T) => Promise<T>
}
function looseFrom(db: ReturnType<typeof createServerClient>, table: string): LooseChain {
  return (db as unknown as { from: (t: string) => LooseChain }).from(table)
}

const SALIENCE_BUMP   = 0.1
const SALIENCE_DECAY  = 0.01
const SALIENCE_MAX    = 1.0
const SALIENCE_MIN    = 0.0

export interface RecordOpts {
  /** Atoms that were available in the agent's "Relevant memories" block. */
  candidates:   Array<{ scopeId: string; slug: string }>
  /** Atom slugs that the model actually used. Subset of candidates. */
  usedSlugs:    string[]
  /** Optional NextRequest used by the audit() helper for IP capture. */
  req?:         NextRequest
  userId?:      string
}

interface RawAtom { slug: string; scope_id: string; salience: number | null }

/** Bump salience for used atoms; decay unused ones. Returns row counts. */
export async function recordReferences(opts: RecordOpts): Promise<{ bumped: number; decayed: number }> {
  const db = createServerClient()
  if (!db || !opts.candidates.length) return { bumped: 0, decayed: 0 }

  const usedSet = new Set(opts.usedSlugs)
  // Pull current salience for the candidate set.
  const { data: rowsRaw, error } = await looseFrom(db, 'mol_atoms')
    .select('slug, scope_id, salience')
    .in('slug', opts.candidates.map(c => c.slug))
  if (error || !rowsRaw) return { bumped: 0, decayed: 0 }
  const rows = rowsRaw as RawAtom[]

  let bumped = 0, decayed = 0
  const now = new Date().toISOString()

  // Two separate updates — one for bumps, one for decays. Cheaper than
  // running per-row UPDATEs since each set shares a delta.
  const toBump   = rows.filter(r => usedSet.has(r.slug))
  const toDecay  = rows.filter(r => !usedSet.has(r.slug))

  // Per-row updates because each row's new salience depends on its current
  // value (clamped). Postgres function `least`/`greatest` would let us batch
  // it; tradeoff is a tiny extra round-trip per atom which is fine for K≤10.
  for (const r of toBump) {
    const current = r.salience ?? 0.5
    const next    = Math.min(SALIENCE_MAX, current + SALIENCE_BUMP)
    if (next === current) continue
    await looseFrom(db, 'mol_atoms')
      .update({ salience: next, last_used_at: now })
      .eq('scope_id', r.scope_id)
      .eq('slug', r.slug)
    bumped++
  }
  for (const r of toDecay) {
    const current = r.salience ?? 0.5
    const next    = Math.max(SALIENCE_MIN, current - SALIENCE_DECAY)
    if (next === current) continue
    await looseFrom(db, 'mol_atoms')
      .update({ salience: next })
      .eq('scope_id', r.scope_id)
      .eq('slug', r.slug)
    decayed++
  }

  if (opts.req) {
    audit(opts.req, {
      action:   'memory.relevance_feedback',
      resource: 'mol_atoms',
      userId:   opts.userId,
      metadata: { candidates: opts.candidates.length, used: opts.usedSlugs.length, bumped, decayed },
    })
  }

  return { bumped, decayed }
}

/**
 * Heuristic-only inference: any candidate slug whose title or body fragment
 * appears verbatim in the response counts as "used." Cheap and deterministic;
 * no LLM call. The kit's pattern uses Gemini Flash for this — we keep the
 * cheaper path here and let callers wire in an LLM check upstream if they
 * want it.
 */
export function inferUsedSlugs(
  responseText: string,
  candidates: Array<{ slug: string; title: string; body?: string }>,
): string[] {
  if (!responseText || !candidates.length) return []
  const lower = responseText.toLowerCase()
  const used: string[] = []
  for (const c of candidates) {
    const titleHit = c.title && lower.includes(c.title.toLowerCase())
    // Pull the first sentence (~12 words) from the body for the body match —
    // matching the whole body is too lenient and matching the slug alone is
    // too strict.
    const fragment = (c.body ?? '').split(/[.!?\n]/)[0]?.trim().toLowerCase()
    const bodyHit  = fragment && fragment.length > 12 && lower.includes(fragment.slice(0, 60))
    if (titleHit || bodyHit) used.push(c.slug)
  }
  return used
}

/**
 * Hybrid memory search — Mission Control Kit Pack 06 ported to Postgres.
 *
 * Combines three independent rankings via Reciprocal Rank Fusion (RRF):
 *
 *   1. Full-text search (Postgres `to_tsvector` GIN index, already on mol_atoms)
 *   2. Vector cosine similarity (pgvector ivfflat, already on mol_atoms)
 *   3. Salience boost (column added in migration 029)
 *
 * The kit uses SQLite + FTS5 + sqlite-vec; we use Postgres + pgvector for
 * cloud parity. Output: top-K atoms ranked by combined score.
 *
 * Atoms with `superseded_by IS NOT NULL` are excluded by default (ADD-only
 * memory pattern from kit's paradigms.md — the older atom stays for history
 * but doesn't surface in retrieval).
 *
 * Empty embedding input → keyword + salience only. Empty query → salience
 * + recency only. This matches the kit's "tiered degradation" pattern: the
 * caller doesn't have to provide every signal for retrieval to work.
 */

import { createServerClient } from '@/lib/supabase'

// mol_atoms isn't in lib/database.types.ts yet — same escape hatch as
// lib/memory/supabase-reader.ts and lib/business/db.ts.
type LooseChain = {
  select:    (cols: string) => LooseChain
  eq:        (k: string, v: unknown) => LooseChain
  is:        (k: string, v: unknown) => LooseChain
  in:        (k: string, v: readonly unknown[]) => LooseChain
  or:        (q: string) => LooseChain
  order:     (k: string, opts: { ascending: boolean }) => LooseChain
  limit:     (n: number) => LooseChain
  ilike:     (k: string, p: string) => LooseChain
  insert:    (rec: unknown) => LooseChain
  update:    (patch: Record<string, unknown>) => LooseChain
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>
  single:    () => Promise<{ data: unknown; error: { message: string } | null }>
  then:      <T>(onfulfilled: (v: { data: unknown; error: { message: string } | null }) => T) => Promise<T>
}
type LooseRpc = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>

function looseFrom(db: ReturnType<typeof createServerClient>, table: string): LooseChain {
  return (db as unknown as { from: (t: string) => LooseChain }).from(table)
}
function looseRpc(db: ReturnType<typeof createServerClient>): LooseRpc {
  return ((db as unknown as { rpc: LooseRpc }).rpc)
}

export interface HybridAtom {
  slug:        string
  scopeId:     string
  title:       string
  body:        string
  salience:    number
  pinned:      boolean
  lastUsedAt:  string | null
  scores:      { fts: number; vec: number; salience: number; combined: number }
}

export interface HybridSearchOpts {
  /** Plain-text query — used by FTS5. Optional. */
  query?:        string
  /** Embedding for `query` (1536-dim). Optional — if missing, vector pass is skipped. */
  embedding?:    number[]
  /** Optional scope filter — limit to one scope (e.g. 'pinnacleadvisors-nexus'). */
  scopeId?:      string
  /** How many candidates per signal before fusion. Default 20. */
  perSignalK?:   number
  /** Final top-K after fusion. Default 10. */
  topK?:         number
  /** RRF constant. Default 60 — common practice. */
  rrfK?:         number
  /** Include superseded atoms (older versions). Default false. */
  includeSuperseded?: boolean
}

interface RawAtomRow {
  slug: string
  scope_id: string
  title: string
  body_md: string | null
  salience: number | null
  pinned: boolean | null
  last_used_at: string | null
  rank?: number
  distance?: number
}

const DEFAULT_PER_SIGNAL = 20
const DEFAULT_TOP_K      = 10
const DEFAULT_RRF_K      = 60

/** Run all three signals in parallel and fuse via RRF. */
export async function hybridSearch(opts: HybridSearchOpts): Promise<HybridAtom[]> {
  const db = createServerClient()
  if (!db) return []
  const perSignal = opts.perSignalK ?? DEFAULT_PER_SIGNAL
  const topK      = opts.topK       ?? DEFAULT_TOP_K
  const rrfK      = opts.rrfK       ?? DEFAULT_RRF_K
  const includeSup = opts.includeSuperseded ?? false

  const [fts, vec, sal] = await Promise.all([
    fetchFts(opts.query, opts.scopeId, perSignal, includeSup),
    fetchVec(opts.embedding, opts.scopeId, perSignal, includeSup),
    fetchSal(opts.scopeId, perSignal, includeSup),
  ])

  // RRF fusion — each atom gets a contribution per signal of 1 / (rrfK + rank).
  const scores = new Map<string, { atom: RawAtomRow; fts: number; vec: number; salience: number }>()
  function addContribution(rows: RawAtomRow[], field: 'fts' | 'vec' | 'salience') {
    rows.forEach((row, rank) => {
      const key = `${row.scope_id}:${row.slug}`
      let entry = scores.get(key)
      if (!entry) {
        entry = { atom: row, fts: 0, vec: 0, salience: 0 }
        scores.set(key, entry)
      }
      entry[field] += 1 / (rrfK + rank + 1)
    })
  }
  addContribution(fts, 'fts')
  addContribution(vec, 'vec')
  addContribution(sal, 'salience')

  const fused: HybridAtom[] = Array.from(scores.values()).map(({ atom, fts: ftsS, vec: vecS, salience: salS }) => {
    // Pinned atoms always get a small bonus so they don't sink under decay.
    const pinned   = Boolean(atom.pinned)
    const baseSal  = atom.salience ?? 0.5
    const pinBonus = pinned ? 0.15 : 0
    const combined = ftsS + vecS + salS + (baseSal * 0.05) + pinBonus
    return {
      slug:       atom.slug,
      scopeId:    atom.scope_id,
      title:      atom.title,
      body:       atom.body_md ?? '',
      salience:   baseSal,
      pinned,
      lastUsedAt: atom.last_used_at,
      scores:     { fts: ftsS, vec: vecS, salience: salS, combined },
    }
  })

  fused.sort((a, b) => b.scores.combined - a.scores.combined)
  return fused.slice(0, topK)
}

// ── Signal 1 — Postgres FTS over title + body_md ─────────────────────────────
async function fetchFts(query: string | undefined, scopeId: string | undefined, k: number, includeSup: boolean): Promise<RawAtomRow[]> {
  if (!query?.trim()) return []
  const db = createServerClient()
  if (!db) return []
  const rpcResult = await looseRpc(db)('mol_atoms_fts_search', {
    q: query.trim(), scope: scopeId ?? null, k, include_superseded: includeSup,
  })
  if (!rpcResult.error) return (rpcResult.data ?? []) as RawAtomRow[]
  // Fallback: ILIKE search if the RPC isn't deployed yet.
  let q = looseFrom(db, 'mol_atoms').select('slug, scope_id, title, body_md, salience, pinned, last_used_at')
  if (scopeId) q = q.eq('scope_id', scopeId)
  q = q.or(`title.ilike.%${query.trim().replace(/%/g, '')}%,body_md.ilike.%${query.trim().replace(/%/g, '')}%`)
       .limit(k)
  if (!includeSup) q = q.is('superseded_by', null)
  const fb = await q
  return (fb.data as RawAtomRow[] | null) ?? []
}

// ── Signal 2 — pgvector cosine similarity ────────────────────────────────────
async function fetchVec(embedding: number[] | undefined, scopeId: string | undefined, k: number, includeSup: boolean): Promise<RawAtomRow[]> {
  if (!embedding?.length) return []
  const db = createServerClient()
  if (!db) return []
  const { data, error } = await looseRpc(db)('mol_atoms_vec_search', {
    embed: embedding, scope: scopeId ?? null, k, include_superseded: includeSup,
  })
  if (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[hybrid-search] vector signal skipped — mol_atoms_vec_search RPC not available:', error.message)
    }
    return []
  }
  return (data ?? []) as RawAtomRow[]
}

// ── Signal 3 — salience-only top results ─────────────────────────────────────
async function fetchSal(scopeId: string | undefined, k: number, includeSup: boolean): Promise<RawAtomRow[]> {
  const db = createServerClient()
  if (!db) return []
  let q = looseFrom(db, 'mol_atoms').select('slug, scope_id, title, body_md, salience, pinned, last_used_at')
    .order('salience', { ascending: false })
    .limit(k)
  if (scopeId) q = q.eq('scope_id', scopeId)
  if (!includeSup) q = q.is('superseded_by', null)
  const { data } = await q
  return (data as RawAtomRow[] | null) ?? []
}

// ── ADD-only writes ──────────────────────────────────────────────────────────
/**
 * Upsert an atom in ADD-only mode. If a row with the same (scope_id, slug)
 * exists AND the existing body differs from the new body, mark the existing
 * row's `superseded_by` to a NEW slug (slug-vN), then insert the new atom
 * under that new slug. The original slug stays in place pointing at history.
 *
 * If body is identical → no-op (nothing to write).
 * If no existing row → plain insert.
 *
 * Returns the slug actually written ('foo' for first write, 'foo-v2' for
 * supersession, etc.) so callers can update wikilinks.
 */
export async function addAtomNonOverwriting(input: {
  scopeId:  string
  slug:     string
  title:    string
  body:     string
  embedding?: number[]
  /** Optional path field expected by 021 schema. */
  path?:    string
  /** Required `sha` field expected by 021 schema. */
  sha:      string
  /** Optional frontmatter JSON. */
  frontmatter?: Record<string, unknown>
}): Promise<{ slug: string; superseded?: boolean } | null> {
  const db = createServerClient()
  if (!db) return null
  const { data: existingRaw } = await looseFrom(db, 'mol_atoms')
    .select('slug, body_md, superseded_by')
    .eq('scope_id', input.scopeId)
    .eq('slug', input.slug)
    .maybeSingle()
  const existing = existingRaw as { slug: string; body_md: string | null; superseded_by: string | null } | null

  if (existing && existing.body_md === input.body) {
    return { slug: input.slug } // identical body → no write
  }

  if (!existing) {
    await looseFrom(db, 'mol_atoms').insert({
      scope_id:    input.scopeId,
      slug:        input.slug,
      title:       input.title,
      body_md:     input.body,
      sha:         input.sha,
      path:        input.path ?? `atoms/${input.scopeId}/${input.slug}.md`,
      frontmatter: input.frontmatter ?? {},
      embedding:   input.embedding ?? null,
    })
    return { slug: input.slug }
  }

  // Existing row + different body → ADD a new versioned atom and point old at new.
  const versionMatch = input.slug.match(/-v(\d+)$/)
  const baseSlug = versionMatch ? input.slug.replace(/-v\d+$/, '') : input.slug
  const nextN = (versionMatch ? parseInt(versionMatch[1], 10) : 1) + 1
  const newSlug = `${baseSlug}-v${nextN}`

  await looseFrom(db, 'mol_atoms').insert({
    scope_id:    input.scopeId,
    slug:        newSlug,
    title:       input.title,
    body_md:     input.body,
    sha:         input.sha,
    path:        `atoms/${input.scopeId}/${newSlug}.md`,
    frontmatter: { ...(input.frontmatter ?? {}), supersedes: input.slug },
    embedding:   input.embedding ?? null,
  })
  await looseFrom(db, 'mol_atoms')
    .update({ superseded_by: newSlug })
    .eq('scope_id', input.scopeId)
    .eq('slug', input.slug)

  return { slug: newSlug, superseded: true }
}

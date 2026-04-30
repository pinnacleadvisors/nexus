/**
 * lib/memory/supabase-reader.ts
 *
 * Read API for the memory-hq mirror tables. All hot-path reads go here so
 * GitHub's rate limit never bites under load. Falls back to undefined when
 * Supabase isn't configured — callers should then talk to GitHub directly.
 */

import { createServerClient } from '@/lib/supabase'
import { canonicalScope, type MemoryScope } from './scope'

// mol_* tables were added in migration 021 and are not yet in
// lib/database.types.ts. The `from('mol_atoms')` calls below would fail
// type-check without this escape hatch — same pattern used by
// lib/observability.ts for metric_samples. Regenerate database.types.ts
// to drop this in a follow-up.
type MolBuilder = {
  select: (s: string) => MolBuilder
  eq: (k: string, v: string) => MolBuilder
  in: (k: string, v: readonly string[]) => MolBuilder
  gte: (k: string, v: string) => MolBuilder
  order: (k: string, o: { ascending: boolean }) => MolBuilder
  limit: (n: number) => MolBuilder
  textSearch: (col: string, q: string, o: { config: string }) => MolBuilder
  maybeSingle: () => Promise<{ data: unknown }>
  then: <T>(onfulfilled: (v: { data: unknown }) => T) => Promise<T>
}

function molFrom(sb: ReturnType<typeof createServerClient>, table: string): MolBuilder {
  return (sb as unknown as { from: (t: string) => MolBuilder }).from(table)
}

export type MolKind = 'atoms' | 'entities' | 'mocs' | 'sources' | 'synthesis'

const TABLE: Record<MolKind, string> = {
  atoms: 'mol_atoms',
  entities: 'mol_entities',
  mocs: 'mol_mocs',
  sources: 'mol_sources',
  synthesis: 'mol_synthesis',
}

export interface MolRow {
  slug: string
  scope_id: string
  title: string
  body_md: string
  frontmatter: Record<string, unknown>
  sha: string
  path: string
  updated_at: string
}

function client() {
  return createServerClient()
}

export async function getBySlug(kind: MolKind, scope: MemoryScope, slug: string): Promise<MolRow | null> {
  const sb = client()
  if (!sb) return null
  const scope_id = canonicalScope(scope).id
  const { data } = await molFrom(sb, TABLE[kind]).select('*').eq('scope_id', scope_id).eq('slug', slug).maybeSingle()
  return (data as MolRow) || null
}

export async function listByScope(kind: MolKind, scope: MemoryScope, limit = 100): Promise<MolRow[]> {
  const sb = client()
  if (!sb) return []
  const scope_id = canonicalScope(scope).id
  const { data } = await molFrom(sb, TABLE[kind]).select('*').eq('scope_id', scope_id).limit(limit)
  return (data as MolRow[]) || []
}

export async function searchAtoms(query: string, opts: { scope?: MemoryScope; limit?: number; author?: string } = {}): Promise<MolRow[]> {
  const sb = client()
  if (!sb) return []
  let q = molFrom(sb, 'mol_atoms').select('*').textSearch('to_tsvector_atoms', query, { config: 'english' })
  if (opts.scope) q = q.eq('scope_id', canonicalScope(opts.scope).id)
  if (opts.author) q = q.eq('frontmatter->>author', opts.author)
  q = q.limit(opts.limit || 25)
  const { data } = await q
  return (data as MolRow[]) || []
}

/** Cosine-similarity vector search. Caller embeds the query first. */
export async function searchAtomsByVector(embedding: number[], opts: { scope?: MemoryScope; limit?: number } = {}): Promise<MolRow[]> {
  const sb = client()
  if (!sb) return []
  // Supabase RPC pattern is the cleanest path, but for now use a direct
  // similarity expression via raw SQL. This requires a `match_atoms` SQL
  // function in the DB — add when the first vector caller arrives.
  const limit = opts.limit || 10
  const scope_id = opts.scope ? canonicalScope(opts.scope).id : undefined
  const rpcArgs: Record<string, unknown> = { query_embedding: embedding, match_count: limit }
  if (scope_id) rpcArgs.scope_id = scope_id
  const { data } = await (sb.rpc as unknown as (
    name: string, args: Record<string, unknown>,
  ) => Promise<{ data: unknown }>)('match_atoms', rpcArgs)
  return (data as MolRow[]) || []
}

export async function byAuthor(author: string, opts: { kind?: MolKind; limit?: number } = {}): Promise<MolRow[]> {
  const sb = client()
  if (!sb) return []
  const table = TABLE[opts.kind || 'atoms']
  const { data } = await molFrom(sb, table).select('*').eq('frontmatter->>author', author).order('updated_at', { ascending: false }).limit(opts.limit || 50)
  return (data as MolRow[]) || []
}

/**
 * Importance + recency feed. Useful for the "what changed" digest.
 * Filters frontmatter.importance in {critical, high} and orders by updated_at.
 */
export async function recentImportant(opts: { scope?: MemoryScope; limit?: number; since?: string } = {}): Promise<MolRow[]> {
  const sb = client()
  if (!sb) return []
  let q = molFrom(sb, 'mol_atoms').select('*').in('frontmatter->>importance', ['critical', 'high'])
  if (opts.scope) q = q.eq('scope_id', canonicalScope(opts.scope).id)
  if (opts.since) q = q.gte('updated_at', opts.since)
  q = q.order('updated_at', { ascending: false }).limit(opts.limit || 25)
  const { data } = await q
  return (data as MolRow[]) || []
}

export function isSupabaseMirrorConfigured(): boolean {
  return Boolean(client())
}

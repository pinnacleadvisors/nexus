/**
 * lib/agents/cache.ts — smart-caching layer for agent dispatches.
 *
 * Operator brain-dump 2026-05-27 + UX consult R-stream. Same input →
 * same output via cached row in `agent_response_cache` (migration 090).
 *
 * Usage:
 *   const cached = await cacheLookup(slug, args)
 *   if (cached) return cached
 *   const fresh = await actuallyRunTheAgent(...)
 *   await cacheStore(slug, args, fresh, { ttlMinutes: 60 * 24 })
 *   return fresh
 *
 * Or, ergonomically:
 *   return cacheWrap(slug, args, () => actuallyRunTheAgent(...), { ttlMinutes: 60 * 24 })
 *
 * Cache key is a stable sha256 of `agent_slug || ':' || stable-json(args)`.
 * `args` MUST be JSON-serialisable; non-deterministic fields (timestamps,
 * random nonces) MUST be stripped by the caller before hashing.
 *
 * Default TTL: 1 hour. Override per call via `opts.ttlMinutes`. Agents
 * with stable inputs (research, niche analysis, trend scouting) want
 * 24h+; agents with volatile inputs (real-time analytics) want 5-15 min
 * or no cache at all.
 *
 * Fail-soft on every path — cache failures (DB unreachable, table
 * missing) just bypass the cache. The agent's real call still fires.
 * Cost-guard semantics: cache HIT is free; cache MISS still hits the
 * normal cost-guard pre-dispatch check via the wrapped function.
 *
 * Eviction: a daily cron at `/api/cron/agent-cache-evict` (deferred to
 * follow-up PR) trims rows past `expires_at` + LRU-evicts when row
 * count > 10k.
 */

import { createHash } from 'node:crypto'
import { createServerClient } from '@/lib/supabase'

const DEFAULT_TTL_MINUTES = 60

export interface CacheStoreOpts {
  /** Default 60. Override per call. */
  ttlMinutes?:    number
  /** Optional business_slug — lets the operator invalidate by business
   *  (e.g. when the niche changes, blow away every cached row for that
   *  business). */
  businessSlug?:  string | null
  /** When set, ALSO stamps the row with the arguments JSON so eviction
   *  + debugging can inspect what was cached. False by default to save
   *  storage on bulky payloads. */
  storeArguments?: boolean
}

export interface CacheLookupResult<T> {
  output:       T
  cached_at:    string
  hit_count:    number
}

/** Generate the deterministic cache key. Sorted JSON.stringify ensures
 *  key stability across object-key-order variations. */
export function cacheKey(agentSlug: string, args: unknown): string {
  const canonical = `${agentSlug}:${stableStringify(args)}`
  return createHash('sha256').update(canonical).digest('hex')
}

/** Stable JSON.stringify — sorts object keys recursively. Arrays keep
 *  their order (the order is semantic). */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const keys = Object.keys(v as Record<string, unknown>).sort()
  const parts = keys.map(k => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
  return `{${parts.join(',')}}`
}

/** Read a cached response. Returns null on miss, expired, or DB error. */
export async function cacheLookup<T = unknown>(
  agentSlug: string,
  args:      unknown,
): Promise<CacheLookupResult<T> | null> {
  const db = createServerClient()
  if (!db) return null
  const key = cacheKey(agentSlug, args)
  const nowIso = new Date().toISOString()
  try {
    const res = await (db.from('agent_response_cache' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { gt: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { output: unknown; created_at: string; hit_count: number } | null; error: { message: string } | null }> } } }
    }).select('output, created_at, hit_count').eq('input_hash', key).gt('expires_at', nowIso).maybeSingle()

    if (res.error || !res.data) return null

    // Fire-and-forget hit_count + last_used_at bump. Never block on this.
    void (db.from('agent_response_cache' as never) as unknown as {
      update: (row: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> }
    }).update({
      hit_count:    (res.data.hit_count ?? 0) + 1,
      last_used_at: nowIso,
    }).eq('input_hash', key)

    return {
      output:    res.data.output as T,
      cached_at: res.data.created_at,
      hit_count: res.data.hit_count + 1,
    }
  } catch {
    return null
  }
}

/** Write a fresh response. Idempotent via upsert. Fail-soft. */
export async function cacheStore(
  agentSlug: string,
  args:      unknown,
  output:    unknown,
  opts:      CacheStoreOpts = {},
): Promise<void> {
  const db = createServerClient()
  if (!db) return
  const key = cacheKey(agentSlug, args)
  const ttl = Math.max(1, opts.ttlMinutes ?? DEFAULT_TTL_MINUTES)
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString()
  const nowIso = new Date().toISOString()
  try {
    await (db.from('agent_response_cache' as never) as unknown as {
      upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ error: { message: string } | null }>
    }).upsert({
      input_hash:    key,
      agent_slug:    agentSlug,
      arguments:     opts.storeArguments ? args : null,
      output,
      hit_count:     0,
      created_at:    nowIso,
      last_used_at:  nowIso,
      expires_at:    expiresAt,
      business_slug: opts.businessSlug ?? null,
    }, { onConflict: 'input_hash' })
  } catch {
    // Cache failures are non-fatal — the caller's path returned a fresh
    // result already. Log silently rather than throwing.
  }
}

/** Convenience wrapper — call the producer only on cache miss. */
export async function cacheWrap<T>(
  agentSlug: string,
  args:      unknown,
  producer:  () => Promise<T>,
  opts:      CacheStoreOpts = {},
): Promise<T> {
  const hit = await cacheLookup<T>(agentSlug, args)
  if (hit) return hit.output
  const fresh = await producer()
  await cacheStore(agentSlug, args, fresh, opts)
  return fresh
}

/** Bulk-invalidate all cached rows for a business — useful when the
 *  business pivots niche, changes brand voice, etc. */
export async function cacheInvalidateBusiness(businessSlug: string): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  const db = createServerClient()
  if (!db) return { ok: false, error: 'supabase_unconfigured' }
  try {
    const res = await (db.from('agent_response_cache' as never) as unknown as {
      delete: () => { eq: (c: string, v: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }> }
    }).delete().eq('business_slug', businessSlug)
    if (res.error) return { ok: false, error: res.error.message }
    return { ok: true, deleted: (res.data ?? []).length }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

/** Bulk-invalidate all cached rows for an agent — useful when the
 *  agent's prompt changes substantially. */
export async function cacheInvalidateAgent(agentSlug: string): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  const db = createServerClient()
  if (!db) return { ok: false, error: 'supabase_unconfigured' }
  try {
    const res = await (db.from('agent_response_cache' as never) as unknown as {
      delete: () => { eq: (c: string, v: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }> }
    }).delete().eq('agent_slug', agentSlug)
    if (res.error) return { ok: false, error: res.error.message }
    return { ok: true, deleted: (res.data ?? []).length }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

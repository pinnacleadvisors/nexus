/**
 * lib/llm/provider-settings.ts — dynamic LLM provider selection.
 *
 * Stores the active provider in `ai_provider_active` (migration 083) so the
 * operator can flip Claude → Mimo → OpenRouter etc. from /settings without
 * redeploying nexus-app or touching Doppler.
 *
 * Why this exists alongside the Doppler LLM_PROVIDER env:
 *   - Doppler edits require a redeploy of nexus-app (slow + dangerous if
 *     the new provider's adapter is broken).
 *   - The setting is per-operator (single-tenant today) so the row is
 *     keyed by user_id, not business.
 *   - Env var stays as the fallback — when the table is missing (fresh
 *     install, migration unapplied) OR the row is absent, the platform
 *     reads process.env.LLM_PROVIDER like before.
 *
 * ## Cache semantics
 *
 * getLlm() in lib/llm/provider.ts is SYNCHRONOUS. We don't want every
 * request to hit Supabase. So we keep an in-memory cache with a ~30s TTL:
 *   - Cache hit + fresh → return cached value (sync from sync wrapper)
 *   - Cache miss / stale → fire async refresh; return current cached value
 *     (which might be stale by 30s, that's the price of staying sync)
 *
 * On a flip via PATCH /api/llm-provider/active, the API route calls
 * invalidateCache() before responding, so the next getLlm() call refetches.
 *
 * Module-level singleton — there's exactly one operator, so one cache.
 * The map shape is preserved for future multi-tenant evolution.
 */

import type { LlmProvider } from '@/lib/llm/provider'
import { createServerClient } from '@/lib/supabase'

const VALID_PROVIDERS: ReadonlySet<LlmProvider> = new Set<LlmProvider>(['claude', 'openrouter', 'mimo', 'ollama'])

export interface ActiveProviderRecord {
  provider: LlmProvider
  model:    string | null
  reason:   string | null
  source:   'db' | 'env' | 'default'
}

interface CacheEntry {
  record:    ActiveProviderRecord
  refreshAt: number
}

const CACHE_TTL_MS = 30_000

// Per-user cache. Most prod deploys are single-tenant so this stays tiny.
const cache = new Map<string, CacheEntry>()

/** Strip down to a valid LlmProvider, returning null if unrecognised. */
function parseProvider(raw: unknown): LlmProvider | null {
  if (typeof raw !== 'string') return null
  const norm = raw.toLowerCase().trim()
  return VALID_PROVIDERS.has(norm as LlmProvider) ? norm as LlmProvider : null
}

function envFallback(): ActiveProviderRecord {
  const env = parseProvider(process.env.LLM_PROVIDER)
  if (env) {
    return { provider: env, model: null, reason: 'doppler_env_LLM_PROVIDER', source: 'env' }
  }
  return { provider: 'claude', model: null, reason: 'no_setting_no_env_default_claude', source: 'default' }
}

/**
 * Synchronous getter — returns the cached active provider or env fallback
 * without ever blocking on Supabase. Background refresh fires when stale.
 *
 * First call on a cold process: env fallback (cache empty). Background
 * refresh populates the cache; subsequent calls within TTL get the DB
 * value. Trade-off: a single getLlm() call right after boot might use
 * env when DB says otherwise, but every subsequent call within 30s sees
 * the right value.
 *
 * `userId` defaults to the first ALLOWED_USER_IDS entry — works for the
 * single-tenant default. Callers in multi-tenant contexts pass explicit.
 */
export function getActiveProviderSync(userId?: string): ActiveProviderRecord {
  const key = userId ?? defaultUserId() ?? 'default'
  const now = Date.now()
  const hit = cache.get(key)

  // Fire background refresh on stale OR missing cache.
  if (!hit || hit.refreshAt <= now) {
    void refreshCache(key)
  }

  // Return cached value if we have one (even if stale — refreshCache is
  // racing to update it). Otherwise env fallback.
  return hit?.record ?? envFallback()
}

/**
 * Async getter — actively refreshes the cache if stale. Use this from
 * non-hot paths where awaiting the DB read is fine (Settings UI load,
 * preflight checks, model recommendation).
 */
export async function getActiveProvider(userId?: string): Promise<ActiveProviderRecord> {
  const key = userId ?? defaultUserId() ?? 'default'
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && hit.refreshAt > now) return hit.record
  return await refreshCache(key)
}

/** Force the cache to refetch on next call. Called by the PATCH endpoint
 *  after a successful write so the flip lands within the same request. */
export function invalidateCache(userId?: string): void {
  if (userId) cache.delete(userId)
  else        cache.clear()
}

/**
 * Write a new active-provider row. Validates the provider name first.
 * Returns the resolved record (provider, model, source). On migration-
 * missing returns degraded: true so the UI can surface a warning.
 */
export async function setActiveProvider(
  userId:   string,
  provider: LlmProvider,
  opts:     { model?: string | null; reason?: string | null } = {},
): Promise<{ ok: boolean; record?: ActiveProviderRecord; error?: string; degraded?: boolean }> {
  if (!VALID_PROVIDERS.has(provider)) {
    return { ok: false, error: 'invalid_provider' }
  }
  const db = createServerClient()
  if (!db) return { ok: false, error: 'supabase_unconfigured' }

  try {
    const res = await (db.from('ai_provider_active' as never) as unknown as {
      upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ error: { message: string } | null }>
    }).upsert({
      user_id:    userId,
      provider,
      model:      opts.model ?? null,
      reason:     opts.reason ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (res.error) {
      if (/relation .*ai_provider_active.* does not exist/i.test(res.error.message)) {
        return { ok: false, degraded: true, error: 'migration_083_not_applied' }
      }
      return { ok: false, error: res.error.message }
    }
    // Invalidate + warm the cache so the next getLlm sees the new value.
    invalidateCache(userId)
    const record: ActiveProviderRecord = {
      provider,
      model:  opts.model ?? null,
      reason: opts.reason ?? null,
      source: 'db',
    }
    cache.set(userId, { record, refreshAt: Date.now() + CACHE_TTL_MS })
    return { ok: true, record }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

async function refreshCache(key: string): Promise<ActiveProviderRecord> {
  const db = createServerClient()
  if (!db) {
    const fallback = envFallback()
    cache.set(key, { record: fallback, refreshAt: Date.now() + CACHE_TTL_MS })
    return fallback
  }
  try {
    const res = await (db.from('ai_provider_active' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { provider: string; model: string | null; reason: string | null } | null; error: { message: string } | null }> } }
    }).select('provider,model,reason').eq('user_id', key).maybeSingle()
    if (res.error) {
      // Migration missing → silently fall back to env. Don't warn loudly
      // because the table-doesn't-exist case is expected on fresh installs.
      const fallback = envFallback()
      cache.set(key, { record: fallback, refreshAt: Date.now() + CACHE_TTL_MS })
      return fallback
    }
    const provider = parseProvider(res.data?.provider)
    if (!provider) {
      const fallback = envFallback()
      cache.set(key, { record: fallback, refreshAt: Date.now() + CACHE_TTL_MS })
      return fallback
    }
    const record: ActiveProviderRecord = {
      provider,
      model:  res.data?.model  ?? null,
      reason: res.data?.reason ?? null,
      source: 'db',
    }
    cache.set(key, { record, refreshAt: Date.now() + CACHE_TTL_MS })
    return record
  } catch {
    const fallback = envFallback()
    cache.set(key, { record: fallback, refreshAt: Date.now() + CACHE_TTL_MS })
    return fallback
  }
}

/** Best-effort default user — the first id in ALLOWED_USER_IDS. */
function defaultUserId(): string | null {
  const ids = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return ids[0] ?? null
}

/**
 * lib/fixtures/store.ts
 *
 * Read-through cache for the per-operator "fixture mode enabled" flag
 * (migration 084's `fixture_mode_active` table). Mirrors the
 * lib/llm/provider-settings.ts cache pattern so cost-sensitive callers
 * (`executeBusinessAction` on every agent dispatch) don't hit Supabase
 * once per call.
 *
 * Semantics:
 *   - Cold cache → returns false (fail-closed). Background refresh fires.
 *   - Cache hit + fresh (< 30s) → returns cached value sync.
 *   - PATCH /api/dev/fixtures/active flips the row + calls invalidate so
 *     the next read sees the new value immediately.
 *   - Missing migration (older deploy) → silently falls back to false.
 *     Same fail-soft pattern as provider-settings.
 *
 * Why per-user keying: single-tenant Nexus today, but the row shape +
 * cache keying matches multi-tenant for future-proofing. The
 * `defaultUserId()` helper reads ALLOWED_USER_IDS so single-tenant
 * callers can omit the userId arg.
 */

import { createServerClient } from '@/lib/supabase'

interface CacheEntry {
  enabled:   boolean
  refreshAt: number
}

const CACHE_TTL_MS = 30_000
const cache = new Map<string, CacheEntry>()

/** Best-effort single-tenant default user from ALLOWED_USER_IDS. */
function defaultUserId(): string | null {
  const ids = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return ids[0] ?? null
}

/**
 * Synchronous check — returns the cached value or false if cold/missing.
 * Fires a background refresh on stale or missing entries.
 *
 * Use this from hot paths like `executeBusinessAction` where blocking on
 * Supabase per call is too expensive. First call on a cold process returns
 * false (fixture mode OFF); subsequent calls within 30s see the DB value.
 */
export function getFixtureModeSync(userId?: string): boolean {
  const key = userId ?? defaultUserId() ?? 'default'
  const now = Date.now()
  const hit = cache.get(key)
  if (!hit || hit.refreshAt <= now) {
    void refreshCache(key)
  }
  return hit?.enabled ?? false
}

/**
 * Async check — actively refreshes if stale. Use from API routes /
 * Settings UI / non-hot paths.
 */
export async function getFixtureMode(userId?: string): Promise<boolean> {
  const key = userId ?? defaultUserId() ?? 'default'
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && hit.refreshAt > now) return hit.enabled
  return await refreshCache(key)
}

/** Force cache refetch on next call. Called by the PATCH endpoint after
 *  a successful write so the flip lands within the same request. */
export function invalidateFixtureModeCache(userId?: string): void {
  if (userId) cache.delete(userId)
  else        cache.clear()
}

/**
 * Write a new fixture-mode row. Returns the resolved state. On
 * migration-missing returns degraded: true so the UI can surface a
 * warning instead of pretending the flip succeeded.
 */
export async function setFixtureMode(
  userId:  string,
  enabled: boolean,
  reason?: string | null,
): Promise<{ ok: boolean; enabled?: boolean; error?: string; degraded?: boolean }> {
  const db = createServerClient()
  if (!db) return { ok: false, error: 'supabase_unconfigured' }

  try {
    const res = await (db.from('fixture_mode_active' as never) as unknown as {
      upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ error: { message: string } | null }>
    }).upsert({
      user_id:    userId,
      enabled,
      reason:     reason ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    if (res.error) {
      if (/relation .*fixture_mode_active.* does not exist/i.test(res.error.message)) {
        return { ok: false, degraded: true, error: 'migration_084_not_applied' }
      }
      return { ok: false, error: res.error.message }
    }

    invalidateFixtureModeCache(userId)
    // Warm the cache so the next sync check sees the new value
    // without waiting for the background refresh.
    cache.set(userId, { enabled, refreshAt: Date.now() + CACHE_TTL_MS })
    return { ok: true, enabled }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

async function refreshCache(key: string): Promise<boolean> {
  const db = createServerClient()
  if (!db) {
    cache.set(key, { enabled: false, refreshAt: Date.now() + CACHE_TTL_MS })
    return false
  }
  try {
    const res = await (db.from('fixture_mode_active' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { enabled: boolean } | null; error: { message: string } | null }> } }
    }).select('enabled').eq('user_id', key).maybeSingle()

    if (res.error) {
      // Migration missing → cache as off + don't spam logs.
      cache.set(key, { enabled: false, refreshAt: Date.now() + CACHE_TTL_MS })
      return false
    }
    const enabled = Boolean(res.data?.enabled)
    cache.set(key, { enabled, refreshAt: Date.now() + CACHE_TTL_MS })
    return enabled
  } catch {
    cache.set(key, { enabled: false, refreshAt: Date.now() + CACHE_TTL_MS })
    return false
  }
}

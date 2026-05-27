/**
 * lib/models/provider-toggle.ts — per-operator AI provider disable toggle.
 *
 * Backed by the `ai_provider_disabled` table (migration 082). Presence in
 * the table = disabled. Absence = enabled by default.
 *
 * Consumers:
 *   • `detectAvailableProviders()` in lib/models/providers.ts subtracts the
 *     disabled set before returning, so the recommender + skill-recommend
 *     never pick a disabled provider's models.
 *   • Settings UI (AiProviderCard) calls the API endpoint to flip state.
 *   • Future chat-route fallback logic can read this when deciding whether
 *     to fail-open to the next provider.
 *
 * Fail-soft: every helper returns the safe-default value when the DB is
 * unreachable or the migration hasn't been applied yet. The settings UI
 * stays usable; toggles just don't persist.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiProviderKey } from '@/lib/models/types'

interface DisabledRow {
  user_id:     string
  provider:    string
  reason:      string | null
  disabled_at: string
}

/**
 * Load every provider the operator has explicitly disabled. Returns an
 * empty Set when the table is missing or the read fails — safer to assume
 * "nothing disabled" than to silently strip every provider on a transient
 * DB hiccup.
 */
export async function loadDisabledProviders(
  db: SupabaseClient | null,
  userId: string,
): Promise<Set<AiProviderKey>> {
  if (!db || !userId) return new Set<AiProviderKey>()
  try {
    const res = await (db.from('ai_provider_disabled' as never) as unknown as {
      select: (cols: string) => { eq: (c: string, v: string) => Promise<{ data: DisabledRow[] | null; error: { message: string } | null }> }
    }).select('provider').eq('user_id', userId)
    if (res.error) {
      // Migration 082 not yet applied → degrade gracefully.
      if (/relation .*ai_provider_disabled.* does not exist/i.test(res.error.message)) {
        return new Set<AiProviderKey>()
      }
      console.warn('[provider-toggle] load failed:', res.error.message)
      return new Set<AiProviderKey>()
    }
    return new Set<AiProviderKey>((res.data ?? []).map(r => r.provider as AiProviderKey))
  } catch (err) {
    console.warn('[provider-toggle] load threw:', err instanceof Error ? err.message : err)
    return new Set<AiProviderKey>()
  }
}

export interface SetDisabledResult {
  ok:        boolean
  disabled:  boolean              // the resulting state
  error?:    string
  degraded?: string               // migration-not-applied warning
}

/**
 * Flip the disabled state for one provider. `disabled: true` writes a row,
 * `disabled: false` deletes it. Idempotent on both sides — re-disabling an
 * already-disabled provider is a no-op (ON CONFLICT DO NOTHING semantics),
 * re-enabling an already-enabled one is a DELETE-of-nothing.
 */
export async function setProviderDisabled(
  db: SupabaseClient | null,
  userId: string,
  provider: AiProviderKey,
  disabled: boolean,
  reason?: string,
): Promise<SetDisabledResult> {
  if (!db || !userId) return { ok: false, disabled, error: 'missing_db_or_user' }
  try {
    if (disabled) {
      const res = await (db.from('ai_provider_disabled' as never) as unknown as {
        upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ error: { message: string } | null }>
      }).upsert({ user_id: userId, provider, reason: reason ?? null, disabled_at: new Date().toISOString() }, { onConflict: 'user_id,provider' })
      if (res.error) {
        if (/relation .*ai_provider_disabled.* does not exist/i.test(res.error.message)) {
          return { ok: false, disabled: false, degraded: 'migration_082_not_applied', error: 'Run `npm run migrate` to apply migration 082_ai_provider_disabled.' }
        }
        return { ok: false, disabled: false, error: res.error.message }
      }
      return { ok: true, disabled: true }
    } else {
      const res = await (db.from('ai_provider_disabled' as never) as unknown as {
        delete: () => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> } }
      }).delete().eq('user_id', userId).eq('provider', provider)
      if (res.error) {
        if (/relation .*ai_provider_disabled.* does not exist/i.test(res.error.message)) {
          // Soft success — table doesn't exist, so the row also doesn't exist.
          return { ok: true, disabled: false, degraded: 'migration_082_not_applied' }
        }
        return { ok: false, disabled: true, error: res.error.message }
      }
      return { ok: true, disabled: false }
    }
  } catch (err) {
    return { ok: false, disabled, error: err instanceof Error ? err.message : 'unknown' }
  }
}

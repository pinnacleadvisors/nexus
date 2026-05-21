/**
 * user-secrets — per-user encrypted secret storage.
 *
 * Values are encrypted via lib/crypto.ts (AES-256-GCM, key from ENCRYPTION_KEY)
 * before insert, so the DB row alone is not enough to recover the plaintext.
 *
 * Reads go through decrypt; callers never see ciphertext.
 *
 * When Supabase is not configured, all reads return null and writes are no-ops
 * (logged in dev). Callers should handle this gracefully — typically by falling
 * back to env vars or cookies.
 */

import { createServerClient } from '@/lib/supabase'
import { encrypt, decrypt } from '@/lib/crypto'

export interface SecretRow {
  user_id: string
  kind: string
  name: string
  value: string
  created_at?: string
  updated_at?: string
}

export async function setSecret(userId: string, kind: string, name: string, plaintext: string): Promise<boolean> {
  const db = createServerClient()
  if (!db) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[user-secrets] setSecret skipped — Supabase not configured')
    }
    return false
  }
  const ciphertext = encrypt(plaintext)
  const { error } = await (db.from('user_secrets' as never) as unknown as {
    upsert: (row: unknown, opts: unknown) => Promise<{ error: { message: string } | null }>
  }).upsert(
    { user_id: userId, kind, name, value: ciphertext, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,kind,name' },
  )
  if (error) {
    console.warn('[user-secrets] setSecret failed:', error.message)
    return false
  }
  return true
}

export async function getSecret(userId: string, kind: string, name: string): Promise<string | null> {
  const db = createServerClient()
  if (!db) return null
  const { data, error } = await (db.from('user_secrets' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            maybeSingle: () => Promise<{ data: { value: string } | null; error: { message: string } | null }>
          }
        }
      }
    }
  }).select('value').eq('user_id', userId).eq('kind', kind).eq('name', name).maybeSingle()

  if (error || !data) return null
  return decrypt(data.value)
}

export async function getSecrets(userId: string, kind: string): Promise<Record<string, string>> {
  const db = createServerClient()
  if (!db) return {}
  const { data } = await (db.from('user_secrets' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => Promise<{ data: Array<{ name: string; value: string }> | null }>
      }
    }
  }).select('name,value').eq('user_id', userId).eq('kind', kind)

  const out: Record<string, string> = {}
  for (const row of data ?? []) {
    const plain = decrypt(row.value)
    if (plain !== null) out[row.name] = plain
  }
  return out
}

// ── Provider preferences ───────────────────────────────────────────────────
// Lightweight metadata layer on top of user_secrets. Stored on the canonical
// `name='preferences'` row per (user_id, kind) — the row's `value` is a dummy
// empty string (`'preferences'` isn't a secret), the actual prefs live in the
// `metadata jsonb` column added by migration 045. Future toggles add new
// keys under `metadata` without new migrations.

export type SubscriptionTier = 'Pro' | '5x Max' | '20x Max' | 'API only'
export type ExecutionMode    = 'subscription' | 'api' | 'node-pty'

export interface ProviderPreferences {
  subscription_tier?: SubscriptionTier
  execution_mode?:    ExecutionMode
}

const VALID_TIERS:  ReadonlySet<SubscriptionTier> = new Set(['Pro', '5x Max', '20x Max', 'API only'])
const VALID_MODES:  ReadonlySet<ExecutionMode>    = new Set(['subscription', 'api', 'node-pty'])

function sanitizePrefs(input: unknown): ProviderPreferences {
  if (!input || typeof input !== 'object') return {}
  const o    = input as Record<string, unknown>
  const out: ProviderPreferences = {}
  if (typeof o.subscription_tier === 'string' && VALID_TIERS.has(o.subscription_tier as SubscriptionTier)) {
    out.subscription_tier = o.subscription_tier as SubscriptionTier
  }
  if (typeof o.execution_mode === 'string' && VALID_MODES.has(o.execution_mode as ExecutionMode)) {
    out.execution_mode = o.execution_mode as ExecutionMode
  }
  return out
}

export async function getProviderPrefs(userId: string, kind: string): Promise<ProviderPreferences> {
  const db = createServerClient()
  if (!db) return {}
  const { data } = await (db.from('user_secrets' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            maybeSingle: () => Promise<{ data: { metadata: unknown } | null }>
          }
        }
      }
    }
  }).select('metadata').eq('user_id', userId).eq('kind', kind).eq('name', 'preferences').maybeSingle()

  return sanitizePrefs(data?.metadata)
}

/**
 * Validates the incoming prefs then upserts the canonical
 * `name='preferences'` row.
 *
 * Resilient to a deployment whose migration 045 (the `metadata jsonb`
 * column) has NOT been applied yet — first attempt writes WITH metadata,
 * and if Postgres complains the column doesn't exist, retries WITHOUT.
 * The row still lands so the operator's prefs row exists; the metadata
 * payload is dropped until the migration runs (`doppler run -- npm run
 * migrate`). `degraded: true` is returned in that case so callers can
 * surface a hint.
 */
export async function setProviderPrefs(
  userId: string, kind: string, prefs: ProviderPreferences,
): Promise<{ ok: boolean; written: ProviderPreferences; degraded?: boolean }> {
  const sanitized = sanitizePrefs(prefs)
  const db = createServerClient()
  if (!db) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[user-secrets] setProviderPrefs skipped — Supabase not configured')
    }
    return { ok: false, written: sanitized }
  }

  // value is NOT NULL — store a deliberate sentinel so the row is still
  // grep-able and never accidentally decrypted as a secret elsewhere.
  const baseRow = {
    user_id:    userId,
    kind,
    name:       'preferences',
    value:      'PREFERENCES_ROW_NOT_A_SECRET',
    updated_at: new Date().toISOString(),
  }
  const tbl = db.from('user_secrets' as never) as unknown as {
    upsert: (row: unknown, opts: unknown) => Promise<{ error: { message: string; code?: string } | null }>
  }

  // Attempt 1 — with metadata.
  const first = await tbl.upsert(
    { ...baseRow, metadata: sanitized },
    { onConflict: 'user_id,kind,name' },
  )
  if (!first.error) return { ok: true, written: sanitized }

  // Attempt 2 — drop metadata if Postgres says the column doesn't exist
  // (migration 045 not applied yet). Code 42703 = undefined_column;
  // PostgREST also surfaces the message "Could not find the 'metadata'
  // column" via its schema cache. Either match triggers the fallback.
  const msg = String(first.error.message ?? '').toLowerCase()
  const missingCol = first.error.code === '42703'
    || msg.includes("'metadata' column")
    || msg.includes('column "metadata"')
    || (msg.includes('metadata') && msg.includes('does not exist'))
  if (!missingCol) {
    console.warn('[user-secrets] setProviderPrefs failed:', first.error.message)
    return { ok: false, written: sanitized }
  }

  const second = await tbl.upsert(baseRow, { onConflict: 'user_id,kind,name' })
  if (second.error) {
    console.warn('[user-secrets] setProviderPrefs fallback also failed:', second.error.message)
    return { ok: false, written: sanitized }
  }
  console.warn(
    '[user-secrets] migration 045 not applied — provider prefs persisted WITHOUT metadata.',
    'Run `doppler run -- npm run migrate` to enable.',
  )
  return { ok: true, written: sanitized, degraded: true }
}

export async function deleteSecrets(userId: string, kind: string): Promise<boolean> {
  const db = createServerClient()
  if (!db) return false
  const { error } = await (db.from('user_secrets' as never) as unknown as {
    delete: () => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>
      }
    }
  }).delete().eq('user_id', userId).eq('kind', kind)
  return !error
}

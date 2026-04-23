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

/**
 * lib/views/notes.ts — CRUD helpers for `operator_notes` (migration 056).
 *
 * Backs the Notes panel in the chat Views dropdown. One row per
 * (user_id, scope). Last-write-wins with optimistic-concurrency via
 * `expected_updated_at` — when set on PUT, the helper returns a conflict
 * verdict instead of overwriting if the DB row's timestamp has advanced.
 *
 * Routes auth via Clerk + ALLOWED_USER_IDS; helpers below are service-role
 * writes that trust the caller has already authenticated the user_id.
 *
 * The `as never` casts on `from('operator_notes')` are the same pattern
 * lib/views/tasks.ts uses (PR #281) — the generated Supabase types haven't
 * been regenerated since migration 056 landed and the runtime row shape
 * is enforced by the migration's CHECK constraints.
 */

import { createServerClient } from '@/lib/supabase'

export interface OperatorNoteRow {
  id:         string
  user_id:    string
  scope:      string
  body:       string
  updated_at: string
}

interface MaybeSingleResp<T> { data: T | null; error: { message: string } | null }
interface SingleResp<T>      { data: T | null; error: { message: string } | null }

/** Read the single notes blob for (user, scope). Returns null when none exists yet. */
export async function getNote(userId: string, scope: string): Promise<OperatorNoteRow | null> {
  const db = createServerClient()
  if (!db) return null
  const res = await (db.from('operator_notes' as never) as unknown as {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => {
          maybeSingle: () => Promise<MaybeSingleResp<OperatorNoteRow>>
        }
      }
    }
  })
    .select('id, user_id, scope, body, updated_at')
    .eq('user_id', userId)
    .eq('scope',   scope)
    .maybeSingle()

  if (res.error) {
    // Fail-soft for the same reason chat history reads do — a missing migration
    // shouldn't crash the UI. Caller treats null as "no notes yet".
    console.warn('[views:notes] getNote error:', res.error.message)
    return null
  }
  return res.data ?? null
}

export type PutNoteVerdict =
  | { ok: true;  note:    OperatorNoteRow }
  | { ok: false; conflict: true;  current: OperatorNoteRow }
  | { ok: false; conflict: false; error: string }

/**
 * Upsert the note for (user, scope).
 *
 * Concurrency: when `expectedUpdatedAt` is provided AND the DB row already
 * exists with a different `updated_at`, returns `{ ok: false, conflict: true,
 * current }` so the UI can show a "your version is stale" banner.
 * When `expectedUpdatedAt` is omitted, force-writes (used for the initial
 * save where there's no existing row to conflict against, OR when the
 * operator explicitly overwrites after a conflict prompt).
 */
export async function putNote(
  userId: string,
  scope: string,
  body: string,
  expectedUpdatedAt?: string | null,
): Promise<PutNoteVerdict> {
  const db = createServerClient()
  if (!db) return { ok: false, conflict: false, error: 'supabase unavailable' }

  // Conflict-check first when the client claims a known prior version.
  // Without this we'd race with another tab and silently overwrite.
  if (expectedUpdatedAt) {
    const current = await getNote(userId, scope)
    if (current && current.updated_at !== expectedUpdatedAt) {
      return { ok: false, conflict: true, current }
    }
  }

  const now = new Date().toISOString()
  const row = { user_id: userId, scope, body, updated_at: now }
  const res = await (db.from('operator_notes' as never) as unknown as {
    upsert: (r: typeof row, opts: { onConflict: string }) => {
      select: (c: string) => {
        single: () => Promise<SingleResp<OperatorNoteRow>>
      }
    }
  })
    .upsert(row, { onConflict: 'user_id,scope' })
    .select('id, user_id, scope, body, updated_at')
    .single()

  if (res.error) {
    return { ok: false, conflict: false, error: res.error.message }
  }
  if (!res.data) {
    return { ok: false, conflict: false, error: 'upsert returned no row' }
  }
  return { ok: true, note: res.data }
}

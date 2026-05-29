/**
 * lib/harness/store.ts — Supabase persistence for sub-harnesses (migration 097).
 *
 * Same untyped-shim + fail-soft-migration pattern as lib/loops/store.ts
 * (sub_harnesses isn't in the generated types). All functions return a
 * discriminated result so routes return 200 + {ok:false} per the retry-storm
 * rule (the synthesize agent + schedulers auto-retry on 5xx).
 */

import { createServerClient } from '@/lib/supabase'
import type { SubHarness, SubHarnessCreateInput, SubHarnessStatus } from './types'

interface PgResult { data: unknown; error: { message: string } | null }
interface PgQuery extends PromiseLike<PgResult> {
  select(cols?: string):                  PgQuery
  insert(row: Record<string, unknown>):   PgQuery
  update(row: Record<string, unknown>):   PgQuery
  eq(col: string, val: unknown):          PgQuery
  order(col: string, o: { ascending: boolean }): PgQuery
  maybeSingle():                          PgQuery
  single():                               PgQuery
}
interface PgClient { from(table: string): PgQuery }

function client(): PgClient | null {
  const db = createServerClient()
  return db ? (db as unknown as PgClient) : null
}

export type StoreResult<T> = { ok: true } & T | { ok: false; error: string }
const SUPABASE_UNCONFIGURED = 'supabase_unconfigured'

function migrationError(message: string): string | null {
  if (!message) return null
  if (/sub_harnesses/i.test(message) && /(does not exist|find the table)/i.test(message)) {
    return 'migration_097_not_applied'
  }
  return null
}
function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: migrationError(message) ?? message }
}

export async function createSubHarness(input: SubHarnessCreateInput, userId: string): Promise<StoreResult<{ id: string; alreadyExists?: boolean }>> {
  const c = client()
  if (!c) return { ok: false, error: SUPABASE_UNCONFIGURED }
  try {
    const res = await c.from('sub_harnesses').insert({
      loop_id:  input.loop_id ?? null,
      user_id:  userId,
      slug:     input.slug,
      goal_md:  input.goal_md ?? '',
      manifest: input.manifest ?? {},
      status:   'draft',
    }).select('id').single()
    if (res.error) {
      // Unique (user_id, slug) violation → treat as idempotent: return existing.
      if (/duplicate key|unique constraint|sub_harnesses_user_slug_uniq/i.test(res.error.message)) {
        const existing = await getSubHarness(input.slug, userId)
        if (existing.ok && existing.harness) return { ok: true, id: existing.harness.id, alreadyExists: true }
      }
      return fail(res.error.message)
    }
    return { ok: true, id: (res.data as { id: string }).id }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'create_failed')
  }
}

export async function listSubHarnesses(userId: string): Promise<StoreResult<{ harnesses: SubHarness[] }>> {
  const c = client()
  if (!c) return { ok: false, error: SUPABASE_UNCONFIGURED }
  try {
    const res = await c.from('sub_harnesses').select('*').eq('user_id', userId).order('created_at', { ascending: false })
    if (res.error) return fail(res.error.message)
    return { ok: true, harnesses: (res.data ?? []) as SubHarness[] }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'list_failed')
  }
}

export async function getSubHarness(slug: string, userId: string): Promise<StoreResult<{ harness: SubHarness | null }>> {
  const c = client()
  if (!c) return { ok: false, error: SUPABASE_UNCONFIGURED }
  try {
    const res = await c.from('sub_harnesses').select('*').eq('user_id', userId).eq('slug', slug).maybeSingle()
    if (res.error) return fail(res.error.message)
    return { ok: true, harness: (res.data as SubHarness | null) ?? null }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'read_failed')
  }
}

export async function setSubHarnessStatus(slug: string, userId: string, status: SubHarnessStatus, verifiedBy?: string): Promise<StoreResult<{ harness: SubHarness }>> {
  const c = client()
  if (!c) return { ok: false, error: SUPABASE_UNCONFIGURED }
  const row: Record<string, unknown> = { status }
  if (status === 'verified') {
    row.verified_at = new Date().toISOString()
    row.verified_by = verifiedBy ?? null
  }
  try {
    const res = await c.from('sub_harnesses').update(row).eq('user_id', userId).eq('slug', slug).select('*').maybeSingle()
    if (res.error) return fail(res.error.message)
    if (!res.data) return { ok: false, error: 'not_found' }
    return { ok: true, harness: res.data as SubHarness }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'update_failed')
  }
}

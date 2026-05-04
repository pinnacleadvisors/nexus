/**
 * Kill switches — Mission Control Kit Pack 02 ported to Postgres.
 *
 * Six hot-reloadable boolean gates backed by the `kill_switches` table from
 * migration 028. Toggling a switch propagates within ~60 s thanks to the
 * in-memory cache below.
 *
 * The kit's pattern was a `.env` file mtime check, which doesn't work on
 * serverless (no shared FS). We use a tiny Postgres table + 60 s TTL cache.
 *
 * Usage:
 *   import { isEnabled, assertEnabled, KillSwitchKey } from '@/lib/kill-switches'
 *
 *   if (!await isEnabled('llm_dispatch')) {
 *     return NextResponse.json({ error: 'llm_dispatch is disabled' }, { status: 503 })
 *   }
 *
 *   await assertEnabled('slack_warroom')   // throws KillSwitchDisabledError
 */

import { createServerClient } from '@/lib/supabase'

// Stable canonical keys — must match seed in migration 028.
export type KillSwitchKey =
  | 'llm_dispatch'
  | 'auto_assign'
  | 'scheduler'
  | 'dashboard_mutations'
  | 'slack_warroom'
  | 'swarm_consensus'

export const KILL_SWITCH_KEYS: KillSwitchKey[] = [
  'llm_dispatch',
  'auto_assign',
  'scheduler',
  'dashboard_mutations',
  'slack_warroom',
  'swarm_consensus',
]

export interface KillSwitchRow {
  key:         KillSwitchKey
  enabled:     boolean
  description: string
  updatedAt:   string
  updatedBy:   string | null
}

// ── Cache ────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60_000
let cache: { rows: Map<KillSwitchKey, KillSwitchRow>; expiresAt: number } | null = null
let inFlight: Promise<Map<KillSwitchKey, KillSwitchRow>> | null = null

interface RawRow {
  key: string; enabled: boolean; description: string;
  updated_at: string; updated_by: string | null
}

// kill_switches isn't in lib/database.types.ts yet — same escape-hatch pattern
// as lib/memory/supabase-reader.ts and lib/business/db.ts.
type LooseRead<T> = {
  select: (s: string) => LooseRead<T> & Promise<{ data: T[] | null; error: { message: string } | null }>
  eq: (k: string, v: unknown) => LooseRead<T>
}

async function fetchAll(): Promise<Map<KillSwitchKey, KillSwitchRow>> {
  const db = createServerClient()
  if (!db) {
    // No Supabase → fail-open with seed defaults (every switch enabled).
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[kill-switches] supabase not configured; defaulting all switches to enabled')
    }
    const fallback = new Map<KillSwitchKey, KillSwitchRow>()
    const now = new Date().toISOString()
    for (const key of KILL_SWITCH_KEYS) {
      fallback.set(key, { key, enabled: true, description: '(no-db fallback)', updatedAt: now, updatedBy: null })
    }
    return fallback
  }
  const { data, error } = await (db.from('kill_switches' as never) as unknown as LooseRead<RawRow>)
    .select('key, enabled, description, updated_at, updated_by')
  if (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[kill-switches] supabase read failed; defaulting all switches to enabled:', error.message)
    }
    const fallback = new Map<KillSwitchKey, KillSwitchRow>()
    const now = new Date().toISOString()
    for (const key of KILL_SWITCH_KEYS) {
      fallback.set(key, { key, enabled: true, description: '(read-error fallback)', updatedAt: now, updatedBy: null })
    }
    return fallback
  }
  const rows = new Map<KillSwitchKey, KillSwitchRow>()
  for (const r of (data ?? [])) {
    if (KILL_SWITCH_KEYS.includes(r.key as KillSwitchKey)) {
      rows.set(r.key as KillSwitchKey, {
        key:         r.key as KillSwitchKey,
        enabled:     Boolean(r.enabled),
        description: r.description ?? '',
        updatedAt:   r.updated_at,
        updatedBy:   r.updated_by,
      })
    }
  }
  // Any seeded key missing from the DB read is treated as enabled.
  for (const key of KILL_SWITCH_KEYS) {
    if (!rows.has(key)) {
      rows.set(key, { key, enabled: true, description: '(missing row, default enabled)', updatedAt: new Date().toISOString(), updatedBy: null })
    }
  }
  return rows
}

async function refresh(): Promise<Map<KillSwitchKey, KillSwitchRow>> {
  if (inFlight) return inFlight
  inFlight = fetchAll().then(rows => {
    cache = { rows, expiresAt: Date.now() + CACHE_TTL_MS }
    inFlight = null
    return rows
  }).catch(err => {
    inFlight = null
    throw err
  })
  return inFlight
}

async function getRows(): Promise<Map<KillSwitchKey, KillSwitchRow>> {
  if (cache && cache.expiresAt > Date.now()) return cache.rows
  return refresh()
}

// ── Public API ───────────────────────────────────────────────────────────────
export async function isEnabled(key: KillSwitchKey): Promise<boolean> {
  const rows = await getRows()
  return rows.get(key)?.enabled ?? true
}

export async function listSwitches(): Promise<KillSwitchRow[]> {
  const rows = await getRows()
  return KILL_SWITCH_KEYS.map(k => rows.get(k)!).filter(Boolean)
}

export class KillSwitchDisabledError extends Error {
  code = 'KILL_SWITCH_DISABLED' as const
  switchKey: KillSwitchKey
  constructor(key: KillSwitchKey) {
    super(`kill switch '${key}' is disabled`)
    this.switchKey = key
  }
}

export async function assertEnabled(key: KillSwitchKey): Promise<void> {
  if (!(await isEnabled(key))) throw new KillSwitchDisabledError(key)
}

/**
 * Toggle a switch. Owner-enforced at the API route level — this fn assumes
 * caller has already verified ownership.
 */
export async function setSwitch(key: KillSwitchKey, enabled: boolean, updatedBy: string): Promise<KillSwitchRow | null> {
  const db = createServerClient()
  if (!db) return null
  type LooseUpdate = {
    update: (patch: Record<string, unknown>) => LooseUpdate
    eq:     (k: string, v: unknown) => LooseUpdate
    select: (cols: string) => LooseUpdate
    single: () => Promise<{ data: RawRow | null; error: { message: string } | null }>
  }
  const { data, error } = await (db.from('kill_switches' as never) as unknown as LooseUpdate)
    .update({ enabled, updated_by: updatedBy })
    .eq('key', key)
    .select('key, enabled, description, updated_at, updated_by')
    .single()
  if (error || !data) return null
  // Invalidate cache immediately — next read sees the change.
  cache = null
  return {
    key: data.key as KillSwitchKey, enabled: data.enabled,
    description: data.description ?? '', updatedAt: data.updated_at, updatedBy: data.updated_by,
  }
}

/** Force-refresh the cache. Used by tests or admin tooling. */
export function invalidateCache(): void { cache = null }

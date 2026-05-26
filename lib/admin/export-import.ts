/**
 * lib/admin/export-import.ts — operator data export/import primitive
 * for cross-machine migration (Phase 5 of task_plan-desktop-app.md,
 * PR #385).
 *
 * v1 dumps the operator's logical-app data only — not the full schema.
 * Tables included = "everything the operator built": businesses, agents,
 * connected_accounts metadata (no secrets!), goals, issues, simulation
 * runs/events/benchmarks, operator_tasks, learning_cards, memories.
 *
 * NOT included (intentionally):
 *   • secrets / API keys — operator manages these locally per-deployment
 *   • token_events / experiment_metrics — observability noise; reset on
 *     each install, not portable
 *   • run_events / chat_messages — too verbose; reset on install
 *
 * Schema-version bumps let future exports add fields without breaking
 * older importers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const EXPORT_SCHEMA_VERSION = 1

/** Tables included in the export, in INSERT-order (parents before children). */
export const EXPORT_TABLES: readonly string[] = [
  'business_operators',
  'agent_library',
  'connected_accounts',
  'goals',
  'issues',
  'operator_tasks',
  'learning_cards',
  'memories',
  'simulation_runs',
  'simulation_events',
  'simulation_benchmarks',
  'simulation_benchmark_runs',
  'simulation_voice_cache',
] as const

export interface ExportPayload {
  schema_version: number
  exported_at:    string
  exported_by:    string                     // userId (sentinel 'local-operator' if LOCAL_MODE)
  source: {
    base_url:     string | null
    deployment:   'coolify' | 'local' | 'unknown'
  }
  tables: Record<string, unknown[]>
  /** Best-effort row counts, useful as a sanity check on the import side. */
  counts: Record<string, number>
}

interface MinimalChain {
  select: (cols: string) => { eq: (col: string, val: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }> }
}

export async function exportData(db: SupabaseClient, userId: string): Promise<ExportPayload> {
  const tables: Record<string, unknown[]> = {}
  const counts: Record<string, number>    = {}

  for (const table of EXPORT_TABLES) {
    try {
      const res = await (db.from(table as never) as unknown as MinimalChain)
        .select('*').eq('user_id', userId)
      if (res.error) {
        // Some tables don't have user_id (simulation_voice_cache, simulation_benchmark_runs).
        // Fall back to global pull for those.
        const globalRes = await (db.from(table as never) as unknown as { select: (c: string) => Promise<{ data: unknown[] | null }> })
          .select('*')
        tables[table] = globalRes.data ?? []
      } else {
        tables[table] = res.data ?? []
      }
      counts[table] = tables[table].length
    } catch (err) {
      console.warn(`[export] table ${table} pull failed (non-fatal):`, err instanceof Error ? err.message : err)
      tables[table] = []
      counts[table] = 0
    }
  }

  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at:    new Date().toISOString(),
    exported_by:    userId,
    source: {
      base_url:   process.env.NEXUS_BASE_URL?.trim() || null,
      deployment: process.env.LOCAL_MODE === '1' ? 'local' : (process.env.NEXUS_BASE_URL ? 'coolify' : 'unknown'),
    },
    tables,
    counts,
  }
}

export interface ImportResult {
  ok:                boolean
  inserted:          Record<string, number>
  skipped:           Record<string, number>
  errors:            Array<{ table: string; message: string }>
}

export interface ImportInput {
  db:          SupabaseClient
  targetUserId: string
  payload:     ExportPayload
  /** When true (default), rewrites every row's user_id to targetUserId. Set false to preserve original ids. */
  rewriteUserId: boolean
}

export async function importData(input: ImportInput): Promise<ImportResult> {
  const result: ImportResult = {
    ok:       true,
    inserted: {},
    skipped:  {},
    errors:   [],
  }

  if (input.payload.schema_version !== EXPORT_SCHEMA_VERSION) {
    result.ok = false
    result.errors.push({
      table:   '(meta)',
      message: `schema_version mismatch: payload=${input.payload.schema_version} expected=${EXPORT_SCHEMA_VERSION}`,
    })
    return result
  }

  for (const table of EXPORT_TABLES) {
    const rows = input.payload.tables[table] ?? []
    result.inserted[table] = 0
    result.skipped[table]  = 0
    if (rows.length === 0) continue

    // Strip the existing id field where present so the destination DB
    // generates fresh uuids (avoids unique-constraint clashes when the
    // source + target overlap). Rewrite user_id when requested.
    const prepared = rows.map(r => {
      const row = { ...(r as Record<string, unknown>) }
      delete row.id
      if (input.rewriteUserId && 'user_id' in row) row.user_id = input.targetUserId
      return row
    })

    try {
      // Insert in batches of 200 to stay under Supabase's request payload cap.
      for (let i = 0; i < prepared.length; i += 200) {
        const batch = prepared.slice(i, i + 200)
        const res = await (input.db.from(table as never) as unknown as {
          insert: (r: unknown[]) => Promise<{ error: { message: string } | null; count?: number | null }>
        }).insert(batch)
        if (res.error) {
          result.errors.push({ table, message: res.error.message })
          result.ok = false
        } else {
          result.inserted[table] += batch.length
        }
      }
    } catch (err) {
      result.errors.push({ table, message: err instanceof Error ? err.message : 'insert_failed' })
      result.ok = false
    }
  }

  return result
}

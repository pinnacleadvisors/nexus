/**
 * insertTask — fail-soft Kanban card insert.
 *
 * Migration 025 added `idea_id`, `run_id`, and `business_slug` columns to
 * `tasks`. When the code is deployed before the migration has been applied,
 * every insert touching those columns fails with PostgreSQL's
 * "column 'X' does not exist" error. n8n and OpenClaw both auto-retry 5xx
 * webhook responses, so a missing migration turned every webhook callback
 * into a retry storm that hammered PostgREST until workers were killed by
 * the timeout manager.
 *
 * This helper detects the migration state on the first call and caches it
 * for the lifetime of the process. If the columns aren't available, it
 * strips them from the row and retries the insert. Either way the caller
 * sees a normal Supabase insert response and the upstream service does NOT
 * retry. Once the operator applies migration 025 and the next deploy
 * recycles the function instance, the cache resets and lineage is stamped
 * again.
 *
 * Usage:
 *   const { error } = await insertTask(db, {
 *     title:         '...',
 *     description:   '...',
 *     column_id:     'review',
 *     business_slug: 'ledger-lane', // safely dropped if migration missing
 *     run_id:        runId,         // ditto
 *   })
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

type TaskInsert = Database['public']['Tables']['tasks']['Insert']

interface InsertResult {
  error: { message: string } | null
}

// Per-process cache. Reset on cold start (which happens on every deploy on
// Vercel) so the operator's "I forgot the migration" state self-heals after
// the migration is applied + next deploy.
let lineageAvailable: boolean | null = null

const LINEAGE_KEYS = ['idea_id', 'run_id', 'business_slug'] as const

function stripLineage(row: TaskInsert): TaskInsert {
  const out = { ...row } as Record<string, unknown>
  for (const k of LINEAGE_KEYS) delete out[k]
  return out as TaskInsert
}

function isMissingLineageColumn(message: string): boolean {
  if (!message) return false
  // PostgreSQL: `column "business_slug" of relation "tasks" does not exist`
  return /column .*(idea_id|run_id|business_slug).* does not exist/i.test(message)
}

export async function insertTask(
  db: SupabaseClient<Database>,
  row: TaskInsert,
): Promise<InsertResult> {
  if (lineageAvailable === false) {
    return await db.from('tasks').insert(stripLineage(row))
  }

  const first = await db.from('tasks').insert(row)
  if (first.error && isMissingLineageColumn(first.error.message)) {
    // Only log on first detection — subsequent calls hit the cached
    // `lineageAvailable === false` early return above.
    if (lineageAvailable === null) {
      console.warn(
        '[insertTask] tasks.idea_id/run_id/business_slug missing — apply migration 025_tasks_lineage. Falling back to lineage-free inserts for this process.',
      )
    }
    lineageAvailable = false
    return await db.from('tasks').insert(stripLineage(row))
  }

  // Mark good on first successful insert (true = columns exist, no need to
  // probe again).
  if (!first.error && lineageAvailable === null) lineageAvailable = true
  return first
}

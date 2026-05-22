/**
 * insertGoal — fail-soft goal insert that gracefully handles the case where
 * migration 047_goals.sql has not yet been applied.
 *
 * Pattern: try the insert; on "relation \"goals\" does not exist" PG error,
 * mark the table absent for the lifetime of the process and return a stub
 * success result with id=null. Callers that need the id (e.g. to seed the
 * downstream issues.goal_id FK) can branch on id=null to skip the linkage.
 *
 * Logs a single warning the first time the table is detected as missing so
 * the operator sees the missing-migration hint exactly once per process.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

export interface GoalInsert {
  business_slug:     string
  title:             string
  success_criteria?: string | null
  parent_goal_id?:   string | null
  status?:           'active' | 'completed' | 'cancelled' | 'archived'
}

export interface GoalInsertResult {
  id: string | null
  error: { message: string } | null
}

let goalsTableAvailable: boolean | null = null

function isMissingGoalsTable(message: string): boolean {
  if (!message) return false
  return /relation .*goals.* does not exist/i.test(message)
}

export async function insertGoal(
  db: SupabaseClient<Database>,
  row: GoalInsert,
): Promise<GoalInsertResult> {
  if (goalsTableAvailable === false) {
    return { id: null, error: null }
  }

  const from = (db as unknown as {
    from: (t: string) => {
      insert: (r: GoalInsert) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>
        }
      }
    }
  }).from('goals')

  const res = await from.insert(row).select('id').single()

  if (res.error && isMissingGoalsTable(res.error.message)) {
    if (goalsTableAvailable === null) {
      console.warn(
        '[insertGoal] goals table missing — apply migration 047_goals. Returning {id: null} so callers fail-soft.',
      )
    }
    goalsTableAvailable = false
    return { id: null, error: null }
  }

  if (!res.error && goalsTableAvailable === null) goalsTableAvailable = true
  return { id: res.data?.id ?? null, error: res.error }
}

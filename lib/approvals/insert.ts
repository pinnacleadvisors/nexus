/**
 * insertApproval — fail-soft approval insert that gracefully handles the case
 * where migration 050_approvals_first_class.sql has not yet been applied.
 *
 * Type validation runs BEFORE the insert — even when the table is missing —
 * because callers passing an invalid `type` are buggy regardless of migration
 * state. Catching it here surfaces the bug deterministically instead of
 * silently dropping the row in fail-soft mode.
 *
 * The 5 enum values mirror the solopreneur-loop spec exactly. Adding a 6th
 * requires updating BOTH this validator AND the CHECK constraint in migration
 * 050; otherwise rows insert here but fail at the DB.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

export const APPROVAL_TYPES = [
  'niche_pick',
  'domain_purchase',
  'first_n_posts',
  'paid_saas_signup',
  'pricing_change',
] as const

export type ApprovalType = typeof APPROVAL_TYPES[number]

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface ApprovalInsert {
  business_slug:     string
  type:              ApprovalType
  status?:           ApprovalStatus
  payload?:          Record<string, unknown>
  created_by_agent?: string | null
}

export interface ApprovalInsertResult {
  id: string | null
  error: { message: string } | null
}

let approvalsTableAvailable: boolean | null = null

function isMissingApprovalsTable(message: string): boolean {
  if (!message) return false
  return /relation .*approvals.* does not exist/i.test(message)
}

export async function insertApproval(
  db: SupabaseClient<Database>,
  row: ApprovalInsert,
): Promise<ApprovalInsertResult> {
  if (!APPROVAL_TYPES.includes(row.type as ApprovalType)) {
    return {
      id: null,
      error: { message: `invalid approval type "${row.type}" — must be one of ${APPROVAL_TYPES.join(', ')}` },
    }
  }

  if (approvalsTableAvailable === false) {
    return { id: null, error: null }
  }

  const from = (db as unknown as {
    from: (t: string) => {
      insert: (r: ApprovalInsert) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>
        }
      }
    }
  }).from('approvals')

  const res = await from.insert(row).select('id').single()

  if (res.error && isMissingApprovalsTable(res.error.message)) {
    if (approvalsTableAvailable === null) {
      console.warn(
        '[insertApproval] approvals table missing — apply migration 050_approvals_first_class. Returning {id: null}; pending-gate UI will show empty until migration lands.',
      )
    }
    approvalsTableAvailable = false
    return { id: null, error: null }
  }

  if (!res.error && approvalsTableAvailable === null) approvalsTableAvailable = true
  return { id: res.data?.id ?? null, error: res.error }
}

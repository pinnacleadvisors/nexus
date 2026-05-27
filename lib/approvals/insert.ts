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

  // R4 follow-up: fire-and-forget operator notification on a successful
  // pending-approval insert. We never block the insert path on the
  // dispatch — if Slack or web push fails the approval is still queued
  // in the DB and the operator can find it via /approvals. Fan-out to
  // every operator in ALLOWED_USER_IDS so multi-operator deployments
  // (future) Just Work. Operators can opt-out per-category via the
  // settings panel.
  if (!res.error && res.data?.id && (row.status ?? 'pending') === 'pending') {
    void dispatchApprovalNotification(row, res.data.id)
  }

  return { id: res.data?.id ?? null, error: res.error }
}

/** Lazy-dispatch helper — kept out of insertApproval's hot path so the
 *  dispatch's `await import('@/lib/notifications/...')` cost is paid only
 *  when an approval actually lands. Errors are swallowed (logging only). */
async function dispatchApprovalNotification(
  row:        ApprovalInsert,
  approvalId: string,
): Promise<void> {
  try {
    const [{ listOperatorUserIds }, { notifyOperator }] = await Promise.all([
      import('@/lib/notifications/operators'),
      import('@/lib/notifications/dispatch'),
    ])
    const operatorIds = listOperatorUserIds()
    if (operatorIds.length === 0) return
    const title = `New approval: ${row.type.replace(/_/g, ' ')}`
    const body  = row.business_slug
      ? `${row.business_slug}: ${row.type.replace(/_/g, ' ')} pending`
      : `${row.type.replace(/_/g, ' ')} pending`
    // Fan-out in parallel; each notifyOperator call is itself fail-soft.
    await Promise.all(operatorIds.map(userId =>
      notifyOperator(userId, 'approval-pending', {
        title,
        body,
        link_href:     `/approvals?focus=${approvalId}`,
        severity:      'info',
        business_slug: row.business_slug,
      }).catch(() => undefined),
    ))
  } catch {
    // Never let a notification failure propagate out of insertApproval —
    // the approval landed in the DB successfully; the operator can find
    // it via /approvals even if the ping never fired.
  }
}

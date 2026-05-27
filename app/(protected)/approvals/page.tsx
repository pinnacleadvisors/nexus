/**
 * /approvals — unified inbox (Paperclip absorption Task 3e).
 *
 * Server component. Lists pending `approvals` rows across all businesses,
 * sorted by created_at desc. Each card shows the type (5-category gate
 * matrix: niche_pick / domain_purchase / first_n_posts / paid_saas_signup
 * / pricing_change), business, payload summary, and approve/reject buttons.
 *
 * Approve / Reject are wired via components/approvals/ApprovalCard.tsx →
 * POST /api/approvals/[id]/decide. The route handles idempotency
 * (terminal rows return 200 with existing decision) and is retry-storm
 * safe (200 + {ok: false} on transient errors).
 */

import { createServerClient } from '@/lib/supabase'
import ApprovalCard from '@/components/approvals/ApprovalCard'
import { ShieldCheck } from 'lucide-react'

interface ApprovalRow {
  id:               string
  business_slug:    string
  type:             string
  status:           string
  payload:          Record<string, unknown> | null
  created_by_agent: string | null
  created_at:       string
}

async function fetchPending(): Promise<ApprovalRow[]> {
  const db = createServerClient()
  if (!db) return []
  const res = await (db as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: { message: string } | null }>
        }
      }
    }
  }).from('approvals')
    .select('id,business_slug,type,status,payload,created_by_agent,created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  return ((res.data ?? []) as ApprovalRow[]) || []
}

export default async function ApprovalsInboxPage() {
  const approvals = await fetchPending()

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-zinc-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
          <p className="text-sm text-zinc-400">
            {approvals.length} pending across all businesses. Typed via the 5-category gate matrix.
          </p>
        </div>
      </header>

      {approvals.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-zinc-400">
            No pending approvals. Apply migration 050_approvals_first_class.sql to enable.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {approvals.map(a => (
            <li key={a.id}>
              <ApprovalCard approval={a} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

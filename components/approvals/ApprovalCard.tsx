'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, X, Check, Loader2 } from 'lucide-react'

interface ApprovalRow {
  id:               string
  business_slug:    string
  type:             string
  status:           string
  payload:          Record<string, unknown> | null
  created_by_agent: string | null
  created_at:       string
}

interface Props {
  approval: ApprovalRow
}

const TYPE_LABEL: Record<string, string> = {
  niche_pick:       'Niche selection',
  domain_purchase:  'Domain purchase',
  first_n_posts:    'First N posts go live',
  paid_saas_signup: 'Paid SaaS signup',
  pricing_change:   'Pricing change',
}

const TYPE_COLOR: Record<string, string> = {
  niche_pick:       'bg-blue-500/10 text-blue-400',
  domain_purchase:  'bg-purple-500/10 text-purple-400',
  first_n_posts:    'bg-cyan-500/10 text-cyan-400',
  paid_saas_signup: 'bg-amber-500/10 text-amber-400',
  pricing_change:   'bg-rose-500/10 text-rose-400',
}

export default function ApprovalCard({ approval }: Props) {
  // Wired to POST /api/approvals/[id]/decide. Optimistic-then-refresh:
  // disable buttons during the request, router.refresh() on success so the
  // list re-fetches and the just-decided row drops out (or shows as decided).
  const [busy, setBusy]   = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  async function decide(action: 'approve' | 'reject') {
    if (busy || pending) return
    setBusy(action)
    setError(null)
    try {
      const res = await fetch(`/api/approvals/${approval.id}/decide`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ decision: action }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!j.ok) {
        setError(j.error ?? `HTTP ${res.status}`)
        return
      }
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setBusy(null)
    }
  }

  const label = TYPE_LABEL[approval.type] ?? approval.type
  const color = TYPE_COLOR[approval.type] ?? 'bg-zinc-500/10 text-zinc-400'
  const payloadSummary = approval.payload && Object.keys(approval.payload).length > 0
    ? JSON.stringify(approval.payload).slice(0, 200)
    : null

  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ShieldCheck className="h-4 w-4 flex-shrink-0 text-zinc-400" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs ${color}`}>{label}</span>
              <Link href={`/companies/${approval.business_slug}`} className="text-sm text-zinc-300 hover:text-zinc-100">
                {approval.business_slug}
              </Link>
              <span className="text-xs text-zinc-600">·</span>
              <time className="text-xs text-zinc-500" dateTime={approval.created_at}>
                {new Date(approval.created_at).toLocaleString()}
              </time>
            </div>
            {payloadSummary && (
              <p className="mt-2 truncate font-mono text-xs text-zinc-500">{payloadSummary}</p>
            )}
            {approval.created_by_agent && (
              <p className="mt-1 text-xs text-zinc-500">requested by: {approval.created_by_agent}</p>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 gap-2">
          <button
            type="button"
            disabled={busy !== null || pending}
            onClick={() => decide('reject')}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/40 px-2.5 py-1 text-xs text-zinc-300 transition hover:bg-rose-900/30 hover:border-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === 'reject' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            Reject
          </button>
          <button
            type="button"
            disabled={busy !== null || pending}
            onClick={() => decide('approve')}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-700 bg-emerald-900/30 px-2.5 py-1 text-xs text-emerald-300 transition hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === 'approve' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Approve
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-2 text-xs text-rose-400">
          {error === 'approvals_table_missing'
            ? 'Apply migration 050_approvals_first_class.sql to enable decisions.'
            : error}
        </p>
      )}
    </article>
  )
}

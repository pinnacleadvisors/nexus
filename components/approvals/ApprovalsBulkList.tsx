'use client'

/**
 * ApprovalsBulkList — R2 of the UX consultation. Adds checkbox-driven
 * bulk approve / reject to /approvals so the operator can decide many
 * similar approvals in two clicks instead of N individual ones.
 *
 * Three selection affordances stacked on top of the existing
 * ApprovalCard rows:
 *   1. Per-row checkbox
 *   2. "Select all of type X" pills (one per approval type present)
 *   3. Master "Select all" toggle in the bulk-action bar
 *
 * When ≥1 row is selected, a sticky bulk-action bar appears at the top
 * showing the count + "Approve selected" / "Reject selected" buttons.
 * Both call POST /api/approvals/decide-batch which returns a per-id
 * result map; the UI removes successful rows optimistically + flags
 * partial failures with an inline banner.
 *
 * The single-row Approve/Reject buttons inside each ApprovalCard still
 * work — bulk is purely additive. Operators who like the per-row flow
 * never touch the checkboxes.
 */

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Loader2, Square, CheckSquare, ShieldCheck } from 'lucide-react'
import ApprovalCard from './ApprovalCard'

interface ApprovalRow {
  id:               string
  business_slug:    string
  type:             string
  status:           string
  payload:          Record<string, unknown> | null
  created_by_agent: string | null
  created_at:       string
}

interface BatchResult {
  ok:               boolean
  total?:           number
  approved?:        number
  rejected?:        number
  already_decided?: number
  not_found?:       number
  errors?:          number
  results?:         Array<{
    id:     string
    ok:     boolean
    status: 'approved' | 'rejected' | 'already_decided' | 'not_found' | 'error'
    error?: string
  }>
  error?:           string
  hint?:            string
}

const TYPE_LABEL: Record<string, string> = {
  niche_pick:       'Niche selection',
  domain_purchase:  'Domain purchase',
  first_n_posts:    'First N posts',
  paid_saas_signup: 'Paid SaaS signup',
  pricing_change:   'Pricing change',
}

export default function ApprovalsBulkList({ approvals: initial }: { approvals: ApprovalRow[] }) {
  const router = useRouter()
  const [approvals, setApprovals] = useState<ApprovalRow[]>(initial)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTx] = useTransition()
  const [banner, setBanner] = useState<{ kind: 'success' | 'partial' | 'error'; text: string } | null>(null)

  // Group approvals by type so we can show "Select all of type X" pills.
  // Stable order: most-frequent type first.
  const byType = useMemo(() => {
    const m = new Map<string, ApprovalRow[]>()
    for (const a of approvals) {
      const arr = m.get(a.type) ?? []
      arr.push(a)
      m.set(a.type, arr)
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [approvals])

  const allIds = useMemo(() => approvals.map(a => a.id), [approvals])
  const allSelected = selected.size > 0 && selected.size === allIds.length

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectGroup = (type: string) => {
    setSelected(prev => {
      const next  = new Set(prev)
      const group = approvals.filter(a => a.type === type)
      const allInGroup = group.every(g => next.has(g.id))
      // Toggle: if all of the group are already selected, deselect them.
      // Otherwise add the missing ones.
      if (allInGroup) {
        for (const g of group) next.delete(g.id)
      } else {
        for (const g of group) next.add(g.id)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelected(prev => (prev.size === allIds.length ? new Set() : new Set(allIds)))
  }

  const decide = (decision: 'approve' | 'reject') => {
    if (selected.size === 0 || pending) return
    setBanner(null)
    startTx(async () => {
      const ids = Array.from(selected)
      try {
        const r = await fetch('/api/approvals/decide-batch', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ids, decision }),
        })
        const b = await r.json() as BatchResult
        if (!b.ok) {
          setBanner({ kind: 'error', text: b.hint ? `${b.error}: ${b.hint}` : (b.error ?? 'batch decision failed') })
          return
        }
        const ok       = (b.approved ?? 0) + (b.rejected ?? 0)
        const already  = b.already_decided ?? 0
        const failed   = (b.errors ?? 0) + (b.not_found ?? 0)
        // Optimistic: remove rows that landed in a terminal state.
        const removedIds = new Set(b.results?.filter(r => r.ok && (r.status === 'approved' || r.status === 'rejected' || r.status === 'already_decided')).map(r => r.id) ?? [])
        setApprovals(prev => prev.filter(a => !removedIds.has(a.id)))
        setSelected(new Set())
        if (failed === 0) {
          setBanner({ kind: 'success', text: `${ok} ${decision === 'approve' ? 'approved' : 'rejected'}${already ? ` · ${already} already decided` : ''}.` })
        } else {
          setBanner({ kind: 'partial', text: `${ok} succeeded · ${failed} failed · ${already} already decided. Refresh the page to retry failures.` })
        }
        // Refresh the server data so anything ELSE that touched approvals
        // (e.g. a chat agent decided a row out-of-band) shows up too.
        router.refresh()
      } catch (err) {
        setBanner({ kind: 'error', text: err instanceof Error ? err.message : 'network error' })
      }
    })
  }

  if (approvals.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
        <p className="text-zinc-400">
          No pending approvals. Apply migration 050_approvals_first_class.sql to enable.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Bulk-action bar — sticky top so it stays in reach when scrolling
          a long list. Hidden until ≥1 selection. */}
      {selected.size > 0 && (
        <div
          className="sticky top-0 z-20 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-700/40 bg-violet-950/40 p-3 backdrop-blur"
          role="region"
          aria-label="Bulk approval actions"
        >
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-violet-300" />
            <span className="font-medium text-violet-200">{selected.size}</span>
            <span className="text-violet-300/80">selected</span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs text-violet-300/60 underline-offset-2 hover:text-violet-200 hover:underline"
            >
              clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => decide('reject')}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/40 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-rose-700 hover:bg-rose-900/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              Reject {selected.size}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => decide('approve')}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-700 bg-emerald-900/30 px-3 py-1.5 text-xs text-emerald-200 transition hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Approve {selected.size}
            </button>
          </div>
        </div>
      )}

      {/* Banner — result of the most recent batch. */}
      {banner && (
        <div
          className={
            'mb-3 rounded-lg border p-3 text-sm ' +
            (banner.kind === 'success' ? 'border-emerald-700/40 bg-emerald-900/20 text-emerald-200'
             : banner.kind === 'partial' ? 'border-amber-700/40 bg-amber-900/20 text-amber-200'
             : 'border-rose-700/40 bg-rose-900/20 text-rose-200')
          }
        >
          {banner.text}
        </div>
      )}

      {/* Group pills + master select-all. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={selectAll}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/40 px-3 py-1 text-xs text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800/70"
        >
          {allSelected ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
          {allSelected ? 'Deselect all' : 'Select all'}
          <span className="text-zinc-500">{approvals.length}</span>
        </button>
        <span className="text-[10px] text-zinc-600">·</span>
        {byType.map(([type, rows]) => {
          const groupSelected = rows.every(r => selected.has(r.id))
          return (
            <button
              key={type}
              type="button"
              onClick={() => selectGroup(type)}
              className={
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ' +
                (groupSelected
                  ? 'border-violet-600 bg-violet-900/40 text-violet-200'
                  : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200')
              }
            >
              {groupSelected ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
              {TYPE_LABEL[type] ?? type}
              <span className={groupSelected ? 'text-violet-300/60' : 'text-zinc-600'}>{rows.length}</span>
            </button>
          )
        })}
      </div>

      <ul className="space-y-3">
        {approvals.map(a => {
          const checked = selected.has(a.id)
          return (
            <li key={a.id} className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => toggle(a.id)}
                className="mt-4 flex-shrink-0 rounded p-1 text-zinc-500 transition hover:bg-zinc-800/60 hover:text-zinc-200"
                aria-label={checked ? 'Deselect approval' : 'Select approval'}
                aria-pressed={checked}
              >
                {checked
                  ? <CheckSquare className="h-4 w-4 text-violet-400" />
                  : <Square      className="h-4 w-4" />}
              </button>
              <div className="min-w-0 flex-1">
                <ApprovalCard approval={a} />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

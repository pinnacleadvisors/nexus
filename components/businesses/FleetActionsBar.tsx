'use client'

/**
 * FleetActionsBar — R7 multi-business bulk actions on /businesses.
 *
 * Renders above the tile grid. Operator clicks "Select" to enter
 * select-mode, picks tiles, then runs a bulk action (Pause / Resume /
 * Run smoke / Refresh KPIs). Results show in a banner.
 *
 * The tile grid itself uses a simple cookie-free local-state pattern:
 * the parent `/businesses` page renders the tiles as a server component,
 * but this client wrapper intercepts the click via data-slug attributes.
 *
 * For now we expose a simple "operator types slugs comma-separated"
 * shortcut + scoped action buttons. Per-tile checkbox selection is
 * deferred to V2 (would require turning BusinessTile into a client
 * component just for the checkbox state).
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pause, Play, FlaskConical, RefreshCw, Briefcase, AlertCircle, CheckCircle2 } from 'lucide-react'

type Action = 'pause' | 'resume' | 'run-smoke' | 'refresh-kpis'

interface Props {
  /** Slugs the operator is currently working with — passed from the
   *  server-rendered tile grid. The bar lets the operator pick a
   *  subset via a comma-separated list. */
  availableSlugs: string[]
}

interface BulkResponse {
  ok:         boolean
  action?:    Action
  total?:     number
  ok_count?:  number
  failed?:    number
  by_status?: Record<string, number>
  error?:     string
}

const ACTION_LABEL: Record<Action, string> = {
  'pause':         'Pause',
  'resume':        'Resume',
  'run-smoke':     'Run smoke',
  'refresh-kpis':  'Refresh KPIs',
}

const ACTION_ICON: Record<Action, typeof Pause> = {
  'pause':         Pause,
  'resume':        Play,
  'run-smoke':     FlaskConical,
  'refresh-kpis':  RefreshCw,
}

export default function FleetActionsBar({ availableSlugs }: Props) {
  const router = useRouter()
  const [open, setOpen]       = useState(false)
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set())
  const [pending, startTx]    = useTransition()
  const [result, setResult]   = useState<BulkResponse | null>(null)

  if (availableSlugs.length < 2) {
    // Single business — no bulk action makes sense
    return null
  }

  const toggleSlug = (slug: string) => {
    setSelectedSlugs(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  const selectAll = () => {
    setSelectedSlugs(prev => prev.size === availableSlugs.length ? new Set() : new Set(availableSlugs))
  }

  const runAction = (action: Action) => {
    if (selectedSlugs.size === 0 || pending) return
    setResult(null)
    startTx(async () => {
      try {
        const r = await fetch('/api/businesses/bulk', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ action, ids: Array.from(selectedSlugs) }),
        })
        const b = await r.json() as BulkResponse
        setResult(b)
        if (b.ok) {
          // Drop the selection + refresh server data so status pills update.
          setSelectedSlugs(new Set())
          router.refresh()
        }
      } catch (err) {
        setResult({ ok: false, error: err instanceof Error ? err.message : 'network error' })
      }
    })
  }

  return (
    <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { setOpen(o => !o); if (!open) setResult(null) }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800/70"
        >
          <Briefcase className="h-3.5 w-3.5" />
          Fleet actions
          {selectedSlugs.size > 0 && (
            <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-300">{selectedSlugs.size}</span>
          )}
        </button>

        {open && (
          <>
            <button
              type="button"
              onClick={selectAll}
              className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/70"
            >
              {selectedSlugs.size === availableSlugs.length ? 'Deselect all' : 'Select all'} ({availableSlugs.length})
            </button>
            {(['pause', 'resume', 'run-smoke', 'refresh-kpis'] as Action[]).map(a => {
              const Icon = ACTION_ICON[a]
              const disabled = pending || selectedSlugs.size === 0
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => runAction(a)}
                  disabled={disabled}
                  className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    background: a === 'run-smoke' ? 'rgba(245,158,11,0.10)' :
                                a === 'pause'     ? 'rgba(239,68,68,0.10)'  :
                                a === 'resume'    ? 'rgba(34,197,94,0.10)'  :
                                                    'rgba(255,255,255,0.04)',
                    borderColor: a === 'run-smoke' ? 'rgba(245,158,11,0.30)' :
                                 a === 'pause'     ? 'rgba(239,68,68,0.30)'  :
                                 a === 'resume'    ? 'rgba(34,197,94,0.30)'  :
                                                     'rgba(255,255,255,0.08)',
                    color: a === 'run-smoke' ? '#fbbf24' :
                           a === 'pause'     ? '#f87171' :
                           a === 'resume'    ? '#4ade80' :
                                               '#9090b0',
                  }}
                >
                  {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                  {ACTION_LABEL[a]} {selectedSlugs.size > 0 ? selectedSlugs.size : ''}
                </button>
              )
            })}
          </>
        )}
      </div>

      {open && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {availableSlugs.map(slug => {
            const checked = selectedSlugs.has(slug)
            return (
              <button
                key={slug}
                type="button"
                onClick={() => toggleSlug(slug)}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-mono transition"
                style={{
                  background:  checked ? 'rgba(108,99,255,0.20)' : 'rgba(255,255,255,0.02)',
                  borderColor: checked ? 'rgba(108,99,255,0.40)' : 'rgba(255,255,255,0.10)',
                  color:       checked ? '#c4b5fd' : '#9090b0',
                }}
              >
                {checked ? '✓ ' : ''}{slug}
              </button>
            )
          })}
        </div>
      )}

      {result && (
        <div
          className={
            'mt-3 flex items-start gap-2 rounded-lg border p-2.5 text-xs ' +
            (result.ok ? 'border-emerald-700/40 bg-emerald-900/20 text-emerald-200'
                       : 'border-rose-700/40 bg-rose-900/20 text-rose-200')
          }
        >
          {result.ok
            ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            : <AlertCircle  className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />}
          <div className="min-w-0">
            {result.ok ? (
              <>
                <strong>{ACTION_LABEL[result.action as Action]}</strong> applied: {result.ok_count}/{result.total} succeeded
                {result.failed && result.failed > 0 ? `, ${result.failed} failed` : ''}.
                {result.by_status && (
                  <div className="mt-1 font-mono text-[10px] text-emerald-300/80">
                    {Object.entries(result.by_status).map(([k, v]) => `${k}: ${v}`).join('  ·  ')}
                  </div>
                )}
              </>
            ) : (
              <>Action failed: {result.error}</>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

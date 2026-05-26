'use client'

/**
 * BentoMissionControl — Paperclip-style bento hero for the Mission Control
 * dashboard. Phase 2 Task F (PR-276).
 *
 * Additive — mounted above the existing widgets. Operator gets the
 * Paperclip-aesthetic summary at the top + can scroll down to all the
 * existing detail. Once the new hero proves out, a follow-up PR can decide
 * which legacy widgets to retire.
 *
 * Layout:
 *   - 4 stat tiles in a responsive grid (4 cols lg, 2 cols md, 1 col sm)
 *   - HeartbeatTimeline tile spanning full width below the stats
 *
 * Each stat tile fetches its own data on mount so the hero stays
 * independent of the parent dashboard's data props. Tiles render their own
 * skeleton + error states so a single API hiccup doesn't blank the whole
 * hero.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  CircleDollarSign, Activity, ShieldCheck, Briefcase, Loader2,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react'
import HeartbeatTimeline from '@/components/heartbeat/HeartbeatTimeline'

interface RunEventRow {
  id:            string
  business_slug: string | null
  event_type:    string
  payload:       Record<string, unknown> | null
  created_at:    string
}

interface BentoState {
  spend24hUsd:        number | null
  spendDelta:         number | null    // change vs prior 24h, percent
  activeRuns:         number | null
  pendingApprovals:   number | null
  activeBusinesses:   number | null
  recentEvents:       RunEventRow[]
  loading:            boolean
  error:              string | null
}

const INITIAL: BentoState = {
  spend24hUsd:      null,
  spendDelta:       null,
  activeRuns:       null,
  pendingApprovals: null,
  activeBusinesses: null,
  recentEvents:     [],
  loading:          true,
  error:            null,
}

export default function BentoMissionControl() {
  const [state, setState] = useState<BentoState>(INITIAL)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

        // Fetch in parallel — each route is owner-gated and rate-limited.
        const [spend24Res, spend48Res, runsRes, approvalsRes, businessesRes, eventsRes] = await Promise.all([
          fetch(`/api/experiment-metrics?kind=cash_spend&since=${encodeURIComponent(since24h)}`, { cache: 'no-store' }).catch(() => null),
          fetch(`/api/experiment-metrics?kind=cash_spend&since=${encodeURIComponent(since48h)}&until=${encodeURIComponent(since24h)}`, { cache: 'no-store' }).catch(() => null),
          fetch('/api/runs?status=in_progress&limit=50', { cache: 'no-store' }).catch(() => null),
          fetch('/api/approvals?status=pending&limit=50', { cache: 'no-store' }).catch(() => null),
          fetch('/api/businesses?status=active', { cache: 'no-store' }).catch(() => null),
          fetch(`/api/run-events?since=${encodeURIComponent(since24h)}&limit=200`, { cache: 'no-store' }).catch(() => null),
        ])

        if (cancelled) return

        const spend24 = await safeJson<{ rows?: Array<{ payload?: { usd?: number } | null }> }>(spend24Res)
        const spend48 = await safeJson<{ rows?: Array<{ payload?: { usd?: number } | null }> }>(spend48Res)
        const runs    = await safeJson<{ rows?: unknown[]; count?: number }>(runsRes)
        const apps    = await safeJson<{ rows?: unknown[]; count?: number }>(approvalsRes)
        const bizs    = await safeJson<{ rows?: unknown[]; businesses?: unknown[]; count?: number }>(businessesRes)
        const evs     = await safeJson<{ rows?: RunEventRow[] }>(eventsRes)

        const spend24Sum = sumUsd(spend24?.rows ?? [])
        const spend48Sum = sumUsd(spend48?.rows ?? [])
        const delta = spend48Sum > 0 ? ((spend24Sum - spend48Sum) / spend48Sum) * 100 : null

        setState({
          spend24hUsd:      spend24Sum,
          spendDelta:       delta,
          activeRuns:       countOf(runs),
          pendingApprovals: countOf(apps),
          activeBusinesses: countOf(bizs, ['rows', 'businesses']),
          recentEvents:     evs?.rows ?? [],
          loading:          false,
          error:            null,
        })
      } catch (err) {
        if (cancelled) return
        setState(s => ({ ...s, loading: false, error: err instanceof Error ? err.message : 'fetch_failed' }))
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={CircleDollarSign}
          label="Spend (24h)"
          value={state.spend24hUsd === null ? null : `$${state.spend24hUsd.toFixed(2)}`}
          delta={state.spendDelta}
          loading={state.loading}
          accent="violet"
          // /dashboard/experiments has only a [slug] sub-route — there's no
          // index page yet, so an href here 404s on RSC prefetch. Restore
          // when the experiments index lands (tracked in PR #341 follow-up).
        />
        <StatTile
          icon={Activity}
          label="Active runs"
          value={state.activeRuns === null ? null : String(state.activeRuns)}
          loading={state.loading}
          accent="cyan"
        />
        <StatTile
          icon={ShieldCheck}
          label="Pending approvals"
          value={state.pendingApprovals === null ? null : String(state.pendingApprovals)}
          loading={state.loading}
          accent={state.pendingApprovals && state.pendingApprovals > 0 ? 'amber' : 'emerald'}
          href="/inbox"
        />
        <StatTile
          icon={Briefcase}
          label="Businesses active"
          value={state.activeBusinesses === null ? null : String(state.activeBusinesses)}
          loading={state.loading}
          accent="emerald"
          href="/businesses"
        />
      </div>

      <HeartbeatTimeline events={state.recentEvents} hours={24} />

      {state.error && (
        <p className="text-xs text-rose-400">
          Bento hero data fetch failed: {state.error}. Existing widgets below still work — refresh to retry.
        </p>
      )}
    </section>
  )
}

interface StatTileProps {
  icon:    typeof CircleDollarSign
  label:   string
  value:   string | null     // null while loading
  delta?:  number | null
  loading: boolean
  accent:  'violet' | 'cyan' | 'amber' | 'emerald' | 'rose'
  href?:   string
}

const ACCENT_BG: Record<StatTileProps['accent'], string> = {
  violet:  'bg-violet-500/5 text-violet-300 border-violet-500/20',
  cyan:    'bg-cyan-500/5 text-cyan-300 border-cyan-500/20',
  amber:   'bg-amber-500/5 text-amber-300 border-amber-500/20',
  emerald: 'bg-emerald-500/5 text-emerald-300 border-emerald-500/20',
  rose:    'bg-rose-500/5 text-rose-300 border-rose-500/20',
}

function StatTile({ icon: Icon, label, value, delta, loading, accent, href }: StatTileProps) {
  const inner = (
    <div className={`group rounded-2xl border bg-zinc-900/40 p-5 transition hover:border-zinc-700 ${href ? 'cursor-pointer hover:bg-zinc-900/60' : ''}`}>
      <div className="flex items-start justify-between">
        <div className={`rounded-xl border p-2 ${ACCENT_BG[accent]}`}>
          <Icon className="h-4 w-4" />
        </div>
        {delta !== null && delta !== undefined && (
          <DeltaBadge delta={delta} />
        )}
      </div>
      <p className="mt-3 text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        {loading || value === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
        ) : (
          <span className="font-mono text-2xl text-zinc-100">{value}</span>
        )}
      </div>
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

function DeltaBadge({ delta }: { delta: number }) {
  if (!Number.isFinite(delta) || delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-400">
        <Minus className="h-2.5 w-2.5" /> 0%
      </span>
    )
  }
  const up = delta > 0
  return (
    <span
      className={
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] ' +
        (up ? 'bg-rose-500/10 text-rose-300' : 'bg-emerald-500/10 text-emerald-300')
      }
    >
      {up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {Math.abs(delta).toFixed(0)}%
    </span>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function safeJson<T>(res: Response | null): Promise<T | null> {
  if (!res || !res.ok) return null
  try { return (await res.json()) as T } catch { return null }
}

function sumUsd(rows: Array<{ payload?: { usd?: number } | null }>): number {
  return rows.reduce((s, r) => s + (r.payload?.usd ?? 0), 0)
}

function countOf(j: { rows?: unknown[]; businesses?: unknown[]; count?: number } | null, keys: ReadonlyArray<'rows' | 'businesses'> = ['rows']): number {
  if (!j) return 0
  if (typeof j.count === 'number') return j.count
  for (const k of keys) {
    const arr = (j as Record<string, unknown>)[k]
    if (Array.isArray(arr)) return arr.length
  }
  return 0
}

'use client'

/**
 * ExperimentDashboardClient — interactive child of the experiment dashboard
 * page (RSC). The RSC fetches state once on first render and hands the full
 * payload down via props; this client renders KPI cards, the plan-billing
 * ledger, kill-switch badge, run timeline, gate event log, and the
 * [Stop experiment] button.
 *
 * The kill button is the only piece that mutates server state — it POSTs to
 * /api/experiments/<slug>/kill and reloads the page on success so the RSC
 * picks up the freshly-written row. No polling: the page is intentionally
 * snapshot-style. Operator hits Refresh (or browser-back) to re-fetch.
 *
 * Shape contract — see `ExperimentDashboardData` interface below. The page
 * RSC must produce the exact same shape; any drift breaks rendering.
 */

import { useState } from 'react'
import {
  Activity, AlertTriangle, Calendar, CheckCircle, ChevronRight, Clock,
  DollarSign, FileText, GitBranch, PauseCircle, PieChart, PlayCircle,
  ShieldAlert, Skull, StopCircle, Users, XCircle, Zap,
} from 'lucide-react'
import type { KillSwitchResult } from '@/lib/cost-guard'
import type { PlanBillingEstimate } from '@/lib/experiments/plan-billing-ledger'

// ── Shared shape — RSC produces, Client consumes ─────────────────────────────

export interface ExperimentMetricRow {
  ts:      string
  kind:    string
  payload: Record<string, unknown> | null
}

export interface ExperimentBusinessSummary {
  slug:                string
  name:                string
  niche:               string
  status:              string
  createdAt:           string
  /** ISO timestamp of the earliest content_published row with payload.live=true (null if not yet live). */
  firstProductLiveAt:  string | null
}

export interface ExperimentDashboardData {
  business:        ExperimentBusinessSummary
  killSwitch:      KillSwitchResult
  ledger:          PlanBillingEstimate
  /** All metric rows in scope (last 30d) — Client filters/aggregates by `kind`. */
  metrics:         ExperimentMetricRow[]
  /** Whether this experiment has been manually killed via /api/experiments/<slug>/kill. */
  manuallyKilled:  boolean
  /** Server's current time when the snapshot was taken — used for "days running" math. */
  computedAt:      string
}

// ── Top-level component ──────────────────────────────────────────────────────

export default function ExperimentDashboardClient({ data }: { data: ExperimentDashboardData }) {
  const { business, killSwitch, ledger, metrics, manuallyKilled, computedAt } = data

  const ticks = metrics.filter(m => m.kind === 'tick')
  const gates = metrics.filter(m => m.kind === 'gate_event')

  const revenueRows = metrics.filter(m => m.kind === 'revenue')
  const signupRows  = metrics.filter(m => m.kind === 'signup')
  const publishRows = metrics.filter(m => m.kind === 'content_published')

  const revenue30d     = sumPayloadUsd(revenueRows)
  const revenue7d      = sumPayloadUsd(filterLastDays(revenueRows, 7))
  const revenuePrior7d = sumPayloadUsd(filterLastDaysOffset(revenueRows, 7, 14))

  const signups30d     = signupRows.length
  const signups7d      = filterLastDays(signupRows, 7).length
  const signupsPrior7d = filterLastDaysOffset(signupRows, 7, 14).length

  const contentPublished = publishRows.length
  const daysRunning      = daysSince(business.createdAt, computedAt)
  const daysLive         = business.firstProductLiveAt ? daysSince(business.firstProductLiveAt, computedAt) : null

  // Composite kill state — manual kill wins over the automatic rules.
  const isKilled = manuallyKilled || killSwitch.kill
  const isPaused = business.status === 'paused' || business.status === 'archived'

  return (
    <div
      className="p-4 sm:p-6 space-y-4 sm:space-y-6 min-h-full"
      style={{ backgroundColor: '#050508' }}
    >
      <Header business={business} isKilled={isKilled} isPaused={isPaused} manuallyKilled={manuallyKilled} />
      <KpiRow
        revenue30d={revenue30d}
        revenue7d={revenue7d}
        revenuePrior7d={revenuePrior7d}
        signups30d={signups30d}
        signups7d={signups7d}
        signupsPrior7d={signupsPrior7d}
        contentPublished={contentPublished}
        daysRunning={daysRunning}
        daysLive={daysLive}
      />
      <PlanBillingCard ledger={ledger} />
      <KillSwitchCard killSwitch={killSwitch} manuallyKilled={manuallyKilled} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <RunTimeline ticks={ticks.slice(-50).reverse()} />
        <GateEventLog gates={gates.slice(-30).reverse()} />
      </div>
    </div>
  )
}

// ── Header ───────────────────────────────────────────────────────────────────

function Header({
  business, isKilled, isPaused, manuallyKilled,
}: {
  business:       ExperimentBusinessSummary
  isKilled:       boolean
  isPaused:       boolean
  manuallyKilled: boolean
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>{business.name}</h1>
          <StatusBadge isKilled={isKilled} isPaused={isPaused} manuallyKilled={manuallyKilled} status={business.status} />
        </div>
        <div className="flex items-center gap-2 mt-1 text-sm" style={{ color: '#9090b0' }}>
          <code className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: '#12121e', color: '#6c63ff' }}>
            {business.slug}
          </code>
          <span style={{ color: '#55556a' }}>·</span>
          <span>{business.niche}</span>
        </div>
      </div>
      <KillButton slug={business.slug} disabled={isKilled} />
    </div>
  )
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({
  isKilled, isPaused, manuallyKilled, status,
}: {
  isKilled: boolean; isPaused: boolean; manuallyKilled: boolean; status: string
}) {
  if (isKilled) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ backgroundColor: '#3a0d0d', color: '#ef4444', border: '1px solid #ef444444' }}
      >
        <Skull size={10} />
        {manuallyKilled ? 'Killed (manual)' : 'Killed'}
      </span>
    )
  }
  if (isPaused) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ backgroundColor: '#1a1a2e', color: '#9090b0', border: '1px solid #24243e' }}
      >
        <PauseCircle size={10} /> {status}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: '#0d2e0d', color: '#22c55e', border: '1px solid #22c55e44' }}
    >
      <PlayCircle size={10} /> Active
    </span>
  )
}

// ── Kill button ──────────────────────────────────────────────────────────────

function KillButton({ slug, disabled }: { slug: string; disabled: boolean }) {
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function onClick() {
    if (disabled || busy) return
    if (!window.confirm(`Stop experiment "${slug}"? This writes a manual kill row that the next cron tick will see.`)) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/experiments/${slug}/kill`, { method: 'POST' })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setSuccess(true)
      // Reload so the RSC picks up the new kill-switch row.
      setTimeout(() => window.location.reload(), 600)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        style={
          disabled
            ? { backgroundColor: '#1a1a2e', color: '#55556a', border: '1px solid #24243e' }
            : { backgroundColor: '#3a0d0d', color: '#ef4444', border: '1px solid #ef4444aa' }
        }
        title={disabled ? 'Already killed' : 'Stop this experiment'}
      >
        <StopCircle size={12} className={busy ? 'animate-pulse' : ''} />
        {success ? 'Killed — reloading' : busy ? 'Stopping…' : 'Stop experiment'}
      </button>
      {error && <span className="text-xs" style={{ color: '#ef4444' }}>{error}</span>}
    </div>
  )
}

// ── KPI row ──────────────────────────────────────────────────────────────────

function KpiRow(props: {
  revenue30d:        number
  revenue7d:         number
  revenuePrior7d:    number
  signups30d:        number
  signups7d:         number
  signupsPrior7d:    number
  contentPublished:  number
  daysRunning:       number
  daysLive:          number | null
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <KpiCard
        Icon={DollarSign}
        label="Revenue 30d"
        value={`$${props.revenue30d.toFixed(2)}`}
        delta={formatDelta(props.revenue7d, props.revenuePrior7d, '$')}
        color="#22c55e"
      />
      <KpiCard
        Icon={Users}
        label="Signups 30d"
        value={props.signups30d.toString()}
        delta={formatDelta(props.signups7d, props.signupsPrior7d, '')}
        color="#6c63ff"
      />
      <KpiCard
        Icon={FileText}
        label="Content published"
        value={props.contentPublished.toString()}
        color="#f59e0b"
      />
      <KpiCard
        Icon={Calendar}
        label="Days running"
        value={props.daysRunning.toString()}
        sub={props.daysLive !== null ? `${props.daysLive} days live` : 'pre-launch'}
        color="#22d3ee"
      />
    </div>
  )
}

function KpiCard({
  Icon, label, value, sub, delta, color,
}: {
  Icon:  React.ComponentType<{ size?: number; style?: React.CSSProperties }>
  label: string
  value: string
  sub?:  string
  delta?: string | null
  color: string
}) {
  return (
    <div
      className="rounded-xl p-3 sm:p-4 flex items-start gap-3"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
        style={{ backgroundColor: '#1a1a2e' }}
      >
        <Icon size={16} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xl sm:text-2xl font-bold leading-tight" style={{ color: '#e8e8f0' }}>{value}</p>
        <p className="text-xs mt-0.5" style={{ color: '#55556a' }}>{label}</p>
        {sub   && <p className="text-xs mt-0.5" style={{ color }}>{sub}</p>}
        {delta && <p className="text-xs mt-0.5" style={{ color }}>{delta}</p>}
      </div>
    </div>
  )
}

// ── Plan-billing ledger card ─────────────────────────────────────────────────

function PlanBillingCard({ ledger }: { ledger: PlanBillingEstimate }) {
  const ratio = ledger.ratioVsRevenue
  const ratioColor = ratio === null ? '#55556a'
    : ratio >= 1   ? '#22c55e'
    : ratio >= 0.5 ? '#f59e0b'
    : '#ef4444'
  const ratioLabel = ratio === null
    ? 'no compute yet'
    : ratio >= 1   ? 'paying for itself'
    : ratio >= 0.5 ? 'partial amortization'
    : 'underwater'

  return (
    <div
      className="rounded-xl p-4 sm:p-5"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <PieChart size={16} style={{ color: '#6c63ff' }} />
          <h2 className="text-sm font-bold" style={{ color: '#e8e8f0' }}>Plan-billing ledger</h2>
        </div>
        <p className="text-xs" style={{ color: '#55556a' }}>
          API-equivalent — your subscription bills flat regardless
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <LedgerCell label="Claude" value={`$${ledger.claudeUsd.toFixed(2)}`} color="#a78bfa" />
        <LedgerCell label="Codex"  value={`$${ledger.codexUsd.toFixed(2)}`}  color="#22d3ee" />
        <LedgerCell label="Total compute" value={`$${ledger.totalUsd.toFixed(2)}`} color="#f59e0b" />
        <LedgerCell label="Revenue 30d"   value={`$${ledger.revenueUsd.toFixed(2)}`} color="#22c55e" />
        <div
          className="rounded-lg p-3 col-span-2 sm:col-span-1"
          style={{ backgroundColor: '#12121e', border: `1px solid ${ratioColor}66` }}
        >
          <p className="text-xs" style={{ color: '#55556a' }}>Ratio vs revenue</p>
          <p className="text-2xl font-bold leading-tight mt-0.5" style={{ color: ratioColor }}>
            {ratio === null ? '—' : `${ratio.toFixed(2)}×`}
          </p>
          <p className="text-xs mt-0.5" style={{ color: ratioColor }}>{ratioLabel}</p>
        </div>
      </div>

      {ledger.unmatchedModels.length > 0 && (
        <p className="text-xs mt-3" style={{ color: '#55556a' }}>
          Unpriced models (not counted): {ledger.unmatchedModels.join(', ')}
        </p>
      )}
    </div>
  )
}

function LedgerCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
      <p className="text-xs" style={{ color: '#55556a' }}>{label}</p>
      <p className="text-lg font-bold mt-0.5" style={{ color }}>{value}</p>
    </div>
  )
}

// ── Kill-switch state card ───────────────────────────────────────────────────

function KillSwitchCard({
  killSwitch, manuallyKilled,
}: {
  killSwitch: KillSwitchResult; manuallyKilled: boolean
}) {
  const variant = manuallyKilled
    ? { Icon: Skull,         color: '#ef4444', label: 'Killed (manual operator stop)',          tone: '#3a0d0d' }
    : killSwitch.kill && killSwitch.reason === 'budget_exhausted'
      ? { Icon: Skull,         color: '#ef4444', label: 'Killed (budget_exhausted)',             tone: '#3a0d0d' }
    : killSwitch.kill && killSwitch.reason === 'stagnation_pivot_exhausted'
      ? { Icon: Skull,         color: '#ef4444', label: 'Killed (stagnation_pivot_exhausted)',   tone: '#3a0d0d' }
    : killSwitch.signal === 'auto_pivot_eligible'
      ? { Icon: AlertTriangle, color: '#f59e0b', label: 'Stagnation pivot eligible',             tone: '#2a1d05' }
    : { Icon: ShieldAlert,     color: '#22c55e', label: 'Healthy',                               tone: '#0d2e0d' }

  const d = killSwitch.details
  const budget = d.budgetUsd ?? 0
  const spent  = d.totalSpentUsd
  const spentPct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0
  const VariantIcon = variant.Icon

  return (
    <div
      className="rounded-xl p-4 sm:p-5"
      style={{ backgroundColor: '#0d0d14', border: `1px solid ${variant.color}66` }}
    >
      <div className="flex items-center gap-2 mb-3">
        <VariantIcon size={16} style={{ color: variant.color }} />
        <h2 className="text-sm font-bold" style={{ color: '#e8e8f0' }}>Kill-switch state</h2>
        <span
          className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
          style={{ backgroundColor: variant.tone, color: variant.color, border: `1px solid ${variant.color}55` }}
        >
          {variant.label}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <DetailCell
          label="Budget cap"
          value={d.budgetUsd === null ? 'unset' : `$${d.budgetUsd.toFixed(2)}`}
          sub={d.budgetUsd === null ? null : `$${spent.toFixed(2)} spent (${spentPct}%)`}
          color={spentPct >= 80 ? '#ef4444' : spentPct >= 50 ? '#f59e0b' : '#22c55e'}
        />
        <DetailCell
          label="Revenue 7d"
          value={`$${d.last7dRevenueUsd.toFixed(2)}`}
          sub={d.last7dRevenueUsd >= 5 ? 'above stagnation floor' : 'below floor ($5)'}
          color={d.last7dRevenueUsd >= 5 ? '#22c55e' : '#f59e0b'}
        />
        <DetailCell
          label="Signups 7d"
          value={d.last7dSignups.toString()}
          sub={d.last7dSignups >= 50 ? 'above stagnation floor' : 'below floor (50)'}
          color={d.last7dSignups >= 50 ? '#22c55e' : '#f59e0b'}
        />
        <DetailCell
          label="Pivots used"
          value={d.pivotHistoryLength.toString()}
          sub={d.pivotHistoryLength >= 1 ? 'auto-pivot exhausted' : 'one auto-pivot remaining'}
          color={d.pivotHistoryLength >= 1 ? '#ef4444' : '#22c55e'}
        />
      </div>
    </div>
  )
}

function DetailCell({
  label, value, sub, color,
}: { label: string; value: string; sub: string | null; color: string }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
      <p className="text-xs" style={{ color: '#55556a' }}>{label}</p>
      <p className="text-base font-bold mt-0.5" style={{ color: '#e8e8f0' }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color }}>{sub}</p>}
    </div>
  )
}

// ── Run timeline ─────────────────────────────────────────────────────────────

function RunTimeline({ ticks }: { ticks: ExperimentMetricRow[] }) {
  return (
    <div
      className="rounded-xl p-4 sm:p-5 flex flex-col"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Activity size={16} style={{ color: '#6c63ff' }} />
        <h2 className="text-sm font-bold" style={{ color: '#e8e8f0' }}>Run timeline</h2>
        <span className="text-xs ml-auto" style={{ color: '#55556a' }}>
          last {ticks.length} tick{ticks.length === 1 ? '' : 's'}
        </span>
      </div>

      {ticks.length === 0 ? (
        <p className="text-sm py-4" style={{ color: '#55556a' }}>No ticks yet.</p>
      ) : (
        <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 400 }}>
          {ticks.map((row, i) => <TickRow key={`${row.ts}-${i}`} row={row} />)}
        </div>
      )}
    </div>
  )
}

function TickRow({ row }: { row: ExperimentMetricRow }) {
  const p = row.payload ?? {}
  const dispatched = p.dispatched === true
  const reason     = typeof p.reason === 'string' ? p.reason : ''
  const dryRun     = p.dryRun === true

  const Icon  = dispatched ? Zap : reason.startsWith('kill_switch:') ? Skull : Clock
  const color = dispatched ? '#22c55e' : reason.startsWith('kill_switch:') ? '#ef4444' : '#9090b0'

  return (
    <div
      className="flex items-start gap-2 px-2 py-1.5 rounded text-xs"
      style={{ backgroundColor: '#12121e' }}
    >
      <Icon size={12} style={{ color, marginTop: 2 }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span style={{ color: '#e8e8f0' }}>{dispatched ? 'Dispatched' : 'Skipped'}</span>
          {dryRun && (
            <span
              className="px-1 py-0.5 rounded text-[10px]"
              style={{ backgroundColor: '#1a1a2e', color: '#9090b0', border: '1px solid #24243e' }}
            >
              dry-run
            </span>
          )}
          {reason && <span style={{ color }}>{reason}</span>}
        </div>
        <p className="mt-0.5" style={{ color: '#55556a' }}>{formatTs(row.ts)}</p>
      </div>
    </div>
  )
}

// ── Gate event log ───────────────────────────────────────────────────────────

function GateEventLog({ gates }: { gates: ExperimentMetricRow[] }) {
  return (
    <div
      className="rounded-xl p-4 sm:p-5 flex flex-col"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <GitBranch size={16} style={{ color: '#f59e0b' }} />
        <h2 className="text-sm font-bold" style={{ color: '#e8e8f0' }}>Gate event log</h2>
        <span className="text-xs ml-auto" style={{ color: '#55556a' }}>
          last {gates.length}
        </span>
      </div>

      {gates.length === 0 ? (
        <p className="text-sm py-4" style={{ color: '#55556a' }}>No gate events yet.</p>
      ) : (
        <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 400 }}>
          {gates.map((row, i) => <GateRow key={`${row.ts}-${i}`} row={row} />)}
        </div>
      )}
    </div>
  )
}

function GateRow({ row }: { row: ExperimentMetricRow }) {
  const p = row.payload ?? {}
  const gate    = typeof p.gate    === 'string' ? p.gate    : 'unknown'
  const outcome = typeof p.outcome === 'string' ? p.outcome : 'pending'

  const Icon  = outcome === 'approved' ? CheckCircle : outcome === 'rejected' ? XCircle : Clock
  const color = outcome === 'approved' ? '#22c55e'   : outcome === 'rejected' ? '#ef4444' : '#f59e0b'

  return (
    <div
      className="flex items-start gap-2 px-2 py-1.5 rounded text-xs"
      style={{ backgroundColor: '#12121e' }}
    >
      <Icon size={12} style={{ color, marginTop: 2 }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span style={{ color: '#e8e8f0' }}>{gate}</span>
          <ChevronRight size={10} style={{ color: '#55556a' }} />
          <span style={{ color }}>{outcome}</span>
        </div>
        <p className="mt-0.5" style={{ color: '#55556a' }}>{formatTs(row.ts)}</p>
      </div>
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function sumPayloadUsd(rows: ExperimentMetricRow[]): number {
  return rows.reduce((s, r) => {
    const p = r.payload ?? {}
    return s + (typeof p.usd === 'number' ? (p.usd as number) : 0)
  }, 0)
}

function filterLastDays(rows: ExperimentMetricRow[], days: number): ExperimentMetricRow[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return rows.filter(r => new Date(r.ts).getTime() >= cutoff)
}

/** Rows in the [olderDays, newerDays] window (e.g. 7..14 = "the 7d before the last 7d"). */
function filterLastDaysOffset(rows: ExperimentMetricRow[], newerDays: number, olderDays: number): ExperimentMetricRow[] {
  const now = Date.now()
  const newerCutoff = now - newerDays * 24 * 60 * 60 * 1000
  const olderCutoff = now - olderDays * 24 * 60 * 60 * 1000
  return rows.filter(r => {
    const t = new Date(r.ts).getTime()
    return t >= olderCutoff && t < newerCutoff
  })
}

function daysSince(iso: string, nowIso: string): number {
  const ms = new Date(nowIso).getTime() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
}

function formatDelta(current: number, prior: number, prefix: string): string | null {
  if (current === 0 && prior === 0) return null
  const diff = current - prior
  const sign = diff > 0 ? '+' : ''
  const value = prefix === '$' ? `${prefix}${diff.toFixed(2)}` : `${prefix}${diff.toFixed(0)}`
  return `${sign}${value} vs prior 7d`
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

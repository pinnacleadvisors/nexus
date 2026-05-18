'use client'

/**
 * FleetOverview — CEO-glance row of every business at the top of /dashboard.
 *
 * Addresses the 2026-05-16 audit Section 7 #1 / Section 8 #4: "one row per
 * business showing last cycle status, KPI delta, pending approvals, agent
 * activity".
 *
 * V2 (this version): reads /api/dashboard/fleet which aggregates 24h spend
 * + 24h revenue (from experiment_metrics), pending approvals (from
 * chat_messages), and last activity timestamp per business. Each card
 * renders metric chips below the niche line.
 *
 * V1 → V2: switched data source from /api/businesses (base rows only) to
 * /api/dashboard/fleet (rows + metrics). Cards gain Δ24h + approvals badge
 * + last-activity relative chip. V1 layout preserved when metrics are 0.
 *
 * NOT in V2 (deferred):
 *   - "active runs count per business" — runs table has no business_slug
 *     today; needs a migration before this can land.
 *   - "cycle status (green/yellow/red)" — same blocker.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Briefcase, MessageSquare, CheckCircle2, Pause, Archive, Loader2,
  TrendingUp, TrendingDown, Inbox, Clock,
} from 'lucide-react'
import type { BusinessStatus } from '@/lib/business/types'
import type { FleetBusiness } from '@/lib/dashboard/fleet-types'

interface ApiResp { ok: true; businesses: FleetBusiness[] }
interface ErrResp { ok: false; error: string }

export default function FleetOverview() {
  const [businesses, setBusinesses] = useState<FleetBusiness[] | null>(null)
  const [error, setError]           = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/dashboard/fleet', {
          cache:  'no-store',
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) throw new Error(`dashboard/fleet HTTP ${res.status}`)
        const j = (await res.json()) as ApiResp | ErrResp
        if (cancelled) return
        if (!j.ok) { setError(j.error); return }
        setBusinesses(j.businesses)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'failed to load fleet')
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (error) {
    // Render NOTHING on error — the dashboard has other panels and a
    // top-level fleet view failing shouldn't blank the page.
    return null
  }

  if (businesses === null) {
    return (
      <div
        className="rounded-xl p-4 flex items-center gap-2 text-xs"
        style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#9090b0' }}
        aria-busy="true"
        aria-label="Loading fleet overview"
      >
        <Loader2 size={12} className="animate-spin" /> Loading fleet…
      </div>
    )
  }

  if (businesses.length === 0) {
    return (
      <div
        className="rounded-xl p-4 flex items-center gap-2.5 text-xs"
        style={{
          background:           'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
          backdropFilter:       'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border:               '1px dashed rgba(255,255,255,0.10)',
          color:                '#9090b0',
        }}
      >
        <Briefcase size={13} style={{ color: '#a8a3ff' }} />
        <span>
          No businesses configured yet — head to{' '}
          <Link className="underline" style={{ color: '#a8a3ff' }} href="/settings/businesses">
            Settings → Businesses
          </Link>
          {' '}to seed your first.
        </span>
      </div>
    )
  }

  const activeCount = businesses.filter(b => b.status === 'active').length

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Briefcase size={14} style={{ color: '#a8a3ff' }} />
          <span className="text-xs uppercase tracking-wide font-medium" style={{ color: '#9090b0' }}>
            Fleet
          </span>
          <span className="text-[11px]" style={{ color: '#55556a' }}>
            {activeCount} of {businesses.length} active
          </span>
        </div>
        <Link
          href="/businesses"
          className="text-[11px] flex items-center gap-1 hover:underline"
          style={{ color: '#9090b0' }}
        >
          All businesses
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {businesses.map(b => <FleetCard key={b.slug} business={b} />)}
      </div>
    </div>
  )
}

function FleetCard({ business }: { business: FleetBusiness }) {
  const { metrics } = business
  const hasAnyMetric =
    metrics.spend24h > 0 || metrics.revenue24h > 0 ||
    metrics.pendingApprovals > 0 || metrics.lastActivityIso !== null
  return (
    <Link
      href={`/businesses/${encodeURIComponent(business.slug)}/chat`}
      className="block p-3 rounded-xl transition-all"
      style={{
        background:           'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
        backdropFilter:       'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border:               '1px solid rgba(255,255,255,0.08)',
        borderRadius:         '14px',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.04) inset',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow =
          '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 12px 24px -12px rgba(108,99,255,0.20)'
        e.currentTarget.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '0 1px 0 0 rgba(255,255,255,0.04) inset'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Briefcase size={11} style={{ color: '#a8a3ff' }} className="shrink-0" />
          <span className="text-xs font-medium truncate" style={{ color: '#e8e8f0' }} title={business.name}>
            {business.name}
          </span>
        </div>
        <FleetStatus status={business.status} />
      </div>
      {business.niche && (
        <div className="text-[10px] truncate" style={{ color: '#9090b0' }} title={business.niche}>
          {business.niche}
        </div>
      )}
      {hasAnyMetric && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <DeltaChip netDelta={metrics.netDelta24h} revenue={metrics.revenue24h} spend={metrics.spend24h} />
          {metrics.pendingApprovals > 0 && <ApprovalsChip count={metrics.pendingApprovals} />}
          {metrics.lastActivityIso && <ActivityChip iso={metrics.lastActivityIso} />}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono" style={{ color: '#55556a' }}>{business.slug}</span>
        <span className="text-[10px] inline-flex items-center gap-0.5" style={{ color: '#a8a3ff' }}>
          <MessageSquare size={9} /> chat
        </span>
      </div>
    </Link>
  )
}

/** Δ24h chip — green when revenue > spend, amber when negative, grey when zero. */
function DeltaChip({ netDelta, revenue, spend }: { netDelta: number; revenue: number; spend: number }) {
  const positive = netDelta > 0
  const negative = netDelta < 0
  const color = positive ? '#4ade80' : negative ? '#fbbf24' : '#9090b0'
  const bg    = positive ? 'rgba(34,197,94,0.10)' : negative ? 'rgba(251,191,36,0.10)' : 'rgba(144,144,176,0.06)'
  const border = positive ? 'rgba(34,197,94,0.22)' : negative ? 'rgba(251,191,36,0.22)' : 'rgba(144,144,176,0.18)'
  const Icon = positive ? TrendingUp : negative ? TrendingDown : TrendingUp
  const sign = positive ? '+' : negative ? '-' : ''
  const value = Math.abs(netDelta).toFixed(2)
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono rounded-full"
      style={{ background: bg, border: `1px solid ${border}`, color }}
      title={`Last 24h: revenue $${revenue.toFixed(2)} − spend $${spend.toFixed(2)} = $${netDelta.toFixed(2)}`}
    >
      <Icon size={8} />
      <span>{sign}${value}</span>
      <span style={{ opacity: 0.7 }}>24h</span>
    </span>
  )
}

/** Pending-approvals badge — only renders when count > 0. */
function ApprovalsChip({ count }: { count: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono rounded-full"
      style={{
        background: 'rgba(245,158,11,0.10)',
        border:     '1px solid rgba(245,158,11,0.22)',
        color:      '#fbbf24',
      }}
      title={`${count} pending approval${count === 1 ? '' : 's'} in this business`}
    >
      <Inbox size={8} />
      {count}
    </span>
  )
}

/** Relative-time chip showing the most recent activity timestamp. */
function ActivityChip({ iso }: { iso: string }) {
  const ms     = Date.now() - new Date(iso).getTime()
  const label  = relativeShort(ms)
  // Dimmer/older = greyer; recent = lavender hint.
  const recent = ms < 60 * 60_000   // < 1 hour
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono rounded-full"
      style={{
        background: recent ? 'rgba(108,99,255,0.06)' : 'rgba(255,255,255,0.03)',
        border:     recent ? '1px solid rgba(108,99,255,0.18)' : '1px solid rgba(255,255,255,0.06)',
        color:      recent ? '#a8a3ff' : '#9090b0',
      }}
      title={`Last activity: ${new Date(iso).toLocaleString()}`}
    >
      <Clock size={8} />
      {label}
    </span>
  )
}

function relativeShort(ms: number): string {
  if (ms < 60_000)              return 'just now'
  if (ms < 60 * 60_000)         return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 24 * 60 * 60_000)    return `${Math.floor(ms / (60 * 60_000))}h ago`
  return `${Math.floor(ms / (24 * 60 * 60_000))}d ago`
}

function FleetStatus({ status }: { status: BusinessStatus }) {
  const cfg = status === 'active'
    ? { Icon: CheckCircle2, color: '#4ade80', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.20)' }
    : status === 'paused'
      ? { Icon: Pause, color: '#fbbf24', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.20)' }
      : { Icon: Archive, color: '#9090b0', bg: 'rgba(144,144,176,0.08)', border: 'rgba(144,144,176,0.18)' }
  const { Icon, color, bg, border } = cfg
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-mono tracking-wider uppercase shrink-0"
      style={{ background: bg, border: `1px solid ${border}`, borderRadius: '999px', color }}
    >
      <Icon size={8} />
      {status}
    </span>
  )
}

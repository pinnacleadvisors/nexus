'use client'

/**
 * FleetOverview — CEO-glance row of every business at the top of /dashboard.
 *
 * Addresses the 2026-05-16 audit Section 7 #1: "one row per business
 * showing last cycle status, KPI delta, pending approvals, agent activity".
 *
 * This is the V1 shape — name + status pill + niche tagline + Open-chat
 * shortcut. Full KPI delta + pending-approvals count + cost-burn signals
 * need a dedicated /api/dashboard/fleet aggregation endpoint that doesn't
 * exist yet; tracked as V2 (see the audit doc Section 8 #4).
 *
 * Reads /api/businesses (already exists). Renders a compact card per
 * business, grouped into one row. Click → /businesses/<slug>/chat to
 * jump straight to that business's copilot.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Briefcase, MessageSquare, CheckCircle2, Pause, Archive, Loader2 } from 'lucide-react'
import type { BusinessRow, BusinessStatus } from '@/lib/business/types'

interface ApiResp { ok: true; businesses: BusinessRow[] }
interface ErrResp { ok: false; error: string }

export default function FleetOverview() {
  const [businesses, setBusinesses] = useState<BusinessRow[] | null>(null)
  const [error, setError]           = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/businesses', {
          cache:  'no-store',
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) throw new Error(`businesses HTTP ${res.status}`)
        const j = (await res.json()) as ApiResp | ErrResp
        if (cancelled) return
        if (!j.ok) { setError(j.error); return }
        setBusinesses(j.businesses)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'failed to load businesses')
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

function FleetCard({ business }: { business: BusinessRow }) {
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
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono" style={{ color: '#55556a' }}>{business.slug}</span>
        <span className="text-[10px] inline-flex items-center gap-0.5" style={{ color: '#a8a3ff' }}>
          <MessageSquare size={9} /> chat
        </span>
      </div>
    </Link>
  )
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

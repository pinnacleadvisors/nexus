'use client'

/**
 * /businesses — top-level businesses index.
 *
 * Was missing — `/businesses/<slug>/chat` existed but you could only reach
 * it by typing the URL. This page lists every business the operator owns
 * as a card with quick actions: **Open chat** (primary), **Settings**,
 * and a status pill.
 *
 * Companion to `/settings/businesses` which is the CRUD-style management
 * page (add seeds, edit Slack, pause/archive). This page is the day-to-day
 * dispatcher — fast click-through to a per-business surface.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Briefcase, MessageSquare, Settings as SettingsIcon, Loader2, Pause, Archive, CheckCircle2 } from 'lucide-react'
import type { BusinessRow, BusinessStatus } from '@/lib/business/types'

interface ApiResp { ok: true; businesses: BusinessRow[] }
interface ErrResp { ok: false; error: string }

export default function BusinessesIndexPage() {
  const [businesses, setBusinesses] = useState<BusinessRow[] | null>(null)
  const [error, setError]           = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/businesses', { cache: 'no-store' })
        if (res.status === 401) {
          const here = window.location.pathname
          window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
          return
        }
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

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#e8e8f0' }}>Businesses</h1>
          <p className="text-sm mt-1" style={{ color: '#9090b0' }}>
            One card per business. Click <b>Open chat</b> to talk to its copilot, or <b>Settings</b> to manage seeds + Slack.
          </p>
        </div>
        <Link
          href="/settings/businesses"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: 'linear-gradient(135deg, rgba(108,99,255,0.20), rgba(108,99,255,0.05))',
            border:     '1px solid rgba(108,99,255,0.30)',
            color:      '#e8e8f0',
          }}
        >
          <SettingsIcon size={14} />
          <span>Manage</span>
        </Link>
      </header>

      {businesses === null && !error && (
        <div className="flex items-center gap-2 text-sm py-12 justify-center" style={{ color: '#9090b0' }}>
          <Loader2 size={14} className="animate-spin" /> Loading businesses…
        </div>
      )}

      {error && (
        <div
          className="rounded-lg p-4 text-sm"
          style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
        >
          Failed to load — {error}
        </div>
      )}

      {businesses && businesses.length === 0 && (
        <div
          className="rounded-xl p-8 text-center space-y-3"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.10)' }}
        >
          <Briefcase size={32} style={{ color: '#a8a3ff' }} className="mx-auto" />
          <h2 className="text-base font-semibold" style={{ color: '#e8e8f0' }}>No businesses yet</h2>
          <p className="text-sm" style={{ color: '#9090b0' }}>
            Head to <Link className="underline" style={{ color: '#a8a3ff' }} href="/settings/businesses">Settings → Businesses</Link> to seed your first business (Ledger Lane / Inkbound / …).
          </p>
        </div>
      )}

      {businesses && businesses.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {businesses.map(b => <BusinessCard key={b.slug} business={b} />)}
        </div>
      )}
    </div>
  )
}

function BusinessCard({ business }: { business: BusinessRow }) {
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-3 transition-shadow"
      style={{
        background:           'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
        border:               '1px solid rgba(255,255,255,0.08)',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Briefcase size={14} style={{ color: '#a8a3ff' }} className="shrink-0" />
            <h3 className="text-base font-semibold truncate" style={{ color: '#e8e8f0' }} title={business.name}>
              {business.name}
            </h3>
          </div>
          <div className="mt-1 text-xs truncate" style={{ color: '#9090b0' }} title={business.niche}>
            {business.niche || '(no niche set)'}
          </div>
        </div>
        <StatusPill status={business.status} />
      </div>

      {/* Money model thesis (first line only) */}
      {business.money_model?.thesis && (
        <div className="text-xs leading-relaxed line-clamp-2" style={{ color: '#c8c8d8' }} title={business.money_model.thesis}>
          {business.money_model.thesis}
        </div>
      )}

      <div className="flex items-center gap-2 mt-1">
        <Link
          href={`/businesses/${encodeURIComponent(business.slug)}/chat`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: 'linear-gradient(135deg, rgba(108,99,255,0.25), rgba(108,99,255,0.08))',
            border:     '1px solid rgba(108,99,255,0.30)',
            color:      '#e8e8f0',
          }}
        >
          <MessageSquare size={13} />
          <span>Open chat</span>
        </Link>
        <Link
          href="/settings/businesses"
          className="shrink-0 inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border:     '1px solid rgba(255,255,255,0.08)',
            color:      '#9090b0',
          }}
          title="Manage seed / Slack / pause"
        >
          <SettingsIcon size={13} />
        </Link>
      </div>

      <div className="text-[10px] flex items-center gap-3 mt-1" style={{ color: '#55556a' }}>
        <span title="Slug used in URLs + Composio connected_account scope">{business.slug}</span>
        {business.slack_channel && (
          <span title="Slack channel for digest posts">
            {/* Defensive: strip any leading '#' so seeded values like '#nexus-foo'
                don't render as '##nexus-foo' (audit 2026-05-16 finding p2). */}
            #{business.slack_channel.replace(/^#+/, '')}
          </span>
        )}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: BusinessStatus }) {
  const cfg = status === 'active'
    ? { Icon: CheckCircle2, color: '#22c55e', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.30)', label: 'Active' }
    : status === 'paused'
      ? { Icon: Pause, color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.30)', label: 'Paused' }
      : { Icon: Archive, color: '#9090b0', bg: 'rgba(144,144,176,0.08)', border: 'rgba(144,144,176,0.20)', label: 'Archived' }
  const { Icon, color, bg, border, label } = cfg
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={{ background: bg, border: `1px solid ${border}`, color }}
    >
      <Icon size={9} /> {label}
    </span>
  )
}

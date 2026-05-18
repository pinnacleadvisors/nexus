'use client'

/**
 * Settings → Businesses
 *
 * One liquid-glass card per business with the four fields the operator
 * actually changes (status, Slack channel, Slack webhook, money model
 * preview). JSON config is in a collapsible details — deeper editing is still
 * Phase B. Visual treatment matches /settings/accounts so the two pages feel
 * like one product.
 */

import { useEffect, useState } from 'react'
import { Briefcase, Loader2, AlertCircle, Plus, X } from 'lucide-react'
import { BUSINESS_SEEDS } from '@/lib/business/seeds'
import type { BusinessRow } from '@/lib/business/types'
import SettingsTabs from '@/components/settings/SettingsTabs'
import { BusinessCard } from '@/components/settings/BusinessesCard'

interface ApiList   { ok: boolean; businesses: BusinessRow[] }
interface ApiUpsert { ok: boolean; business: BusinessRow; error?: string; slack_warning?: string; slack_verified?: boolean }

export default function BusinessesPage() {
  const [rows, setRows]                   = useState<BusinessRow[]>([])
  const [loading, setLoad]                = useState(true)
  const [err, setErr]                     = useState<string | null>(null)
  const [slackWarnings, setSlackWarnings] = useState<Record<string, string>>({})
  const [slackVerified, setSlackVerified] = useState<Record<string, number>>({})
  const [verifyingSlug, setVerifyingSlug] = useState<string | null>(null)

  async function refresh() {
    setLoad(true); setErr(null)
    try {
      const res  = await fetch('/api/businesses')
      const data = (await res.json()) as ApiList
      if (!data.ok) throw new Error('list failed')
      setRows(data.businesses)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoad(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  async function insertSeed(slug: string) {
    const seed = BUSINESS_SEEDS.find(s => s.slug === slug)
    if (!seed) return
    const res  = await fetch('/api/businesses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify(seed),
    })
    const data = (await res.json()) as ApiUpsert
    if (!data.ok) { setErr(data.error ?? 'insert failed'); return }
    await refresh()
  }

  async function patchBusiness(slug: string, patch: Partial<BusinessRow>, opts?: { forceSlackVerify?: boolean }) {
    const current = rows.find(r => r.slug === slug)
    if (!current) return
    if (opts?.forceSlackVerify) setVerifyingSlug(slug)
    const res  = await fetch('/api/businesses', {
      method:  'POST', headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...current, ...patch, ...(opts?.forceSlackVerify ? { force_slack_verify: true } : {}) }),
    })
    const data = (await res.json()) as ApiUpsert
    if (opts?.forceSlackVerify) setVerifyingSlug(null)
    if (!data.ok) { setErr(data.error ?? 'update failed'); return }
    setSlackWarnings(prev => {
      const next = { ...prev }
      if (data.slack_warning) next[slug] = data.slack_warning
      else delete next[slug]
      return next
    })
    if (data.slack_verified) setSlackVerified(prev => ({ ...prev, [slug]: Date.now() }))
    await refresh()
  }

  const ownedSlugs = new Set(rows.map(r => r.slug))
  const seedsToOffer = BUSINESS_SEEDS.filter(s => !ownedSlugs.has(s.slug))

  return (
    <div
      className="p-6 min-h-full"
      style={{
        backgroundColor: '#050508',
        backgroundImage:
          'radial-gradient(1200px 600px at 10% -10%, rgba(108,99,255,0.10), transparent 60%), ' +
          'radial-gradient(900px 500px at 100% 100%, rgba(108,99,255,0.06), transparent 60%)',
      }}
    >
      <div className="max-w-5xl mx-auto">
        <div className="mb-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
            style={{
              background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))',
              border:     '1px solid rgba(108,99,255,0.20)',
              boxShadow:  '0 1px 0 0 rgba(255,255,255,0.06) inset',
            }}>
            <Briefcase size={18} style={{ color: '#a8a3ff' }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold" style={{ color: '#e8e8f0' }}>Businesses</h1>
            <p className="text-sm mt-1 max-w-2xl" style={{ color: '#9090b0' }}>
              One row per business the operator runs. The daily cron at 04:00 UTC dispatches{' '}
              <code className="font-mono" style={{ color: '#a8a3ff' }}>business-operator</code> for each active row.
            </p>
          </div>
        </div>

        <SettingsTabs activeTab="businesses" />

        {err && (
          <div className="mb-4 flex items-start gap-2.5 px-3.5 py-2.5 text-sm"
            style={{
              background:           'linear-gradient(135deg, rgba(239,68,68,0.10), rgba(239,68,68,0.02))',
              backdropFilter:       'blur(28px) saturate(180%)',
              WebkitBackdropFilter: 'blur(28px) saturate(180%)',
              border:               '1px solid rgba(239,68,68,0.22)',
              borderRadius:         '14px',
              color:                '#e8e8f0',
            }}>
            <AlertCircle size={16} style={{ color: '#f87171' }} />
            <div className="flex-1">{err}</div>
            <button type="button" onClick={() => setErr(null)} aria-label="Dismiss" className="p-0.5">
              <X size={14} style={{ color: '#9090b0' }} />
            </button>
          </div>
        )}

        {seedsToOffer.length > 0 && <SeedRow seeds={seedsToOffer} onInsert={s => void insertSeed(s)} />}

        {loading ? (
          <div className="flex items-center gap-2 text-sm px-4 py-3"
            style={{
              color: '#9090b0',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '14px',
            }}>
            <Loader2 size={14} className="animate-spin" /> Loading businesses…
          </div>
        ) : (
          <div className="space-y-3">
            {rows.length === 0 && <EmptyState />}
            {rows.map(r => (
              <BusinessCard
                key={r.slug}
                row={r}
                slackWarning={slackWarnings[r.slug]}
                slackVerified={!!slackVerified[r.slug]}
                verifying={verifyingSlug === r.slug}
                onPatch={(patch, opts) => void patchBusiness(r.slug, patch, opts)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SeedRow({ seeds, onInsert }: { seeds: typeof BUSINESS_SEEDS; onInsert: (slug: string) => void }) {
  return (
    <div className="mb-4 p-3 flex flex-wrap items-center gap-2"
      style={{
        background:           'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
        backdropFilter:       'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border:               '1px solid rgba(255,255,255,0.10)',
        borderRadius:         '14px',
      }}>
      <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: '#9090b0' }}>Seed templates</span>
      {seeds.map(s => (
        <button key={s.slug} type="button" onClick={() => onInsert(s.slug)}
          className="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
          style={{
            background: 'linear-gradient(135deg, rgba(108,99,255,0.20), rgba(108,99,255,0.06))',
            border:     '1px solid rgba(108,99,255,0.25)',
            color:      '#e8e8f0',
          }}>
          <Plus size={11} /> {s.name} <span className="font-mono" style={{ color: '#a8a3ff' }}>· {s.slug}</span>
        </button>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="px-3.5 py-4 text-sm text-center"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '14px',
        color: '#9090b0',
      }}>
      No businesses yet — pick a seed template above to get started.
    </div>
  )
}


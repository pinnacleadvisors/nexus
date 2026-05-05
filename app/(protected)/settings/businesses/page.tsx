'use client'

/**
 * Settings → Businesses
 *
 * Phase A — minimal CRUD for the `businesses` table:
 *   - List all businesses owned by the current user
 *   - One-click insert from `lib/business/seeds.ts` (Ledger Lane / Inkbound)
 *   - Edit Slack channel + webhook URL inline (most common change)
 *   - Pause / activate / archive
 *
 * Deeper editing (money_model JSON, KPIs JSON, brand_voice) is Phase B —
 * for now those come from the seed and rarely change.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BUSINESS_SEEDS } from '@/lib/business/seeds'
import type { BusinessRow, BusinessStatus } from '@/lib/business/types'
import SettingsTabs from '@/components/settings/SettingsTabs'

interface ApiList { ok: boolean; businesses: BusinessRow[] }
interface ApiUpsert { ok: boolean; business: BusinessRow; error?: string; slack_warning?: string; slack_verified?: boolean }

export default function BusinessesPage() {
  const [rows, setRows]     = useState<BusinessRow[]>([])
  const [loading, setLoad]  = useState(true)
  const [err, setErr]       = useState<string | null>(null)
  // Per-business warnings (e.g. failed Slack webhook verification). Keyed by slug.
  const [slackWarnings, setSlackWarnings] = useState<Record<string, string>>({})
  // Per-business "verified just now" flag. Honesty check: the green tick
  // only appears after the API confirms a real successful POST to Slack
  // during this session, not just because a URL is stored in the row.
  const [slackVerified, setSlackVerified] = useState<Record<string, number>>({})
  const [verifyingSlug, setVerifyingSlug] = useState<string | null>(null)

  async function refresh() {
    setLoad(true)
    setErr(null)
    try {
      const res = await fetch('/api/businesses')
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
    const res = await fetch('/api/businesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(seed),
    })
    const data = (await res.json()) as ApiUpsert
    if (!data.ok) {
      setErr(data.error ?? 'insert failed')
      return
    }
    await refresh()
  }

  async function patchBusiness(
    slug:   string,
    patch:  Partial<BusinessRow>,
    opts?: { forceSlackVerify?: boolean },
  ) {
    const current = rows.find(r => r.slug === slug)
    if (!current) return
    if (opts?.forceSlackVerify) setVerifyingSlug(slug)
    const res = await fetch('/api/businesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...current,
        ...patch,
        ...(opts?.forceSlackVerify ? { force_slack_verify: true } : {}),
      }),
    })
    const data = (await res.json()) as ApiUpsert
    if (opts?.forceSlackVerify) setVerifyingSlug(null)
    if (!data.ok) {
      setErr(data.error ?? 'update failed')
      return
    }
    setSlackWarnings(prev => {
      const next = { ...prev }
      if (data.slack_warning) next[slug] = data.slack_warning
      else delete next[slug]
      return next
    })
    if (data.slack_verified) {
      setSlackVerified(prev => ({ ...prev, [slug]: Date.now() }))
    }
    await refresh()
  }

  const ownedSlugs = new Set(rows.map(r => r.slug))
  const seedsToOffer = BUSINESS_SEEDS.filter(s => !ownedSlugs.has(s.slug))

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <SettingsTabs activeTab="businesses" />

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Businesses</h1>
        <p className="text-sm text-zinc-500">
          One row per business the operator runs. Daily cron at 04:00 UTC (11:00 ICT for Asia/Bangkok)
          dispatches the <code>business-operator</code> agent for each <code>active</code> row.
        </p>
      </header>

      {err && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {seedsToOffer.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Seed templates</h2>
          <div className="flex flex-wrap gap-2">
            {seedsToOffer.map(s => (
              <button
                key={s.slug}
                onClick={() => void insertSeed(s.slug)}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
              >
                + Insert <strong>{s.name}</strong> ({s.slug})
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Current businesses</h2>
        {loading && <p className="text-sm text-zinc-500">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-zinc-500">No businesses yet — insert a seed above to get started.</p>
        )}
        {rows.map(r => (
          <div key={r.slug} className="space-y-3 rounded-lg border border-zinc-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">{r.name}</h3>
                <p className="text-xs text-zinc-500">slug: <code>{r.slug}</code> · niche: {r.niche}</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={r.status}
                  onChange={e => void patchBusiness(r.slug, { status: e.target.value as BusinessStatus })}
                  className="rounded border border-zinc-300 px-2 py-1 text-sm"
                >
                  <option value="active">active</option>
                  <option value="paused">paused</option>
                  <option value="archived">archived</option>
                </select>
                <Link
                  href={`/board?business=${encodeURIComponent(r.slug)}`}
                  className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50"
                >
                  Board
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="block text-xs uppercase text-zinc-500">Slack channel (display)</span>
                <input
                  type="text"
                  defaultValue={r.slack_channel ?? ''}
                  onBlur={e => {
                    const v = e.target.value.trim() || null
                    if (v !== r.slack_channel) void patchBusiness(r.slug, { slack_channel: v })
                  }}
                  placeholder="#nexus-ledger-lane"
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1"
                />
              </label>
              <label className="text-sm">
                <span className="block text-xs uppercase text-zinc-500">Slack webhook URL</span>
                <input
                  type="password"
                  defaultValue={r.slack_webhook_url ?? ''}
                  onBlur={e => {
                    const v = e.target.value.trim() || null
                    if (v !== r.slack_webhook_url) void patchBusiness(r.slug, { slack_webhook_url: v })
                  }}
                  placeholder="https://hooks.slack.com/services/..."
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 font-mono text-xs"
                />
                {slackWarnings[r.slug] && (
                  <p className="mt-1 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    <span aria-hidden>⚠</span>
                    <span className="flex-1">
                      {slackWarnings[r.slug]}{' '}
                      <button
                        type="button"
                        onClick={() => void patchBusiness(
                          r.slug,
                          { slack_webhook_url: r.slack_webhook_url },
                          { forceSlackVerify: true },
                        )}
                        className="underline hover:no-underline"
                      >
                        Retry
                      </button>
                    </span>
                  </p>
                )}
                {!slackWarnings[r.slug] && r.slack_webhook_url && (
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                    {slackVerified[r.slug] ? (
                      <span className="text-emerald-600">
                        ✓ Verification message delivered to Slack. Check the channel.
                      </span>
                    ) : (
                      <span className="text-zinc-500">
                        Webhook saved. Press <strong>Send test</strong> to confirm a real message lands.
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={verifyingSlug === r.slug}
                      onClick={() => void patchBusiness(
                        r.slug,
                        { slack_webhook_url: r.slack_webhook_url },
                        { forceSlackVerify: true },
                      )}
                      className="shrink-0 rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] hover:bg-zinc-50 disabled:opacity-50"
                    >
                      {verifyingSlug === r.slug ? 'Sending…' : 'Send test'}
                    </button>
                  </div>
                )}
              </label>
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-zinc-600 hover:text-zinc-900">JSON config (read-only)</summary>
              <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                <pre className="overflow-x-auto rounded bg-zinc-50 p-2 text-xs">
                  {JSON.stringify(r.money_model, null, 2)}
                </pre>
                <pre className="overflow-x-auto rounded bg-zinc-50 p-2 text-xs">
                  {JSON.stringify(r.kpi_targets, null, 2)}
                </pre>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Edit JSON directly in Supabase for now; structured editing UI is Phase B.
              </p>
            </details>

            <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
              <span>timezone: {r.timezone}</span>
              <span>daily run: {r.daily_cron_local_hour}:00</span>
              <span>last run: {r.last_operator_at ? new Date(r.last_operator_at).toLocaleString() : 'never'}</span>
              <span>gates: {r.approval_gates.length}</span>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

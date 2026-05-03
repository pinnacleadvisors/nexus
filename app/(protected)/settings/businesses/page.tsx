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

interface ApiList { ok: boolean; businesses: BusinessRow[] }
interface ApiUpsert {
  ok: boolean
  business: BusinessRow
  error?: string
  slack_warning?: string | null
  webhook_verified?: boolean
}
interface ApiVerify {
  ok: boolean
  error?: string | null
  cardCreated?: boolean
  verifiedAt?: string
}

export default function BusinessesPage() {
  const [rows, setRows]     = useState<BusinessRow[]>([])
  const [loading, setLoad]  = useState(true)
  const [err, setErr]       = useState<string | null>(null)
  // Per-business webhook status. Cleared on every refresh so stale verify
  // results never linger after a row-level edit.
  const [hookStatus, setHookStatus] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [verifying, setVerifying] = useState<Record<string, boolean>>({})

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

  async function patchBusiness(slug: string, patch: Partial<BusinessRow>) {
    const current = rows.find(r => r.slug === slug)
    if (!current) return
    const res = await fetch('/api/businesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...current, ...patch }),
    })
    const data = (await res.json()) as ApiUpsert
    if (!data.ok) {
      setErr(data.error ?? 'update failed')
      return
    }
    // Surface auto-verify outcome inline next to the webhook field. The
    // server only runs a verify when the URL actually changed.
    if (data.webhook_verified) {
      setHookStatus(s => ({ ...s, [slug]: { ok: true, message: 'Slack verified ✓' } }))
    } else if (data.slack_warning) {
      setHookStatus(s => ({ ...s, [slug]: { ok: false, message: `Verify failed: ${data.slack_warning}` } }))
    }
    await refresh()
  }

  async function verifyWebhook(slug: string) {
    setVerifying(v => ({ ...v, [slug]: true }))
    setHookStatus(s => ({ ...s, [slug]: { ok: false, message: 'Sending test message…' } }))
    try {
      const res = await fetch('/api/businesses/verify-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })
      const data = (await res.json()) as ApiVerify
      setHookStatus(s => ({
        ...s,
        [slug]: data.ok
          ? { ok: true, message: data.cardCreated ? 'Slack verified ✓ · Board card created' : 'Slack verified ✓' }
          : { ok: false, message: `Verify failed: ${data.error ?? 'unknown'}` },
      }))
      if (data.ok) await refresh()
    } catch (e) {
      setHookStatus(s => ({ ...s, [slug]: { ok: false, message: e instanceof Error ? e.message : 'network error' } }))
    } finally {
      setVerifying(v => ({ ...v, [slug]: false }))
    }
  }

  const ownedSlugs = new Set(rows.map(r => r.slug))
  const seedsToOffer = BUSINESS_SEEDS.filter(s => !ownedSlugs.has(s.slug))

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
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
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="password"
                    defaultValue={r.slack_webhook_url ?? ''}
                    onBlur={e => {
                      const v = e.target.value.trim() || null
                      if (v !== r.slack_webhook_url) void patchBusiness(r.slug, { slack_webhook_url: v })
                    }}
                    placeholder="https://hooks.slack.com/services/..."
                    className="flex-1 rounded border border-zinc-300 px-2 py-1 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => void verifyWebhook(r.slug)}
                    disabled={!r.slack_webhook_url || verifying[r.slug]}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
                    title="Send a test message to this webhook"
                  >
                    {verifying[r.slug] ? 'Verifying…' : 'Verify'}
                  </button>
                </div>
                {hookStatus[r.slug] && (
                  <span
                    className="mt-1 block text-xs"
                    style={{ color: hookStatus[r.slug]!.ok ? '#16a34a' : '#dc2626' }}
                  >
                    {hookStatus[r.slug]!.message}
                  </span>
                )}
                {!hookStatus[r.slug] && r.webhook_last_error && (
                  <span className="mt-1 block text-xs" style={{ color: '#dc2626' }}>
                    Last verify failed: {r.webhook_last_error}
                  </span>
                )}
                {!hookStatus[r.slug] && !r.webhook_last_error && r.webhook_last_verified_at && (
                  <span className="mt-1 block text-xs" style={{ color: '#16a34a' }}>
                    Verified {new Date(r.webhook_last_verified_at).toLocaleString()}
                  </span>
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

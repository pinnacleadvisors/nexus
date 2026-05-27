'use client'

/**
 * BusinessCostWidget — per-business spend visualizer + editable daily cap.
 *
 * R3 of the UX consultation (docs/research/UX_CONSULTATION_2026-05-27.md).
 * Today's /businesses/<slug> page surfaces 30-day spend in BillerSpendCard
 * but no per-day view + no operator-editable cap. This widget closes
 * both gaps.
 *
 * Three states stacked vertically:
 *   1. Today vs cap meter — proportional bar with $X.XX / $Y.YY cap.
 *      Amber at 70%, red at 90%, green otherwise.
 *   2. 7-day spend trend — 7 small vertical bars, height = day's spend
 *      relative to the period max.
 *   3. Edit cap — disclosure with input + Save. Empty input = revert to
 *      inherited platform cap.
 *
 * Data: GET/PATCH /api/businesses/[slug]/cost-snapshot.
 */

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DollarSign, Loader2, ShieldCheck, Edit3, Save, X } from 'lucide-react'

interface SnapshotBody {
  ok:                boolean
  today_spend_cents?: number
  daily_cap_cents?:   number | null
  cap_source?:        'business' | 'platform-default' | 'none'
  trend_7d?:          Array<{ date: string; spend_cents: number }>
  error?:             string
  hint?:              string
}

interface Props { slug: string }

function fmtUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function dayLabel(iso: string): string {
  // e.g. "Mon"
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' })
}

export default function BusinessCostWidget({ slug }: Props) {
  const router = useRouter()
  const [snap, setSnap]       = useState<SnapshotBody | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draftUsd, setDraftUsd] = useState<string>('')
  const [pending, startTx]    = useTransition()
  const [error, setError]     = useState<string | null>(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/businesses/${slug}/cost-snapshot`, { cache: 'no-store' })
      const b = await r.json() as SnapshotBody
      setSnap(b)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [slug])

  const todayCents = snap?.today_spend_cents ?? 0
  const capCents   = snap?.daily_cap_cents ?? null
  const trend      = snap?.trend_7d ?? []
  const ratio      = capCents != null && capCents > 0 ? Math.min(1, todayCents / capCents) : 0
  const meterColor = ratio >= 0.9 ? '#ef4444' : ratio >= 0.7 ? '#f59e0b' : '#22c55e'
  const trendMax   = Math.max(1, ...trend.map(t => t.spend_cents))

  const saveCap = () => {
    setError(null)
    startTx(async () => {
      const trimmed = draftUsd.trim()
      let payload: { daily_cost_cap_cents: number | null }
      if (trimmed === '') {
        payload = { daily_cost_cap_cents: null }
      } else {
        const usd = Number(trimmed)
        if (!Number.isFinite(usd) || usd < 0) {
          setError('Enter a non-negative number in USD (e.g. "5" or "2.50"), or leave empty to inherit the platform cap.')
          return
        }
        payload = { daily_cost_cap_cents: Math.round(usd * 100) }
      }
      try {
        const r = await fetch(`/api/businesses/${slug}/cost-snapshot`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
        const b = await r.json() as SnapshotBody
        if (!b.ok) {
          setError(b.hint ? `${b.error}: ${b.hint}` : (b.error ?? 'save failed'))
          return
        }
        setEditing(false)
        setDraftUsd('')
        await load()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'network error')
      }
    })
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 text-sm font-medium tracking-tight">
          <DollarSign className="h-4 w-4 text-zinc-400" />
          Daily spend
        </h3>
        {!editing && (
          <button
            type="button"
            onClick={() => { setEditing(true); setDraftUsd(capCents != null ? (capCents / 100).toString() : '') }}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800/70"
          >
            <Edit3 className="h-3 w-3" />
            Cap
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading snapshot…
        </div>
      ) : (
        <>
          {/* Today vs cap meter */}
          <div className="mb-3">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-xs text-zinc-500">Today</span>
              <span className="text-xs text-zinc-300">
                <span className="font-mono">{fmtUSD(todayCents)}</span>
                {capCents != null && (
                  <span className="text-zinc-500"> / <span className="font-mono">{fmtUSD(capCents)}</span> cap</span>
                )}
              </span>
            </div>
            <div className="h-2 rounded-full bg-zinc-800/60 overflow-hidden">
              {capCents != null ? (
                <div className="h-full transition-all" style={{ width: `${ratio * 100}%`, background: meterColor }} />
              ) : (
                <div className="h-full bg-zinc-700/40" />
              )}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
              <ShieldCheck className="h-3 w-3" />
              {snap?.cap_source === 'business'
                ? <>Per-business cap set</>
                : snap?.cap_source === 'platform-default'
                  ? <>Inheriting <code className="font-mono">USER_DAILY_USD_LIMIT</code></>
                  : <>No cap configured — set one below or in Doppler</>}
            </div>
          </div>

          {/* 7-day trend */}
          {trend.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">7-day trend</div>
              <div className="flex items-end gap-1.5 h-12">
                {trend.map((day, i) => {
                  const isToday = i === trend.length - 1
                  const heightPct = (day.spend_cents / trendMax) * 100
                  return (
                    <div
                      key={day.date}
                      className="group flex-1 flex flex-col items-center justify-end"
                      title={`${day.date}: ${fmtUSD(day.spend_cents)}`}
                    >
                      <div
                        className="w-full transition-all"
                        style={{
                          height: `${Math.max(2, heightPct)}%`,
                          background: isToday ? '#a8a3ff' : '#3f3f56',
                          borderRadius: '2px',
                        }}
                      />
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-between text-[9px] text-zinc-600 mt-1">
                {trend.map((d, i) => (
                  <span key={i} className={i === trend.length - 1 ? 'text-zinc-400' : ''}>{dayLabel(d.date)}</span>
                ))}
              </div>
            </div>
          )}

          {editing && (
            <div className="rounded-md border border-violet-700/30 bg-violet-950/20 p-3">
              <label className="block text-[10px] uppercase tracking-wide text-violet-300 mb-1.5">
                Daily cap (USD) — empty to inherit platform
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={draftUsd}
                  onChange={e => setDraftUsd(e.target.value)}
                  placeholder="e.g. 5.00"
                  className="flex-1 rounded border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={saveCap}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded border border-violet-600 bg-violet-600/30 px-2.5 py-1.5 text-xs text-violet-100 transition hover:bg-violet-600/50 disabled:opacity-50"
                >
                  {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setDraftUsd(''); setError(null) }}
                  className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800/40 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800/70"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {error && <p className="mt-1.5 text-[11px] text-rose-300">{error}</p>}
            </div>
          )}

          {!editing && error && (
            <p className="text-[11px] text-rose-300">{error}</p>
          )}
        </>
      )}
    </div>
  )
}

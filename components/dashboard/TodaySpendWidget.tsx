'use client'

/**
 * Day-to-date AI spend with progress bar against the user's daily cap.
 * Goes amber at 60%, red at 80% so the operator notices BEFORE the cap
 * trips and starts returning HTTP 402 on every call.
 *
 * Shares the `/api/gateway-status` endpoint with `<GatewayStatusPill>`
 * so we don't have two different polling streams hitting the database.
 */

import { useEffect, useState } from 'react'
import { DollarSign, AlertTriangle } from 'lucide-react'

const POLL_MS = 30_000

interface SpendSnapshot {
  spentUsd: number
  capUsd:   number
  scope:    'user' | 'business'
  provider: 'gateway' | 'openclaw' | 'api' | 'none'
}

export default function TodaySpendWidget() {
  const [snap, setSnap] = useState<SpendSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const res = await fetch('/api/gateway-status', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as SpendSnapshot
        if (!cancelled) setSnap(json)
      } catch { /* keep last */ }
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (!snap) {
    return (
      <div
        className="rounded-xl px-4 py-3"
        style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
      >
        <span className="text-xs" style={{ color: '#9090b0' }}>Loading…</span>
      </div>
    )
  }

  const pct = Math.min(100, (snap.spentUsd / Math.max(0.01, snap.capUsd)) * 100)
  const planBilled = snap.provider === 'gateway'
  let barColor = '#22c55e' // green
  if (pct >= 80) barColor = '#ef4444'
  else if (pct >= 60) barColor = '#f59e0b'
  if (planBilled) barColor = '#6c63ff'  // plan-billed = neutral purple

  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <DollarSign size={14} style={{ color: '#6c63ff' }} />
          <span className="text-xs uppercase tracking-wide font-medium" style={{ color: '#9090b0' }}>
            Today's AI spend
          </span>
        </div>
        {pct >= 80 && (
          <span
            className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
            style={{ color: '#ef4444', backgroundColor: '#2a1116' }}
            title="Approaching daily cap — calls return HTTP 402 once exceeded."
          >
            <AlertTriangle size={11} /> {pct.toFixed(0)}%
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="text-2xl font-bold tabular-nums" style={{ color: '#e8e8f0' }}>
          ${snap.spentUsd.toFixed(2)}
        </span>
        <span className="text-sm" style={{ color: '#55556a' }}>
          / ${snap.capUsd.toFixed(2)} cap
        </span>
      </div>

      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#1a1a2e' }}>
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>

      <p className="mt-2 text-xs" style={{ color: '#55556a' }}>
        {planBilled
          ? 'Routed through Claude Code gateway — plan-billed, this $ counter only reflects API-key fallbacks.'
          : 'API-billed — every call adds to today\'s total. Gateway down or unconfigured.'}
      </p>
    </div>
  )
}

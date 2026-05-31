'use client'

/**
 * /health — the operator's first LifeOS domain (Business-OS → Life-OS spine).
 *
 * A non-revenue habit tracker that reuses the SHIPPED daily-streak gamification
 * primitives (StreakBadge + CalendarHeatmap) — no second streak engine. Logging
 * a day advances the streak; the heatmap shows the history. Mobile-first.
 *
 * v1 is the habit surface; binding a Health DEPARTMENT to this life_domain (so
 * agents act on it) is the deferred agentic follow-up (L3/L4).
 */

import { useCallback, useEffect, useState } from 'react'
import { HeartPulse, Loader2, Check } from 'lucide-react'
import CalendarHeatmap from '@/components/learn/CalendarHeatmap'
import StreakBadge from '@/components/learn/StreakBadge'

interface HabitsResp {
  ok?:         boolean
  days:        Array<{ day: string; payload: Record<string, unknown> }>
  streak:      number
  loggedToday: boolean
}

export default function HealthPage() {
  const [data, setData]       = useState<HabitsResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [logging, setLogging] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/health/habits', { cache: 'no-store' })
      setData((await r.json()) as HabitsResp)
    } catch { /* leave null → empty state */ }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function logToday() {
    setLogging(true)
    try {
      await fetch('/api/health/habits', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ payload: { logged: true } }),
      })
      await load()
    } finally { setLogging(false) }
  }

  const heatmapDays = (data?.days ?? []).map(d => ({ date: d.day, xp: 25, cardsReviewed: 1 }))

  return (
    <div
      className="p-4 sm:p-6 min-h-full"
      style={{
        backgroundColor: '#050508',
        backgroundImage:
          'radial-gradient(1200px 600px at 10% -10%, rgba(251,113,133,0.08), transparent 60%), ' +
          'radial-gradient(900px 500px at 100% 100%, rgba(108,99,255,0.06), transparent 60%)',
      }}
    >
      <div className="max-w-4xl mx-auto">
        <div className="mb-5 flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(251,113,133,0.30), rgba(251,113,133,0.06))', border: '1px solid rgba(251,113,133,0.20)' }}
          >
            <HeartPulse size={18} style={{ color: '#fb7185' }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold" style={{ color: '#e8e8f0' }}>Health</h1>
            <p className="text-sm mt-1 max-w-2xl" style={{ color: '#9090b0' }}>
              Your first LifeOS domain — a non-revenue habit streak. Same engine as your Learn streak, no business machinery.
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm px-4 py-3" style={{ color: '#9090b0' }}>
            <Loader2 size={14} className="animate-spin" /> Loading your habits…
          </div>
        )}

        {!loading && (
          <>
            <div
              className="p-4 rounded-2xl flex items-center gap-4 flex-wrap"
              style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))', border: '1px solid rgba(255,255,255,0.10)' }}
            >
              <StreakBadge currentStreak={data?.streak ?? 0} freezesAvailable={0} />
              <button
                type="button"
                onClick={logToday}
                disabled={logging || data?.loggedToday}
                className="text-[12px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, rgba(251,113,133,0.30), rgba(251,113,133,0.10))', border: '1px solid rgba(251,113,133,0.30)', color: '#e8e8f0' }}
              >
                {logging ? <Loader2 size={12} className="animate-spin" /> : data?.loggedToday ? <Check size={12} /> : <HeartPulse size={12} />}
                {data?.loggedToday ? 'Logged today' : 'Log today'}
              </button>
              <span className="text-[11px] font-mono" style={{ color: '#55556a' }}>
                {data?.days.length ?? 0} days logged
              </span>
            </div>

            <div
              className="mt-4 p-4 rounded-2xl overflow-x-auto"
              style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))', border: '1px solid rgba(255,255,255,0.10)' }}
            >
              <CalendarHeatmap days={heatmapDays} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

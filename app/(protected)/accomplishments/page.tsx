'use client'

/**
 * /accomplishments — "Wins". A glanceable, motivating board of tiered
 * achievements driven by REAL revenue (experiment_metrics) + business/niche
 * counts. Pure read; reuses the dashboard's revenue truth, builds no second
 * engine. Mobile-first — the operator runs Nexus from their phone.
 *
 * v1 computes tiers live from current revenue. The idempotent unlock-persistence
 * + one-time "milestone" notification is a migration-gated follow-up.
 */

import { useEffect, useState } from 'react'
import { Trophy, Lock, Loader2, TrendingUp, Sparkles, Calendar } from 'lucide-react'

interface Achievement {
  id: string; label: string; description: string
  kind: 'business' | 'niche' | 'revenue'
  threshold: number; level: number
  current: number; unlocked: boolean; progress: number
}
interface AccomplishmentsState {
  ok?: boolean
  achievements: Achievement[]
  unlocked: Achievement[]
  locked: Achievement[]
  operatorLevel: number
  nextTier: Achievement | null
  liveEventLevel: number
  liveEventUnlocked: boolean
  combinedRevenue: number
  businessCount: number
  nicheCount: number
}

function fmtValue(a: Achievement): string {
  if (a.kind === 'revenue') return `$${a.current.toLocaleString(undefined, { maximumFractionDigits: 0 })} / $${a.threshold.toLocaleString()}`
  return `${a.current} / ${a.threshold}`
}

export default function AccomplishmentsPage() {
  const [state, setState] = useState<AccomplishmentsState | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/api/accomplishments', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive) { setState(j); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  return (
    <div
      className="p-4 sm:p-6 min-h-full"
      style={{
        backgroundColor: '#050508',
        backgroundImage:
          'radial-gradient(1200px 600px at 10% -10%, rgba(251,191,36,0.08), transparent 60%), ' +
          'radial-gradient(900px 500px at 100% 100%, rgba(108,99,255,0.06), transparent 60%)',
      }}
    >
      <div className="max-w-5xl mx-auto">
        {/* Heading */}
        <div className="mb-5 flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(251,191,36,0.30), rgba(251,191,36,0.06))', border: '1px solid rgba(251,191,36,0.20)' }}
          >
            <Trophy size={18} style={{ color: '#fbbf24' }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold" style={{ color: '#e8e8f0' }}>Wins</h1>
            <p className="text-sm mt-1 max-w-2xl" style={{ color: '#9090b0' }}>
              Achievements earned from real revenue across every business. No mocks — this tracks the same numbers as Mission Control.
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm px-4 py-3" style={{ color: '#9090b0' }}>
            <Loader2 size={14} className="animate-spin" /> Loading your wins…
          </div>
        )}

        {!loading && state && (
          <>
            {/* Level track */}
            <LevelTrack state={state} />

            {/* Achievement grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
              {state.achievements.map(a => <AchievementCard key={a.id} a={a} />)}
            </div>

            {/* Live-event hook */}
            <LiveEventHook state={state} />
          </>
        )}

        {!loading && !state && (
          <div className="text-sm px-4 py-6 text-center" style={{ color: '#9090b0' }}>
            Couldn’t load your wins right now — try again in a moment.
          </div>
        )}
      </div>
    </div>
  )
}

function LevelTrack({ state }: { state: AccomplishmentsState }) {
  const next = state.nextTier
  return (
    <div
      className="p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center gap-4"
      style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))', border: '1px solid rgba(255,255,255,0.10)' }}
    >
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(251,191,36,0.25), rgba(251,191,36,0.06))', border: '1px solid rgba(251,191,36,0.25)' }}>
          <span className="text-lg font-bold" style={{ color: '#fbbf24' }}>{state.operatorLevel}</span>
        </div>
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#9090b0' }}>Operator level</p>
          <p className="text-sm" style={{ color: '#e8e8f0' }}>
            {state.unlocked.length} of {state.achievements.length} unlocked · ${state.combinedRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} all-time
          </p>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        {next ? (
          <>
            <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: '#9090b0' }}>
              <span className="flex items-center gap-1"><TrendingUp size={11} /> Next: {next.label}</span>
              <span>{Math.round(next.progress * 100)}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.round(next.progress * 100)}%`, background: 'linear-gradient(90deg, #fbbf24, #f59e0b)' }} />
            </div>
            <p className="text-[10px] mt-1" style={{ color: '#55556a' }}>{fmtValue(next)} · {next.description}</p>
          </>
        ) : (
          <p className="text-xs" style={{ color: '#4ade80' }}>Every tier unlocked. Legend.</p>
        )}
      </div>
    </div>
  )
}

function AchievementCard({ a }: { a: Achievement }) {
  const kindIcon = a.kind === 'revenue' ? TrendingUp : a.kind === 'niche' ? Sparkles : Trophy
  const Icon = kindIcon
  return (
    <div
      className="p-3.5 rounded-2xl flex flex-col gap-2"
      style={{
        background: a.unlocked
          ? 'linear-gradient(135deg, rgba(251,191,36,0.12), rgba(251,191,36,0.02))'
          : 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
        border: a.unlocked ? '1px solid rgba(251,191,36,0.30)' : '1px solid rgba(255,255,255,0.08)',
        opacity: a.unlocked ? 1 : 0.75,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: a.unlocked ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.04)', border: a.unlocked ? '1px solid rgba(251,191,36,0.25)' : '1px solid rgba(255,255,255,0.08)' }}>
          {a.unlocked ? <Icon size={15} style={{ color: '#fbbf24' }} /> : <Lock size={13} style={{ color: '#55556a' }} />}
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(108,99,255,0.10)', color: '#a8a3ff', border: '1px solid rgba(108,99,255,0.20)' }}>Lv {a.level}</span>
      </div>
      <div>
        <p className="text-sm font-semibold" style={{ color: a.unlocked ? '#e8e8f0' : '#9090b0' }}>{a.label}</p>
        <p className="text-[11px] mt-0.5" style={{ color: '#9090b0' }}>{a.description}</p>
      </div>
      {!a.unlocked && (
        <div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.round(a.progress * 100)}%`, background: 'rgba(168,163,255,0.6)' }} />
          </div>
          <p className="text-[10px] mt-1 font-mono" style={{ color: '#55556a' }}>{fmtValue(a)}</p>
        </div>
      )}
      {a.unlocked && (
        <p className="text-[10px] font-mono" style={{ color: '#fbbf24' }}>✓ unlocked</p>
      )}
    </div>
  )
}

function LiveEventHook({ state }: { state: AccomplishmentsState }) {
  const unlocked = state.liveEventUnlocked
  return (
    <div
      className="mt-4 p-4 rounded-2xl flex items-center gap-3"
      style={{
        background: unlocked
          ? 'linear-gradient(135deg, rgba(74,222,128,0.12), rgba(74,222,128,0.02))'
          : 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
        border: unlocked ? '1px solid rgba(74,222,128,0.30)' : '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: unlocked ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.04)' }}>
        {unlocked ? <Calendar size={18} style={{ color: '#4ade80' }} /> : <Lock size={16} style={{ color: '#55556a' }} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: unlocked ? '#e8e8f0' : '#9090b0' }}>
          {unlocked ? 'Live event unlocked' : `Level ${state.liveEventLevel} unlocks: live event`}
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: '#9090b0' }}>
          {unlocked
            ? 'You’ve hit the threshold — the live-event experience is yours to claim.'
            : `Reach operator level ${state.liveEventLevel} (you’re at ${state.operatorLevel}) to unlock a live event.`}
        </p>
      </div>
    </div>
  )
}

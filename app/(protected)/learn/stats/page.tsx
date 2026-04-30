'use client'

import { useEffect, useState } from 'react'
import CalendarHeatmap from '@/components/learn/CalendarHeatmap'
import { TrendingUp, Crown, AlertTriangle } from 'lucide-react'
import type { LearnStats } from '@/lib/types'

export default function LearnStatsPage() {
  const [stats, setStats] = useState<LearnStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/api/learn/stats')
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (alive) { setStats(j); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) return <p className="text-center py-12 text-sm" style={{ color: '#9090b0' }}>Loading…</p>
  if (!stats) return <p className="text-center py-12 text-sm" style={{ color: '#ef4444' }}>Failed to load stats.</p>

  const total = Object.values(stats.masteryHistogram).reduce((a, b) => a + b, 0)
  const mastered = stats.masteryHistogram.crown5
  const masteredPct = total > 0 ? Math.round((mastered / total) * 100) : 0

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1" style={{ color: '#e8e8f0' }}>Learning stats</h1>
        <p className="text-sm" style={{ color: '#9090b0' }}>
          {stats.streak.currentStreak}-day streak · longest {stats.streak.longestStreak} · {stats.streak.xpTotal.toLocaleString()} XP all-time
        </p>
      </div>

      {/* 90-day heatmap */}
      <section className="rounded-xl p-6" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
        <header className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#e8e8f0' }}>
            Last 90 days
          </h2>
          <span className="text-xs" style={{ color: '#9090b0' }}>
            {stats.heatmap.filter(d => d.cardsReviewed > 0).length} active days
          </span>
        </header>
        <CalendarHeatmap days={stats.heatmap} />
      </section>

      {/* Mastery histogram */}
      <section className="rounded-xl p-6" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
        <header className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#e8e8f0' }}>
            Mastery
          </h2>
          <span className="text-xs flex items-center gap-1" style={{ color: '#22c55e' }}>
            <Crown size={12} /> {mastered} cards fully mastered ({masteredPct}%)
          </span>
        </header>
        <div className="grid grid-cols-6 gap-2">
          {[0, 1, 2, 3, 4, 5].map(level => {
            const key = `crown${level}` as keyof typeof stats.masteryHistogram
            const count = stats.masteryHistogram[key]
            const pct = total > 0 ? (count / total) * 100 : 0
            return (
              <div key={level} className="flex flex-col items-center gap-2">
                <div className="h-24 w-full rounded relative overflow-hidden" style={{ backgroundColor: '#1a1a2e' }}>
                  <div
                    className="absolute bottom-0 left-0 right-0 transition-all"
                    style={{ height: `${pct}%`, backgroundColor: level === 5 ? '#22c55e' : level >= 3 ? '#f59e0b' : '#6c63ff' }}
                  />
                </div>
                <div className="text-center">
                  <div className="text-xs font-bold" style={{ color: '#e8e8f0' }}>{count}</div>
                  <div className="text-[10px]" style={{ color: '#9090b0' }}>Crown {level}</div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Per-MOC retention */}
      {stats.retentionByMoc.length > 0 && (
        <section className="rounded-xl p-6" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
          <header className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} style={{ color: '#9090b0' }} />
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#e8e8f0' }}>
              Retention by topic (last 30d)
            </h2>
          </header>
          <div className="space-y-3">
            {stats.retentionByMoc.map(m => (
              <div key={m.mocSlug}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span style={{ color: '#e8e8f0' }}>{m.title}</span>
                  <span style={{ color: '#9090b0' }}>{Math.round(m.retention * 100)}% · n={m.sampleSize}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#1a1a2e' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${m.retention * 100}%`, backgroundColor: m.retention >= 0.85 ? '#22c55e' : m.retention >= 0.6 ? '#f59e0b' : '#ef4444' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Weakest atoms */}
      {stats.weakestAtoms.length > 0 && (
        <section className="rounded-xl p-6" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
          <h2 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: '#e8e8f0' }}>
            Weakest atoms — drill these next
          </h2>
          <ul className="space-y-2">
            {stats.weakestAtoms.map(a => (
              <li key={a.atomSlug} className="flex items-center justify-between text-sm">
                <span style={{ color: '#e8e8f0' }}>{a.title}</span>
                <span className="text-xs" style={{ color: '#ef4444' }}>{Math.round(a.retrievability * 100)}% retrievability</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats.staleCount > 0 && (
        <div className="rounded-lg p-4 flex items-start gap-3" style={{ backgroundColor: '#f59e0b22', border: '1px solid #f59e0b44' }}>
          <AlertTriangle size={18} style={{ color: '#f59e0b' }} className="mt-0.5" />
          <div>
            <p className="text-sm font-medium" style={{ color: '#e8e8f0' }}>
              {stats.staleCount} card{stats.staleCount === 1 ? '' : 's'} flagged stale
            </p>
            <p className="text-xs mt-1" style={{ color: '#9090b0' }}>
              The underlying atom changed since you last reviewed; the card has been reset to learning so the new fact takes priority.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import PathView from '@/components/learn/PathView'
import { Play, AlertTriangle } from 'lucide-react'
import type { LearnPathUnit, LearnStats } from '@/lib/types'

export default function LearnHomePage() {
  const [units, setUnits] = useState<LearnPathUnit[]>([])
  const [stats, setStats] = useState<LearnStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch('/api/learn/path').then(r => r.ok ? r.json() : { units: [] }),
      fetch('/api/learn/stats').then(r => r.ok ? r.json() : null),
    ]).then(([p, s]) => {
      if (!alive) return
      setUnits(p.units ?? [])
      setStats(s)
      setLoading(false)
    }).catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const dueCount = units.reduce((sum, u) => sum + u.lessons.filter(l => l.nextDueAt && new Date(l.nextDueAt).getTime() <= Date.now()).length, 0)
  const stale = stats?.staleCount ?? 0

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: '#e8e8f0' }}>Learn</h1>
          <p className="text-sm" style={{ color: '#9090b0' }}>
            {dueCount > 0 ? `${dueCount} card${dueCount === 1 ? '' : 's'} due` : 'All caught up — nothing due'}
            {stale > 0 && (
              <span className="ml-3 inline-flex items-center gap-1" style={{ color: '#f59e0b' }}>
                <AlertTriangle size={12} /> {stale} stale
              </span>
            )}
          </p>
        </div>
        <Link
          href="/learn/session"
          className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 font-bold"
          style={{ backgroundColor: '#6c63ff', color: '#fff' }}
        >
          <Play size={16} />
          {dueCount > 0 ? 'Start review' : 'Practice anyway'}
        </Link>
      </div>

      {loading ? (
        <div className="rounded-xl py-16 text-center" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
          <p className="text-sm" style={{ color: '#9090b0' }}>Loading path…</p>
        </div>
      ) : (
        <PathView units={units} />
      )}
    </div>
  )
}

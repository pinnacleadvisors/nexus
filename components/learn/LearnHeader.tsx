'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import StreakBadge from './StreakBadge'
import XpBar from './XpBar'
import { BarChart3, Brain, Play } from 'lucide-react'
import type { LearnStats } from '@/lib/types'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/learn', label: 'Path', icon: Brain },
  { href: '/learn/session', label: 'Review', icon: Play },
  { href: '/learn/stats', label: 'Stats', icon: BarChart3 },
]

export default function LearnHeader() {
  const [stats, setStats] = useState<LearnStats | null>(null)
  const pathname = usePathname() ?? ''

  useEffect(() => {
    let alive = true
    fetch('/api/learn/stats')
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (alive && j) setStats(j) })
      .catch(() => {})
    return () => { alive = false }
  }, [pathname])

  return (
    <header className="flex items-center justify-between flex-wrap gap-4">
      <div className="flex items-center gap-2">
        {TABS.map(tab => {
          const active = pathname === tab.href || (tab.href !== '/learn' && pathname.startsWith(tab.href))
          const isPath = tab.href === '/learn'
          const exact = isPath ? pathname === '/learn' : active
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn('flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors')}
              style={{
                backgroundColor: exact ? '#6c63ff22' : 'transparent',
                color: exact ? '#6c63ff' : '#9090b0',
                border: `1px solid ${exact ? '#6c63ff44' : 'transparent'}`,
              }}
            >
              <tab.icon size={14} />
              {tab.label}
            </Link>
          )
        })}
      </div>

      <div className="flex items-center gap-3">
        <XpBar xpToday={stats?.streak.xpToday ?? 0} goal={stats?.dailyGoalXp ?? 30} />
        <StreakBadge currentStreak={stats?.streak.currentStreak ?? 0} freezesAvailable={stats?.streak.freezesAvailable ?? 0} />
      </div>
    </header>
  )
}

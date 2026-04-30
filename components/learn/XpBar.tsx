'use client'

import { Zap } from 'lucide-react'

interface Props {
  xpToday: number
  goal: number
}

export default function XpBar({ xpToday, goal }: Props) {
  const pct = Math.min(100, Math.round((xpToday / Math.max(1, goal)) * 100))
  const hit = xpToday >= goal
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-2 min-w-[200px]"
      style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
    >
      <Zap size={18} style={{ color: hit ? '#22c55e' : '#6c63ff' }} />
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium" style={{ color: '#e8e8f0' }}>
            {xpToday} / {goal} XP
          </span>
          {hit && <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#22c55e' }}>Goal!</span>}
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#1a1a2e' }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct}%`, backgroundColor: hit ? '#22c55e' : '#6c63ff' }}
          />
        </div>
      </div>
    </div>
  )
}

'use client'

import { Flame, Snowflake } from 'lucide-react'

interface Props {
  currentStreak: number
  freezesAvailable: number
}

export default function StreakBadge({ currentStreak, freezesAvailable }: Props) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-2"
      style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
    >
      <div className="flex items-center gap-1.5">
        <Flame size={20} style={{ color: '#f59e0b' }} />
        <span className="text-xl font-bold" style={{ color: '#e8e8f0' }}>{currentStreak}</span>
        <span className="text-xs" style={{ color: '#9090b0' }}>day{currentStreak === 1 ? '' : 's'}</span>
      </div>
      {freezesAvailable > 0 && (
        <div
          className="flex items-center gap-1 pl-3 border-l"
          style={{ borderColor: '#24243e' }}
          title="Freeze tokens preserve your streak when you miss a day"
        >
          <Snowflake size={14} style={{ color: '#3b82f6' }} />
          <span className="text-xs" style={{ color: '#9090b0' }}>{freezesAvailable}</span>
        </div>
      )}
    </div>
  )
}

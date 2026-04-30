'use client'

import Link from 'next/link'
import { Trophy, Zap, Target, Clock } from 'lucide-react'

interface Props {
  cardsReviewed: number
  correctCount: number
  xpEarned: number
  avgDurationMs: number
  newStreak?: number
}

export default function SessionResults({ cardsReviewed, correctCount, xpEarned, avgDurationMs, newStreak }: Props) {
  const accuracy = cardsReviewed > 0 ? Math.round((correctCount / cardsReviewed) * 100) : 0
  const seconds = Math.round(avgDurationMs / 1000)

  return (
    <div className="space-y-6 max-w-md mx-auto">
      <div className="text-center">
        <div
          className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-4"
          style={{ backgroundColor: '#22c55e22', border: '2px solid #22c55e' }}
        >
          <Trophy size={32} style={{ color: '#22c55e' }} />
        </div>
        <h2 className="text-2xl font-bold mb-1" style={{ color: '#e8e8f0' }}>
          Session complete
        </h2>
        {newStreak !== undefined && (
          <p className="text-sm" style={{ color: '#9090b0' }}>
            🔥 {newStreak}-day streak
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat icon={<Zap size={16} style={{ color: '#6c63ff' }} />} label="XP earned" value={`+${xpEarned}`} />
        <Stat icon={<Target size={16} style={{ color: '#22c55e' }} />} label="Accuracy" value={`${accuracy}%`} />
        <Stat icon={<Trophy size={16} style={{ color: '#f59e0b' }} />} label="Cards" value={`${cardsReviewed}`} />
        <Stat icon={<Clock size={16} style={{ color: '#9090b0' }} />} label="Avg time" value={`${seconds}s`} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/learn"
          className="rounded-lg py-3 text-center font-bold"
          style={{ backgroundColor: '#12121e', border: '1px solid #24243e', color: '#e8e8f0' }}
        >
          Back to path
        </Link>
        <Link
          href="/learn/session"
          className="rounded-lg py-3 text-center font-bold"
          style={{ backgroundColor: '#6c63ff', color: '#fff' }}
        >
          Another round
        </Link>
      </div>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs" style={{ color: '#9090b0' }}>{label}</span>
      </div>
      <div className="text-xl font-bold" style={{ color: '#e8e8f0' }}>{value}</div>
    </div>
  )
}

import type { KpiCard } from '@/lib/types'
import { TrendingUp, TrendingDown } from 'lucide-react'

const COLOR_MAP = {
  default: { value: '#e8e8f0', delta: '' },
  green: { value: '#22c55e', delta: '' },
  red: { value: '#ef4444', delta: '' },
  purple: { value: '#6c63ff', delta: '' },
}

interface Props {
  cards: KpiCard[]
}

export default function KpiGrid({ cards }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {cards.map(card => {
        const colors = COLOR_MAP[card.color ?? 'default']
        const deltaPositive = (card.delta ?? 0) >= 0
        return (
          <div
            key={card.label}
            className="rounded-xl p-4"
            style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
          >
            <p className="text-xs font-medium mb-2" style={{ color: '#9090b0' }}>
              {card.label}
            </p>
            <p className="text-2xl font-bold mb-2" style={{ color: colors.value }}>
              {card.value}
            </p>
            {card.delta !== undefined && (
              <div className="flex items-center gap-1">
                {deltaPositive ? (
                  <TrendingUp size={12} style={{ color: '#22c55e' }} />
                ) : (
                  <TrendingDown size={12} style={{ color: '#ef4444' }} />
                )}
                <span
                  className="text-xs font-medium"
                  style={{ color: deltaPositive ? '#22c55e' : '#ef4444' }}
                >
                  {deltaPositive ? '+' : ''}{card.delta}%
                </span>
                <span className="text-xs" style={{ color: '#55556a' }}>
                  vs last month
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

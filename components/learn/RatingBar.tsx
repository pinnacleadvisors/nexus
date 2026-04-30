'use client'

import type { ReviewRating } from '@/lib/types'

interface Props {
  onRate: (rating: ReviewRating) => void
  highlight?: ReviewRating
  disabled?: boolean
}

const BUTTONS: Array<{ rating: ReviewRating; label: string; color: string; help: string }> = [
  { rating: 'again', label: 'Again', color: '#ef4444', help: '<1m' },
  { rating: 'hard',  label: 'Hard',  color: '#f59e0b', help: '~10m' },
  { rating: 'good',  label: 'Good',  color: '#22c55e', help: '~1d' },
  { rating: 'easy',  label: 'Easy',  color: '#3b82f6', help: '~4d' },
]

export default function RatingBar({ onRate, highlight, disabled }: Props) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {BUTTONS.map(b => (
        <button
          key={b.rating}
          onClick={() => onRate(b.rating)}
          disabled={disabled}
          className="rounded-lg py-3 px-3 text-sm font-bold transition-all disabled:opacity-40"
          style={{
            backgroundColor: highlight === b.rating ? `${b.color}33` : '#12121e',
            border: `1px solid ${highlight === b.rating ? b.color : '#24243e'}`,
            color: '#e8e8f0',
          }}
        >
          <div>{b.label}</div>
          <div className="text-[10px] font-normal mt-0.5" style={{ color: '#9090b0' }}>{b.help}</div>
        </button>
      ))}
    </div>
  )
}

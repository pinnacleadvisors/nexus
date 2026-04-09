'use client'

import type { DateRange } from '@/lib/types'

const RANGES: { label: string; value: DateRange }[] = [
  { label: '7d',  value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: 'All', value: 'all' },
]

interface Props {
  value: DateRange
  onChange: (range: DateRange) => void
}

export default function DateRangeFilter({ value, onChange }: Props) {
  return (
    <div
      className="flex items-center gap-1 rounded-lg p-1"
      style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
    >
      {RANGES.map(r => (
        <button
          key={r.value}
          onClick={() => onChange(r.value)}
          className="px-3 py-1 rounded-md text-xs font-medium transition-all"
          style={
            value === r.value
              ? { backgroundColor: '#1a1a2e', color: '#e8e8f0', border: '1px solid #24243e' }
              : { color: '#55556a', border: '1px solid transparent' }
          }
          onMouseEnter={e => {
            if (value !== r.value)
              (e.currentTarget as HTMLButtonElement).style.color = '#9090b0'
          }}
          onMouseLeave={e => {
            if (value !== r.value)
              (e.currentTarget as HTMLButtonElement).style.color = '#55556a'
          }}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

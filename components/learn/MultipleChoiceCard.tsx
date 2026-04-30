'use client'

import { useState } from 'react'
import RatingBar from './RatingBar'
import { Check, X } from 'lucide-react'
import type { Flashcard, ReviewRating } from '@/lib/types'

interface Props {
  card: Flashcard
  onComplete: (rating: ReviewRating, durationMs: number, answer: string) => void
}

export default function MultipleChoiceCard({ card, onComplete }: Props) {
  const [picked, setPicked] = useState<string | null>(null)
  const [start] = useState(() => Date.now())

  const options = card.options ?? []
  const correct = picked === card.back
  const suggested: ReviewRating = picked ? (correct ? 'good' : 'again') : 'good'

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl p-8"
        style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
      >
        <div className="text-xs uppercase tracking-wider mb-3 text-center" style={{ color: '#9090b0' }}>
          Pick the right answer
        </div>
        <div className="text-lg font-medium text-center" style={{ color: '#e8e8f0' }}>
          {card.front}
        </div>
      </div>

      <div className="grid gap-3">
        {options.map(opt => {
          const isPicked = picked === opt
          const showCorrect = picked && opt === card.back
          const showWrong = isPicked && !correct
          return (
            <button
              key={opt}
              onClick={() => !picked && setPicked(opt)}
              disabled={Boolean(picked)}
              className="rounded-lg px-4 py-3 text-left flex items-center justify-between transition-all"
              style={{
                backgroundColor: showCorrect ? '#22c55e22' : showWrong ? '#ef444422' : '#12121e',
                border: `1px solid ${showCorrect ? '#22c55e' : showWrong ? '#ef4444' : '#24243e'}`,
                color: '#e8e8f0',
                cursor: picked ? 'default' : 'pointer',
              }}
            >
              <span>{opt}</span>
              {showCorrect && <Check size={18} style={{ color: '#22c55e' }} />}
              {showWrong && <X size={18} style={{ color: '#ef4444' }} />}
            </button>
          )
        })}
      </div>

      {picked && (
        <RatingBar
          highlight={suggested}
          onRate={r => onComplete(r, Date.now() - start, picked)}
        />
      )}
    </div>
  )
}

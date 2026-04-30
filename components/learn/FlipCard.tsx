'use client'

import { useState } from 'react'
import RatingBar from './RatingBar'
import type { Flashcard, ReviewRating } from '@/lib/types'

interface Props {
  card: Flashcard
  onComplete: (rating: ReviewRating, durationMs: number) => void
}

export default function FlipCard({ card, onComplete }: Props) {
  const [revealed, setRevealed] = useState(false)
  const [start] = useState(() => Date.now())

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl p-8 min-h-[260px] flex items-center justify-center text-center cursor-pointer select-none"
        style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
        onClick={() => setRevealed(true)}
      >
        <div>
          <div className="text-xs uppercase tracking-wider mb-3" style={{ color: '#9090b0' }}>
            {revealed ? 'Answer' : 'Question — tap to reveal'}
          </div>
          <div
            className="text-xl font-medium leading-relaxed"
            style={{ color: '#e8e8f0' }}
          >
            {revealed ? card.back : card.front}
          </div>
        </div>
      </div>

      {revealed ? (
        <RatingBar onRate={r => onComplete(r, Date.now() - start)} />
      ) : (
        <p className="text-center text-xs" style={{ color: '#55556a' }}>
          Tap the card to reveal the answer
        </p>
      )}
    </div>
  )
}

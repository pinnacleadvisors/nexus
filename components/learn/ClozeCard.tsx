'use client'

import { useState } from 'react'
import RatingBar from './RatingBar'
import type { Flashcard, ReviewRating } from '@/lib/types'

interface Props {
  card: Flashcard
  onComplete: (rating: ReviewRating, durationMs: number, answer: string) => void
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

export default function ClozeCard({ card, onComplete }: Props) {
  const [input, setInput] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [start] = useState(() => Date.now())

  const correct = revealed && normalise(input) === normalise(card.back)
  // Highlight Good when correct, Again when wrong; user can override.
  const suggested: ReviewRating = revealed ? (correct ? 'good' : 'again') : 'good'

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl p-8 min-h-[200px] flex items-center justify-center text-center"
        style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
      >
        <div>
          <div className="text-xs uppercase tracking-wider mb-3" style={{ color: '#9090b0' }}>
            Fill in the blank
          </div>
          <div
            className="text-lg leading-relaxed"
            style={{ color: '#e8e8f0' }}
          >
            {card.front.split('____').map((part, i, arr) => (
              <span key={i}>
                {part}
                {i < arr.length - 1 && (
                  <span
                    className="inline-block mx-1 px-3 py-0.5 rounded font-bold"
                    style={{ backgroundColor: revealed ? (correct ? '#22c55e22' : '#ef444422') : '#1a1a2e', color: revealed ? (correct ? '#22c55e' : '#ef4444') : '#6c63ff' }}
                  >
                    {revealed ? card.back : '____'}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>

      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !revealed) setRevealed(true) }}
        disabled={revealed}
        placeholder="Type your answer…"
        className="w-full rounded-lg px-4 py-3 text-base outline-none"
        style={{ backgroundColor: '#12121e', border: `1px solid ${revealed ? (correct ? '#22c55e' : '#ef4444') : '#24243e'}`, color: '#e8e8f0' }}
        autoFocus
      />

      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="w-full rounded-lg py-3 font-bold"
          style={{ backgroundColor: '#6c63ff', color: '#fff' }}
        >
          Check
        </button>
      ) : (
        <RatingBar
          highlight={suggested}
          onRate={r => onComplete(r, Date.now() - start, input)}
        />
      )}
    </div>
  )
}

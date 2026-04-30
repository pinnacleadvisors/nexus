'use client'

import { useEffect, useState } from 'react'
import ReviewCard, { type ReviewSubmission } from '@/components/learn/ReviewCard'
import SessionResults from '@/components/learn/SessionResults'
import type { Flashcard } from '@/lib/types'
import Link from 'next/link'

interface SessionState {
  cards: Flashcard[]
  index: number
  reviewed: number
  correct: number
  xp: number
  durations: number[]
  done: boolean
  newStreak?: number
}

const INITIAL: SessionState = {
  cards: [],
  index: 0,
  reviewed: 0,
  correct: 0,
  xp: 0,
  durations: [],
  done: false,
}

export default function LearnSessionPage() {
  const [state, setState] = useState<SessionState>(INITIAL)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/learn/session?size=10')
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(j => {
        if (!alive) return
        const cards = (j.cards ?? []) as Flashcard[]
        setState({ ...INITIAL, cards, done: cards.length === 0 })
        setLoading(false)
      })
      .catch(e => { if (alive) { setError(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [])

  async function submit(s: ReviewSubmission) {
    const card = state.cards[state.index]
    if (!card) return
    let newStreak: number | undefined
    try {
      const res = await fetch('/api/learn/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cardId: card.id,
          rating: s.rating,
          durationMs: s.durationMs,
          answer: s.answer,
          grade: s.grade,
          gradeFeedback: s.gradeFeedback,
        }),
      })
      if (res.ok) {
        const json = await res.json()
        newStreak = json.streakCount
      }
    } catch {}
    setState(prev => {
      const correct = s.rating !== 'again' ? prev.correct + 1 : prev.correct
      const xp = prev.xp + (s.rating === 'easy' ? 5 : s.rating === 'good' ? 4 : s.rating === 'hard' ? 2 : 1)
      const nextIndex = prev.index + 1
      const done = nextIndex >= prev.cards.length
      return {
        ...prev,
        index: nextIndex,
        reviewed: prev.reviewed + 1,
        correct,
        xp,
        durations: [...prev.durations, s.durationMs],
        done,
        newStreak: done ? newStreak ?? prev.newStreak : prev.newStreak,
      }
    })
  }

  if (loading) {
    return <p className="text-center py-12 text-sm" style={{ color: '#9090b0' }}>Loading cards…</p>
  }
  if (error) {
    return <p className="text-center py-12 text-sm" style={{ color: '#ef4444' }}>Failed: {error}</p>
  }
  if (state.cards.length === 0) {
    return (
      <div className="text-center py-16 max-w-md mx-auto">
        <p className="text-base font-medium mb-2" style={{ color: '#e8e8f0' }}>Nothing to review</p>
        <p className="text-sm mb-6" style={{ color: '#9090b0' }}>
          Add atoms to <code className="text-xs px-1 rounded" style={{ backgroundColor: '#1a1a2e' }}>memory/molecular</code> and run <code className="text-xs px-1 rounded" style={{ backgroundColor: '#1a1a2e' }}>/api/cron/sync-learning-cards</code> to populate your deck.
        </p>
        <Link href="/learn" className="rounded-lg px-4 py-2 inline-block font-bold" style={{ backgroundColor: '#6c63ff', color: '#fff' }}>
          Back to path
        </Link>
      </div>
    )
  }
  if (state.done) {
    const avg = state.durations.length > 0 ? state.durations.reduce((a, b) => a + b, 0) / state.durations.length : 0
    return (
      <SessionResults
        cardsReviewed={state.reviewed}
        correctCount={state.correct}
        xpEarned={state.xp}
        avgDurationMs={avg}
        newStreak={state.newStreak}
      />
    )
  }

  const card = state.cards[state.index]
  if (!card) return null
  const total = state.cards.length

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#1a1a2e' }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${(state.index / total) * 100}%`, backgroundColor: '#6c63ff' }}
          />
        </div>
        <span className="text-xs" style={{ color: '#9090b0' }}>{state.index + 1} / {total}</span>
      </div>

      <ReviewCard card={card} onComplete={submit} />
    </div>
  )
}

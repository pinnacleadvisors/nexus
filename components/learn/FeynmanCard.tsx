'use client'

import { useState } from 'react'
import RatingBar from './RatingBar'
import { Sparkles, Loader2 } from 'lucide-react'
import type { Flashcard, ReviewRating } from '@/lib/types'

interface Props {
  card: Flashcard
  onComplete: (rating: ReviewRating, durationMs: number, answer: string, grade?: number, feedback?: string) => void
}

interface Grade { score: number; feedback: string; suggestedRating: ReviewRating }

export default function FeynmanCard({ card, onComplete }: Props) {
  const [text, setText] = useState('')
  const [grading, setGrading] = useState(false)
  const [grade, setGrade] = useState<Grade | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [start] = useState(() => Date.now())

  async function gradeNow() {
    setGrading(true)
    setError(null)
    try {
      const res = await fetch('/api/learn/grade-feynman', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cardId: card.id, explanation: text }),
      })
      if (res.status === 429) {
        setError('Hold on — you can grade once per minute. Self-rate below.')
        setGrading(false)
        return
      }
      if (!res.ok) throw new Error(`status ${res.status}`)
      const json = await res.json() as Grade
      setGrade(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Grading failed; self-rate below.')
    } finally {
      setGrading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl p-8"
        style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
      >
        <div className="text-xs uppercase tracking-wider mb-3" style={{ color: '#9090b0' }}>
          Feynman — explain in your own words
        </div>
        <div className="text-xl font-medium" style={{ color: '#e8e8f0' }}>{card.front}</div>
      </div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={6}
        placeholder="Explain it like you're teaching someone who's never heard of Nexus…"
        className="w-full rounded-lg px-4 py-3 text-base outline-none resize-none"
        style={{ backgroundColor: '#12121e', border: '1px solid #24243e', color: '#e8e8f0' }}
        disabled={Boolean(grade)}
      />

      {!grade ? (
        <button
          onClick={gradeNow}
          disabled={grading || text.trim().length < 10}
          className="w-full rounded-lg py-3 font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ backgroundColor: '#6c63ff', color: '#fff' }}
        >
          {grading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {grading ? 'Grading…' : 'Grade my explanation'}
        </button>
      ) : (
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: '#12121e', border: `1px solid ${grade.score >= 70 ? '#22c55e' : grade.score >= 50 ? '#f59e0b' : '#ef4444'}` }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider" style={{ color: '#9090b0' }}>Score</span>
            <span className="text-2xl font-bold" style={{ color: '#e8e8f0' }}>{grade.score}</span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: '#e8e8f0' }}>{grade.feedback}</p>
          <details className="mt-3 text-xs" style={{ color: '#9090b0' }}>
            <summary className="cursor-pointer">Reference</summary>
            <p className="mt-2 leading-relaxed">{card.referenceContext ?? card.back}</p>
          </details>
        </div>
      )}

      {error && <p className="text-xs" style={{ color: '#f59e0b' }}>{error}</p>}

      {(grade || error) && (
        <RatingBar
          highlight={grade?.suggestedRating}
          onRate={r => onComplete(r, Date.now() - start, text, grade?.score, grade?.feedback)}
        />
      )}
    </div>
  )
}

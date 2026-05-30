'use client'

import type { Flashcard, ReviewRating } from '@/lib/types'
import FeynmanCard from './FeynmanCard'

interface Props {
  card: Flashcard
  onComplete: (rating: ReviewRating, durationMs: number, answer: string, grade?: number, feedback?: string) => void
}

/**
 * ConceptCard — a platform-internals lesson (Phase 24). The lesson body lives
 * in `referenceContext`; it renders up front as the teaching content, then
 * reuses the Feynman "explain it back" flow for active recall + grading against
 * the same body (the grader reads `reference_context` as the answer key).
 */
export default function ConceptCard({ card, onComplete }: Props) {
  const lesson = card.referenceContext ?? card.back
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-violet-500/20 bg-violet-950/10 p-5">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-violet-300">
          Platform internals — lesson
        </div>
        <div
          className="whitespace-pre-wrap text-sm leading-relaxed"
          style={{ color: '#d4d4e4' }}
        >
          {lesson}
        </div>
      </div>
      <FeynmanCard card={card} onComplete={onComplete} />
    </div>
  )
}

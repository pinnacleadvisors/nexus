'use client'

import FlipCard from './FlipCard'
import ClozeCard from './ClozeCard'
import MultipleChoiceCard from './MultipleChoiceCard'
import FeynmanCard from './FeynmanCard'
import type { Flashcard, ReviewRating } from '@/lib/types'

export interface ReviewSubmission {
  rating: ReviewRating
  durationMs: number
  answer?: string
  grade?: number
  gradeFeedback?: string
}

interface Props {
  card: Flashcard
  onComplete: (s: ReviewSubmission) => void
}

export default function ReviewCard({ card, onComplete }: Props) {
  switch (card.kind) {
    case 'flip':
      return <FlipCard card={card} onComplete={(rating, durationMs) => onComplete({ rating, durationMs })} />
    case 'cloze':
      return <ClozeCard card={card} onComplete={(rating, durationMs, answer) => onComplete({ rating, durationMs, answer })} />
    case 'multiple-choice':
      return <MultipleChoiceCard card={card} onComplete={(rating, durationMs, answer) => onComplete({ rating, durationMs, answer })} />
    case 'feynman':
      return <FeynmanCard card={card} onComplete={(rating, durationMs, answer, grade, feedback) => onComplete({ rating, durationMs, answer, grade, gradeFeedback: feedback })} />
  }
}

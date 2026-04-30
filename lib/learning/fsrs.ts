import type { CardState, Flashcard, ReviewRating } from '@/lib/types'

/**
 * FSRS-4 scheduler — pure-TS port of the open-source reference (Apache-2.0).
 *
 * Core idea: each card has a `stability` (memory half-life in days) and a
 * `difficulty` (how hard the user finds it, 1–10). After each review, the
 * scheduler computes the next due interval based on the current retrievability
 * and the user's rating. See https://github.com/open-spaced-repetition/fsrs4anki
 * for the full math; this module only ports the transitions we use.
 */

// 17-parameter weight vector from the FSRS-4 reference defaults.
const W: readonly number[] = [
  0.4, 0.6, 2.4, 5.8,    // initial stability per rating
  4.93, 0.94, 0.86, 0.01, // difficulty + recall factors
  1.49, 0.14, 0.94,       // stability change weights
  2.18, 0.05, 0.34,       // forget-state weights
  1.26, 0.29, 2.61,       // misc decay
] as const

const REQUEST_RETENTION = 0.9 // target retrievability when scheduling next review
const MAX_INTERVAL_DAYS = 365 * 5
const MIN_INTERVAL_DAYS = 1

const RATING_TO_INDEX: Record<ReviewRating, number> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
}

export interface SchedulerInput {
  state: CardState
  stability: number
  difficulty: number
  lastReviewedAt: string | null
  rating: ReviewRating
  now?: Date
}

export interface SchedulerResult {
  state: CardState
  stability: number
  difficulty: number
  retrievability: number
  /** Days until next review */
  intervalDays: number
  /** Next due ISO timestamp */
  dueAt: string
  /** Crown level 0–5 derived from stability buckets */
  crown: number
}

/** Days between two timestamps (>= 0). */
function daysBetween(a: Date, b: Date): number {
  return Math.max(0, (a.getTime() - b.getTime()) / 86_400_000)
}

/** Retrievability as a function of elapsed days and current stability. */
function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 1
  return Math.pow(1 + elapsedDays / (9 * stability), -1)
}

/** Initial difficulty after the very first review. */
function initialDifficulty(rating: ReviewRating): number {
  const ratingIdx = RATING_TO_INDEX[rating]
  const d = W[4]! - (ratingIdx - 3) * W[5]!
  return clamp(d, 1, 10)
}

/** Initial stability after the very first review. */
function initialStability(rating: ReviewRating): number {
  return Math.max(W[RATING_TO_INDEX[rating] - 1] ?? 0.4, 0.1)
}

/** Update difficulty after a non-initial review. */
function nextDifficulty(d: number, rating: ReviewRating): number {
  const ratingIdx = RATING_TO_INDEX[rating]
  const next = d - W[6]! * (ratingIdx - 3)
  // Mean-reversion toward the initial difficulty for `good`.
  const target = W[4]! - W[5]! * 0
  const reverted = next + W[7]! * (target - next)
  return clamp(reverted, 1, 10)
}

/** Stability after a successful (>=hard) review. */
function nextRecallStability(d: number, s: number, r: number, rating: ReviewRating): number {
  const hardPenalty = rating === 'hard' ? W[15]! : 1
  const easyBonus = rating === 'easy' ? W[16]! : 1
  const factor = Math.exp(W[8]!) *
                 (11 - d) *
                 Math.pow(s, -W[9]!) *
                 (Math.exp(W[10]! * (1 - r)) - 1)
  return s * (1 + factor * hardPenalty * easyBonus)
}

/** Stability after a forgotten (`again`) review. */
function nextForgetStability(d: number, s: number, r: number): number {
  return W[11]! *
         Math.pow(d, -W[12]!) *
         (Math.pow(s + 1, W[13]!) - 1) *
         Math.exp(W[14]! * (1 - r))
}

/** Convert stability (days) into a 0–5 crown level for the path UI. */
export function stabilityToCrown(stability: number): number {
  if (stability < 1) return 0
  if (stability < 7) return 1
  if (stability < 30) return 2
  if (stability < 90) return 3
  if (stability < 180) return 4
  return 5
}

/** Compute next interval in days for a target retention. */
function nextInterval(stability: number): number {
  const days = (stability * 9 * (1 / REQUEST_RETENTION - 1))
  return clamp(Math.round(days), MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS)
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

/** Compute XP earned for a single review based on rating + state. */
export function xpForReview(rating: ReviewRating, prevState: CardState): number {
  const base = rating === 'easy' ? 5 : rating === 'good' ? 4 : rating === 'hard' ? 2 : 1
  const newCardBonus = prevState === 'new' ? 2 : 0
  return base + newCardBonus
}

/** Map a rating + previous state to the next CardState. */
function nextState(prev: CardState, rating: ReviewRating): CardState {
  if (rating === 'again') {
    return prev === 'review' ? 'relearning' : 'learning'
  }
  if (prev === 'new' || prev === 'learning' || prev === 'relearning') {
    // Promote out of learning after a `good` or `easy`. `hard` keeps it learning.
    return rating === 'hard' ? prev : 'review'
  }
  return 'review'
}

/**
 * Run the FSRS step for a single review. Pure function.
 */
export function schedule(input: SchedulerInput): SchedulerResult {
  const now = input.now ?? new Date()
  const lastReview = input.lastReviewedAt ? new Date(input.lastReviewedAt) : null
  const elapsed = lastReview ? daysBetween(now, lastReview) : 0
  const r = lastReview ? retrievability(elapsed, input.stability) : 1
  const isFirstReview = input.state === 'new' || input.stability === 0

  const difficulty = isFirstReview
    ? initialDifficulty(input.rating)
    : nextDifficulty(input.difficulty, input.rating)

  let stability: number
  if (isFirstReview) {
    stability = initialStability(input.rating)
  } else if (input.rating === 'again') {
    stability = nextForgetStability(difficulty, input.stability, r)
  } else {
    stability = nextRecallStability(difficulty, input.stability, r, input.rating)
  }
  stability = Math.max(stability, 0.1)

  const intervalDays = nextInterval(stability)
  const dueAt = new Date(now.getTime() + intervalDays * 86_400_000).toISOString()
  const state = nextState(input.state, input.rating)
  const crown = stabilityToCrown(stability)

  return { state, stability, difficulty, retrievability: r, intervalDays, dueAt, crown }
}

/** Crown level for a card given its current stability. */
export function crownForCard(card: Pick<Flashcard, 'stability'>): number {
  return stabilityToCrown(card.stability)
}

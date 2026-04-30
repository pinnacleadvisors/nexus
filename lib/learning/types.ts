/**
 * Internal types for the learning subsystem. Public types live in
 * `lib/types.ts` (re-exported below for ergonomic imports).
 */

export type {
  CardKind,
  CardState,
  ReviewRating,
  Flashcard,
  FlashcardReview,
  LearningSession,
  DailyStreak,
  LearnPathLesson,
  LearnPathUnit,
  LearnStats,
} from '@/lib/types'

/** Default daily XP target, overridable by `LEARN_DAILY_GOAL_XP`. */
export const DEFAULT_DAILY_GOAL_XP = 30

/** How many cards a session pulls by default. */
export const DEFAULT_SESSION_SIZE = 10

/** Maximum cards generated per atom by the cron. */
export const MAX_CARDS_PER_ATOM = 4

/** Minimum atom body length (chars) before we attempt cloze generation. */
export const MIN_BODY_FOR_CLOZE = 60

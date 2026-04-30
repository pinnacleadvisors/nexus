/**
 * POST /api/learn/review
 * Body: { cardId, rating, durationMs, answer?, grade?, gradeFeedback? }
 *
 * Records a review row, runs FSRS-4 to compute the next due timestamp,
 * updates the card, increments daily XP + streak.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { schedule, xpForReview, stabilityToCrown } from '@/lib/learning/fsrs'
import type { CardState, ReviewRating } from '@/lib/types'

export const runtime = 'nodejs'

interface ReviewBody {
  cardId: string
  rating: ReviewRating
  durationMs?: number
  answer?: string
  grade?: number
  gradeFeedback?: string
  sessionId?: string
}

const VALID_RATINGS: readonly ReviewRating[] = ['again', 'hard', 'good', 'easy']

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: ReviewBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 })
  }
  if (!body.cardId || !VALID_RATINGS.includes(body.rating)) {
    return NextResponse.json({ error: 'invalid-input' }, { status: 400 })
  }

  const sb = createServerClient()
  if (!sb) return NextResponse.json({ error: 'supabase-unconfigured' }, { status: 503 })

  type Loose = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  const db = sb as unknown as Loose

  const cardResp = await db.from('flashcards')
    .select('id, user_id, kind, atom_slug, state, stability, difficulty, last_reviewed_at, streak_count')
    .eq('id', body.cardId)
    .eq('user_id', userId)
    .maybeSingle()
  const card = cardResp.data as null | {
    id: string
    state: CardState
    stability: number
    difficulty: number
    last_reviewed_at: string | null
    streak_count: number
  }
  if (!card) return NextResponse.json({ error: 'card-not-found' }, { status: 404 })

  const next = schedule({
    state: card.state,
    stability: card.stability,
    difficulty: card.difficulty,
    lastReviewedAt: card.last_reviewed_at,
    rating: body.rating,
  })

  const xp = xpForReview(body.rating, card.state)
  const correct = body.rating !== 'again'
  const newStreakCount = correct ? card.streak_count + 1 : 0

  await db.from('flashcards').update({
    state: next.state,
    stability: next.stability,
    difficulty: next.difficulty,
    retrievability: next.retrievability,
    due_at: next.dueAt,
    crown: stabilityToCrown(next.stability),
    streak_count: newStreakCount,
    last_reviewed_at: new Date().toISOString(),
    stale_reason: null,
  }).eq('id', card.id)

  await db.from('flashcard_reviews').insert([{
    card_id: card.id,
    user_id: userId,
    rating: body.rating,
    answer: body.answer ?? null,
    grade: body.grade ?? null,
    grade_feedback: body.gradeFeedback ?? null,
    duration_ms: body.durationMs ?? 0,
    xp,
    prev_state: card.state,
    new_state: next.state,
    stability_after: next.stability,
    due_at_after: next.dueAt,
  }])

  // Streak + daily XP bookkeeping.
  await bumpStreak(db, userId, xp, correct)

  // Optional: append to in-progress session row.
  if (body.sessionId) {
    const sessResp = await db.from('learning_sessions')
      .select('id, cards_reviewed, correct_count, xp_earned')
      .eq('id', body.sessionId)
      .eq('user_id', userId)
      .maybeSingle()
    const sess = sessResp.data as null | { id: string; cards_reviewed: number; correct_count: number; xp_earned: number }
    if (sess) {
      await db.from('learning_sessions').update({
        cards_reviewed: sess.cards_reviewed + 1,
        correct_count: sess.correct_count + (correct ? 1 : 0),
        xp_earned: sess.xp_earned + xp,
      }).eq('id', sess.id)
    }
  }

  return NextResponse.json({
    cardId: card.id,
    rating: body.rating,
    xp,
    nextDueAt: next.dueAt,
    intervalDays: next.intervalDays,
    crown: stabilityToCrown(next.stability),
    newState: next.state,
    streakCount: newStreakCount,
  })
}

async function bumpStreak(db: { from: (t: string) => any }, userId: string, xp: number, correct: boolean) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const today = todayUTC()
  const resp = await db.from('daily_streaks').select('*').eq('user_id', userId).maybeSingle()
  const row = resp.data as null | {
    user_id: string
    current_streak: number
    longest_streak: number
    freezes_available: number
    last_review_date: string | null
    xp_today: number
    xp_total: number
  }

  if (!row) {
    await db.from('daily_streaks').insert([{
      user_id: userId,
      current_streak: 1,
      longest_streak: 1,
      freezes_available: 2,
      last_review_date: today,
      xp_today: xp,
      xp_total: xp,
    }])
    return
  }

  let streak = row.current_streak
  let freezes = row.freezes_available
  let xpToday = row.xp_today
  if (row.last_review_date === today) {
    xpToday += xp
  } else {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    if (row.last_review_date === yesterday) {
      streak = streak + 1
    } else if (row.last_review_date && freezes > 0) {
      // Apply a freeze for each missed day, up to freezes available.
      freezes = Math.max(0, freezes - 1)
    } else {
      streak = 1
    }
    xpToday = xp
  }
  const longest = Math.max(row.longest_streak, streak)

  await db.from('daily_streaks').update({
    current_streak: streak,
    longest_streak: longest,
    freezes_available: freezes,
    last_review_date: today,
    xp_today: xpToday,
    xp_total: row.xp_total + xp,
  }).eq('user_id', userId)
  void correct
}

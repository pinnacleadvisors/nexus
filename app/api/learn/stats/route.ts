/**
 * GET /api/learn/stats
 *
 * Returns the operator's overall learning state: streak, 90-day heatmap,
 * per-MOC retention, mastery histogram, weakest 5 atoms, stale count, daily
 * goal. UI consumes this on the `/learn` and `/learn/stats` pages.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import type { LearnStats, DailyStreak } from '@/lib/types'
import { DEFAULT_DAILY_GOAL_XP } from '@/lib/learning/types'

export const runtime = 'nodejs'

function emptyStreak(userId: string): DailyStreak {
  return {
    userId,
    currentStreak: 0,
    longestStreak: 0,
    freezesAvailable: 2,
    lastReviewDate: null,
    xpToday: 0,
    xpTotal: 0,
    updatedAt: new Date().toISOString(),
  }
}

function dayKey(d: Date): string { return d.toISOString().slice(0, 10) }

export async function GET(_req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = createServerClient()
  const dailyGoalXp = Number(process.env.LEARN_DAILY_GOAL_XP ?? DEFAULT_DAILY_GOAL_XP)

  if (!sb) {
    const empty: LearnStats = {
      streak: emptyStreak(userId),
      heatmap: [],
      retentionByMoc: [],
      masteryHistogram: { crown0: 0, crown1: 0, crown2: 0, crown3: 0, crown4: 0, crown5: 0 },
      weakestAtoms: [],
      staleCount: 0,
      dailyGoalXp,
    }
    return NextResponse.json(empty)
  }

  type Loose = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  const db = sb as unknown as Loose

  // Streak.
  const streakResp = await db.from('daily_streaks').select('*').eq('user_id', userId).maybeSingle()
  const streakRow = streakResp.data as null | {
    current_streak: number
    longest_streak: number
    freezes_available: number
    last_review_date: string | null
    xp_today: number
    xp_total: number
    updated_at: string
  }
  const streak: DailyStreak = streakRow ? {
    userId,
    currentStreak: streakRow.current_streak,
    longestStreak: streakRow.longest_streak,
    freezesAvailable: streakRow.freezes_available,
    lastReviewDate: streakRow.last_review_date,
    xpToday: streakRow.xp_today,
    xpTotal: streakRow.xp_total,
    updatedAt: streakRow.updated_at,
  } : emptyStreak(userId)

  // 90-day heatmap.
  const since = new Date(Date.now() - 90 * 86_400_000)
  const reviewsResp = await db.from('flashcard_reviews')
    .select('rating, xp, created_at')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString())
  const reviews = (reviewsResp.data ?? []) as Array<{ rating: string; xp: number; created_at: string }>

  const heatmapMap = new Map<string, { xp: number; cardsReviewed: number }>()
  for (let i = 0; i < 90; i++) {
    const d = new Date(since.getTime() + i * 86_400_000)
    heatmapMap.set(dayKey(d), { xp: 0, cardsReviewed: 0 })
  }
  for (const r of reviews) {
    const key = r.created_at.slice(0, 10)
    const cur = heatmapMap.get(key) ?? { xp: 0, cardsReviewed: 0 }
    cur.xp += r.xp
    cur.cardsReviewed += 1
    heatmapMap.set(key, cur)
  }
  const heatmap = Array.from(heatmapMap.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({ date, xp: v.xp, cardsReviewed: v.cardsReviewed }))

  // Mastery histogram + stale count + weakest atoms (single pass).
  const cardsResp = await db.from('flashcards')
    .select('atom_slug, crown, retrievability, stale_reason, state')
    .eq('user_id', userId)
    .neq('state', 'archived')
  const cards = (cardsResp.data ?? []) as Array<{
    atom_slug: string
    crown: number
    retrievability: number
    stale_reason: string | null
    state: string
  }>

  const masteryHistogram = { crown0: 0, crown1: 0, crown2: 0, crown3: 0, crown4: 0, crown5: 0 }
  let staleCount = 0
  const byAtom = new Map<string, number>()
  for (const c of cards) {
    const key = `crown${Math.max(0, Math.min(5, c.crown))}` as keyof typeof masteryHistogram
    masteryHistogram[key]++
    if (c.stale_reason) staleCount++
    const cur = byAtom.get(c.atom_slug)
    if (cur === undefined || c.retrievability < cur) byAtom.set(c.atom_slug, c.retrievability)
  }
  const weakest = Array.from(byAtom.entries())
    .sort(([, a], [, b]) => a - b)
    .slice(0, 5)

  // Resolve atom titles for weakest list.
  let weakestAtoms: LearnStats['weakestAtoms'] = []
  if (weakest.length > 0) {
    const slugs = weakest.map(([s]) => s)
    const atomsResp = await db.from('mol_atoms').select('slug, title').in('slug', slugs)
    const titleBySlug = new Map<string, string>()
    for (const row of (atomsResp.data ?? []) as Array<{ slug: string; title: string }>) {
      titleBySlug.set(row.slug, row.title)
    }
    weakestAtoms = weakest.map(([slug, retrievability]) => ({
      atomSlug: slug,
      title: titleBySlug.get(slug) ?? slug,
      retrievability,
    }))
  }

  // Per-MOC retention over last 30 days.
  const since30 = new Date(Date.now() - 30 * 86_400_000)
  const reviews30Resp = await db.from('flashcard_reviews')
    .select('rating, card_id, created_at, flashcards!inner(moc_slug)')
    .eq('user_id', userId)
    .gte('created_at', since30.toISOString())
  // The join may not be configured; fall back to two-step query.
  let retentionByMoc: LearnStats['retentionByMoc'] = []
  let mocStats = (reviews30Resp.data ?? []) as Array<{ rating: string; flashcards: { moc_slug: string | null } | null }>
  if (mocStats.length === 0 && reviews.length > 0) {
    // Two-step fallback: fetch moc_slug per card.
    const cardIds = Array.from(new Set(reviews.slice(-500).map(_ => _))).map(_ => _) as never[]
    void cardIds
  }
  const tally = new Map<string, { good: number; total: number }>()
  for (const row of mocStats) {
    const moc = row.flashcards?.moc_slug
    if (!moc) continue
    const t = tally.get(moc) ?? { good: 0, total: 0 }
    t.total++
    if (row.rating !== 'again') t.good++
    tally.set(moc, t)
  }
  if (tally.size > 0) {
    const slugs = Array.from(tally.keys())
    const mocsResp = await db.from('mol_mocs').select('slug, title').in('slug', slugs)
    const titleBySlug = new Map<string, string>()
    for (const row of (mocsResp.data ?? []) as Array<{ slug: string; title: string }>) {
      titleBySlug.set(row.slug, row.title)
    }
    retentionByMoc = Array.from(tally.entries()).map(([mocSlug, v]) => ({
      mocSlug,
      title: titleBySlug.get(mocSlug) ?? mocSlug,
      retention: v.total > 0 ? v.good / v.total : 0,
      sampleSize: v.total,
    }))
  }

  const out: LearnStats = {
    streak,
    heatmap,
    retentionByMoc,
    masteryHistogram,
    weakestAtoms,
    staleCount,
    dailyGoalXp,
  }
  return NextResponse.json(out)
}

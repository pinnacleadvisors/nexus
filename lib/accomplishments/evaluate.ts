/**
 * lib/accomplishments/evaluate.ts — compares the operator's real revenue +
 * business/niche counts against the static tier catalog and derives the
 * unlocked/locked split, operator level, and the closest next tier.
 *
 * Pure read-model — no writes, no unlock table (v1 computes live from current
 * revenue; the idempotent unlock-persistence + one-time milestone notification
 * is a migration-gated follow-up). Fail-soft via getAllTimeRevenue.
 */

import { ACHIEVEMENTS, LIVE_EVENT_LEVEL, type Achievement } from './catalog'
import { getAllTimeRevenue } from './revenue'

export interface EvaluatedAchievement extends Achievement {
  /** Current real value for this tier's kind (count or USD). */
  current:  number
  unlocked: boolean
  /** 0..1 toward the threshold (1 when unlocked). */
  progress: number
}

export interface AccomplishmentsState {
  achievements:     EvaluatedAchievement[]
  unlocked:         EvaluatedAchievement[]
  locked:           EvaluatedAchievement[]
  operatorLevel:    number
  /** The locked tier closest to unlocking (highest progress), or null. */
  nextTier:         EvaluatedAchievement | null
  liveEventLevel:   number
  liveEventUnlocked: boolean
  combinedRevenue:  number
  businessCount:    number
  nicheCount:       number
}

export async function evaluate(userId: string): Promise<AccomplishmentsState> {
  const { revenue, businessCount, nicheCount } = await getAllTimeRevenue(userId)

  const evaluated: EvaluatedAchievement[] = ACHIEVEMENTS.map(a => {
    const current  = a.kind === 'business' ? businessCount
                   : a.kind === 'niche'    ? nicheCount
                   : revenue.combined
    const unlocked = current >= a.threshold
    const progress = a.threshold > 0 ? Math.min(1, current / a.threshold) : (unlocked ? 1 : 0)
    return { ...a, current, unlocked, progress }
  })

  const unlocked = evaluated.filter(a => a.unlocked)
  const locked   = evaluated.filter(a => !a.unlocked)
  const operatorLevel = unlocked.reduce((max, a) => Math.max(max, a.level), 0)
  // Closest next tier = the locked one furthest along (largest progress).
  const nextTier = locked.length > 0
    ? locked.slice().sort((a, b) => b.progress - a.progress)[0]
    : null

  return {
    achievements:      evaluated,
    unlocked,
    locked,
    operatorLevel,
    nextTier,
    liveEventLevel:    LIVE_EVENT_LEVEL,
    liveEventUnlocked: operatorLevel >= LIVE_EVENT_LEVEL,
    combinedRevenue:   revenue.combined,
    businessCount,
    nicheCount,
  }
}

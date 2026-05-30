/**
 * lib/accomplishments/catalog.ts — the static achievement tier catalog.
 *
 * Pure data. Accomplishments is a READ-MODEL over the dashboard's existing
 * revenue truth (experiment_metrics kind='revenue') + the operator's business /
 * niche counts — it builds ZERO new engines and writes nothing. Each tier is
 * evaluated live against real numbers in lib/accomplishments/evaluate.ts.
 *
 * `level` is the operator level this tier confers when unlocked; the page
 * surfaces max(level) across unlocked tiers + gates a "live event" hook on it.
 */

export type AchievementKind = 'business' | 'niche' | 'revenue'

export interface Achievement {
  id:          string
  label:       string
  description: string
  /** What the threshold counts: business count, distinct-niche count, or
   *  all-time combined revenue in USD. */
  kind:        AchievementKind
  threshold:   number
  /** Operator level conferred when this tier unlocks. */
  level:       number
}

export const ACHIEVEMENTS: Achievement[] = [
  // Milestones — getting off the ground.
  { id: 'first_business',  label: 'First Business', description: 'Launch your first business',        kind: 'business', threshold: 1,       level: 1 },
  { id: 'three_businesses', label: 'Portfolio',     description: 'Run three businesses at once',        kind: 'business', threshold: 3,       level: 3 },
  { id: 'first_niche',     label: 'Niche Pioneer',  description: 'Operate in your first niche',         kind: 'niche',    threshold: 1,       level: 1 },
  { id: 'three_niches',    label: 'Diversified',    description: 'Operate across three niches',         kind: 'niche',    threshold: 3,       level: 4 },
  // Combined-revenue ladder — the real signal.
  { id: 'rev_100',         label: 'First $100',     description: 'Earn $100 across all businesses',     kind: 'revenue',  threshold: 100,     level: 1 },
  { id: 'rev_1k',          label: 'First $1K',      description: 'Earn $1,000 across all businesses',   kind: 'revenue',  threshold: 1_000,   level: 2 },
  { id: 'rev_10k',         label: 'Five Figures',   description: 'Earn $10,000 across all businesses',  kind: 'revenue',  threshold: 10_000,  level: 5 },
  { id: 'rev_100k',        label: 'Six Figures',    description: 'Earn $100,000 across all businesses', kind: 'revenue',  threshold: 100_000, level: 7 },
]

/** The operator level the "live event" unlocks at — referenced by the page's
 *  level-gated hook. Kept here so the gate is one constant, not a magic number. */
export const LIVE_EVENT_LEVEL = 5

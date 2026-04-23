/**
 * lib/swarm/PlanBank.ts — A8
 *
 * Goal-level decomposition memory. Complements ReasoningBank (which stores
 * per-task outcomes) by persisting the entire SwarmPlan that shipped to `done`.
 * strategicDecompose queries the bank before asking Claude, and includes the
 * shortest matching plan as a few-shot example.
 *
 * Similarity is computed via keyword overlap (Jaccard on stemmed tokens) rather
 * than embeddings so we stay dependency-free and work offline. It is weaker
 * than vector search but good enough to nudge the Queen toward reuse.
 */

import { createServerClient } from '@/lib/supabase'
import { extractKeywords } from './GraphRetriever'
import type { SwarmPlan } from './Queen'

export interface PlanPattern {
  id:           string
  goal:         string
  goalKeywords: string
  plan:         SwarmPlan
  phaseCount:   number
  taskCount:    number
  outcomeScore: number
  createdAt:    string
}

interface PlanRow {
  id:              string
  user_id:         string
  goal:            string
  goal_keywords:   string
  plan:            SwarmPlan
  phase_count:     number
  task_count:      number
  outcome_score:   number
  token_cost_usd:  number
  created_at:      string
}

function rowToPattern(r: PlanRow): PlanPattern {
  return {
    id:           r.id,
    goal:         r.goal,
    goalKeywords: r.goal_keywords,
    plan:         r.plan,
    phaseCount:   r.phase_count,
    taskCount:    r.task_count,
    outcomeScore: r.outcome_score,
    createdAt:    r.created_at,
  }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/** Store a successful plan so strategicDecompose can reuse it next time. */
export async function storePlan(input: {
  userId:         string
  runId?:         string
  goal:           string
  plan:           SwarmPlan
  outcomeScore?:  number
  tokenCostUsd?:  number
}): Promise<void> {
  const db = createServerClient()
  if (!db) return

  const keywords = extractKeywords(input.goal).join(' ')
  const taskCount = input.plan.phases.reduce((sum, p) => sum + (p.tasks?.length ?? 0), 0)

  await (db.from('plan_patterns' as never) as unknown as {
    insert: (rec: unknown) => Promise<{ error: { message: string } | null }>
  }).insert({
    user_id:        input.userId,
    run_id:         input.runId ?? null,
    goal:           input.goal.slice(0, 2000),
    goal_keywords:  keywords,
    plan:           input.plan,
    phase_count:    input.plan.phases.length,
    task_count:     taskCount,
    outcome_score:  input.outcomeScore ?? 0.5,
    token_cost_usd: input.tokenCostUsd  ?? 0,
  })
}

/** Find the top-k most similar prior plans by keyword overlap. */
export async function findSimilarPlans(
  userId: string,
  goal:   string,
  k = 3,
): Promise<PlanPattern[]> {
  const db = createServerClient()
  if (!db) return []

  const goalKeys = new Set(extractKeywords(goal))
  if (goalKeys.size === 0) return []

  // Pull candidates — cap at 100 recent outcomes to keep the in-memory rank cheap
  const { data } = await (db.from('plan_patterns' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, o: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: PlanRow[] | null }>
        }
      }
    }
  }).select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100)

  if (!data || data.length === 0) return []

  const ranked = data
    .map(r => {
      const rowKeys = new Set(r.goal_keywords.split(/\s+/).filter(Boolean))
      const sim = jaccard(goalKeys, rowKeys)
      // Combine similarity with outcome score — a great plan on a so-so match
      // beats an adequate plan on a perfect match, mildly.
      const combined = sim * 0.7 + (r.outcome_score ?? 0.5) * 0.3
      return { row: r, sim, combined }
    })
    .filter(x => x.sim > 0.15)  // Jaccard threshold — below this, not worth surfacing
    .sort((a, b) => b.combined - a.combined)
    .slice(0, k)
    .map(x => rowToPattern(x.row))

  return ranked
}

/**
 * Build a compact few-shot block suitable for injecting into the Queen prompt.
 * Returns empty string when there is no viable prior plan.
 */
export function formatPlanAsFewShot(pattern: PlanPattern): string {
  const shortest = pattern.plan.phases.slice(0, 3).map(p => ({
    phase:     p.phase,
    title:     p.title,
    rationale: (p.rationale ?? '').slice(0, 120),
    tasks:     (p.tasks ?? []).slice(0, 2).map(t => ({
      title:       (t.title ?? '').slice(0, 60),
      description: (t.description ?? '').slice(0, 200),
      role:        t.role,
    })),
  }))
  return [
    `## Prior successful decomposition (few-shot example)`,
    `Goal: ${pattern.goal.slice(0, 200)}`,
    `Outcome score: ${pattern.outcomeScore.toFixed(2)} — use this as inspiration, not a template.`,
    '',
    '```json',
    JSON.stringify({ summary: pattern.plan.summary?.slice(0, 240) ?? '', phases: shortest }, null, 2),
    '```',
  ].join('\n')
}

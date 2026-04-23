/**
 * lib/runs/metric-triggers.ts — A9
 *
 * Detects perf / outcome regressions across recent runs and enqueues
 * workflow_feedback rows so the existing `workflow-optimizer` managed agent
 * picks them up and proposes fixes. Deliberately stateless and idempotent —
 * safe to run on any cadence.
 *
 * Inputs:
 *   - runs               (phase, status, metrics)
 *   - run_events         (kind='dispatch.completed' → agent attribution)
 *   - token_events       (cost_usd, model)
 *   - workflow_feedback  (dedupe against open rows)
 *
 * Emits one workflow_feedback row per (agentSlug, metric) tuple, capped at 5
 * open rows per agent to avoid spamming the optimiser when an agent is broken.
 */

import { createServerClient } from '@/lib/supabase'

export interface DriftSignal {
  agentSlug:  string
  metric:     'review-rejects' | 'token-cost' | 'failure-rate'
  value:      number
  threshold:  number
  sampleSize: number
}

const REVIEW_REJECT_THRESHOLD = 3   // ≥ 3 review rejections in the window → flag
const TOKEN_COST_P95_USD      = 1.5 // p95 cost per run above this is a flag
const FAILURE_RATE_THRESHOLD  = 0.5 // ≥ 50% dispatch failures → flag
const LOOKBACK_RUNS           = 20
const MAX_OPEN_PER_AGENT      = 5

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * sorted.length)))
  return sorted[idx]
}

/**
 * Detect drift signals across the most recent LOOKBACK_RUNS per user. Pure
 * function — returns the signals it would file but does not write anything.
 */
export async function detectDrift(userId: string): Promise<DriftSignal[]> {
  const db = createServerClient()
  if (!db) return []

  // Pull the user's recent runs and their dispatch.completed events to join
  // agent attribution.
  const { data: runs } = await (db.from('runs' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, o: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: Array<{ id: string; status: string; metrics: Record<string, unknown> }> | null }>
        }
      }
    }
  }).select('id,status,metrics').eq('user_id', userId).order('updated_at', { ascending: false }).limit(LOOKBACK_RUNS)

  if (!runs || runs.length === 0) return []
  const runIds = runs.map(r => r.id)

  // Pull dispatch events in one query
  const { data: events } = await (db.from('run_events' as never) as unknown as {
    select: (cols: string) => {
      in: (c: string, v: readonly string[]) => {
        eq: (c: string, v: string) => Promise<{ data: Array<{ run_id: string; payload: Record<string, unknown> }> | null }>
      }
    }
  }).select('run_id,payload').in('run_id', runIds).eq('kind', 'dispatch.completed')

  // Aggregate per agent
  type AgentAgg = { costs: number[]; total: number; failed: number }
  const byAgent = new Map<string, AgentAgg>()
  for (const ev of events ?? []) {
    const slug = typeof ev.payload?.agentSlug === 'string' ? ev.payload.agentSlug : null
    if (!slug) continue
    const agg = byAgent.get(slug) ?? { costs: [], total: 0, failed: 0 }
    agg.total += 1
    const status = ev.payload?.status
    if (status === 'failed') agg.failed += 1
    byAgent.set(slug, agg)
  }

  // Join token_events for costs
  const { data: tokens } = await (db.from('token_events' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, o: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: Array<{ cost_usd: number | null; model: string | null }> | null }>
        }
      }
    }
  }).select('cost_usd,model').eq('user_id', userId).order('created_at', { ascending: false }).limit(500)

  // Crude attribution: per-model p95 cost is the best we can do without per-
  // dispatch cost tagging. The optimiser gets a generic "model X is expensive"
  // signal which it can escalate into per-agent prompt-caching guidance.
  const costsByModel = new Map<string, number[]>()
  for (const t of tokens ?? []) {
    if (t.cost_usd == null || !t.model) continue
    const arr = costsByModel.get(t.model) ?? []
    arr.push(t.cost_usd)
    costsByModel.set(t.model, arr)
  }

  const signals: DriftSignal[] = []

  for (const [slug, agg] of byAgent) {
    if (agg.total === 0) continue
    const failRate = agg.failed / agg.total
    if (failRate >= FAILURE_RATE_THRESHOLD && agg.total >= 3) {
      signals.push({
        agentSlug:  slug,
        metric:     'failure-rate',
        value:      failRate,
        threshold:  FAILURE_RATE_THRESHOLD,
        sampleSize: agg.total,
      })
    }
  }

  // Review rejections count across the whole run set
  let reviewRejects = 0
  for (const r of runs) {
    const m = r.metrics ?? {}
    const rr = typeof (m as { reviewRejects?: number }).reviewRejects === 'number' ? (m as { reviewRejects?: number }).reviewRejects! : 0
    reviewRejects += rr
  }
  if (reviewRejects >= REVIEW_REJECT_THRESHOLD && byAgent.size > 0) {
    // No clean per-agent attribution without more wiring — file against the
    // most-dispatched agent in the window, which is usually the culprit.
    const mostUsed = [...byAgent.entries()].sort((a, b) => b[1].total - a[1].total)[0]
    signals.push({
      agentSlug:  mostUsed[0],
      metric:     'review-rejects',
      value:      reviewRejects,
      threshold:  REVIEW_REJECT_THRESHOLD,
      sampleSize: runs.length,
    })
  }

  // Expensive model → attribute to most-used agent on that model
  for (const [model, costs] of costsByModel) {
    if (costs.length < 5) continue
    const sorted = [...costs].sort((a, b) => a - b)
    const p95 = percentile(sorted, 0.95)
    if (p95 >= TOKEN_COST_P95_USD && byAgent.size > 0) {
      const mostUsed = [...byAgent.entries()].sort((a, b) => b[1].total - a[1].total)[0]
      signals.push({
        agentSlug:  mostUsed[0],
        metric:     'token-cost',
        value:      p95,
        threshold:  TOKEN_COST_P95_USD,
        sampleSize: costs.length,
      })
      // Only emit one cost signal per sweep — otherwise every model triggers a
      // row and the optimiser drowns.
      break
    }
  }

  return signals
}

/**
 * File drift signals as workflow_feedback rows. Deduplicates against open rows
 * for the same (agentSlug, metric) so a persistent regression doesn't spam.
 * Returns the count of newly-filed rows.
 */
export async function fileSignals(userId: string, signals: DriftSignal[]): Promise<number> {
  const db = createServerClient()
  if (!db || signals.length === 0) return 0

  // Count existing open rows per agent to enforce the 5-per-agent cap
  const agentSlugs = [...new Set(signals.map(s => s.agentSlug))]
  const { data: existing } = await (db.from('workflow_feedback' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => {
          in: (c: string, v: readonly string[]) => Promise<{ data: Array<{ agent_slug: string; feedback: string }> | null }>
        }
      }
    }
  }).select('agent_slug,feedback').eq('user_id', userId).eq('status', 'open').in('agent_slug', agentSlugs)

  const openByAgent = new Map<string, number>()
  const openKeys    = new Set<string>()
  for (const row of existing ?? []) {
    openByAgent.set(row.agent_slug, (openByAgent.get(row.agent_slug) ?? 0) + 1)
    openKeys.add(`${row.agent_slug}::${row.feedback.split(':')[0]}`)
  }

  let filed = 0
  for (const s of signals) {
    const openCount = openByAgent.get(s.agentSlug) ?? 0
    if (openCount >= MAX_OPEN_PER_AGENT) continue
    const key = `${s.agentSlug}::metric-drift`
    if (openKeys.has(key)) continue

    const feedback = `metric-drift: ${s.metric}=${s.value.toFixed(3)} (threshold ${s.threshold}, n=${s.sampleSize})`
    const { error } = await (db.from('workflow_feedback' as never) as unknown as {
      insert: (rec: unknown) => Promise<{ error: { message: string } | null }>
    }).insert({
      user_id:    userId,
      agent_slug: s.agentSlug,
      feedback,
      status:     'open',
    })
    if (!error) {
      filed += 1
      openByAgent.set(s.agentSlug, openCount + 1)
      openKeys.add(key)
    }
  }
  return filed
}

/** Convenience: detect + file in one call. */
export async function runMetricOptimiser(userId: string): Promise<{ detected: number; filed: number }> {
  const signals = await detectDrift(userId)
  const filed   = await fileSignals(userId, signals)
  return { detected: signals.length, filed }
}

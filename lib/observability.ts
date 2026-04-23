/**
 * lib/observability.ts — C1
 *
 * Writes per-task metric samples after every swarm task executes, and
 * aggregates them for dashboard + regression-detector consumers. Keyed on
 * (agent_slug, kind, at) so the hot queries ("last-24h vs last-7d p50/p95
 * per agent") hit an index without aggregating the whole history.
 *
 * Writes are fire-and-forget — observability should never block a user-visible
 * path. Callers should not await unless they need the ID.
 */

import { createServerClient } from '@/lib/supabase'

export type MetricKind =
  | 'input_tokens'
  | 'output_tokens'
  | 'cache_hit_ratio'
  | 'latency_ms'
  | 'review_outcome'        // 1.0 approved, 0.0 rejected — averaged gives approve-rate
  | 'cost_usd'

export interface MetricSampleInput {
  userId:     string
  agentSlug:  string
  kind:       MetricKind
  value:      number
  runId?:     string
  at?:        string
}

/** Fire-and-forget write. Returns immediately; DB errors are logged. */
export function recordSample(input: MetricSampleInput): void {
  const db = createServerClient()
  if (!db) return
  Promise.resolve().then(async () => {
    try {
      await (db.from('metric_samples' as never) as unknown as {
        insert: (rec: unknown) => Promise<{ error: { message: string } | null }>
      }).insert({
        user_id:    input.userId,
        agent_slug: input.agentSlug,
        kind:       input.kind,
        value:      input.value,
        run_id:     input.runId ?? null,
        at:         input.at ?? new Date().toISOString(),
      })
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[observability] recordSample failed:', err)
      }
    }
  })
}

/** Batch variant — collapses N inserts into a single round trip. */
export function recordSamples(samples: MetricSampleInput[]): void {
  if (samples.length === 0) return
  const db = createServerClient()
  if (!db) return
  const rows = samples.map(s => ({
    user_id:    s.userId,
    agent_slug: s.agentSlug,
    kind:       s.kind,
    value:      s.value,
    run_id:     s.runId ?? null,
    at:         s.at ?? new Date().toISOString(),
  }))
  Promise.resolve().then(async () => {
    try {
      await (db.from('metric_samples' as never) as unknown as {
        insert: (rec: unknown) => Promise<{ error: { message: string } | null }>
      }).insert(rows)
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[observability] recordSamples failed:', err)
      }
    }
  })
}

// ── Read-side helpers ───────────────────────────────────────────────────────

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.max(0, Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length)))
  return sortedAsc[idx]
}

export interface AgentStats {
  agentSlug:   string
  sampleCount: number
  tokensP50:   number
  tokensP95:   number
  latencyP50Ms: number
  latencyP95Ms: number
  cacheHitRatio: number
  approveRate:  number
  costP50Usd:   number
}

interface SampleRow {
  agent_slug: string
  kind:       MetricKind
  value:      number
}

/**
 * Compute AgentStats over a time window. Pass `windowHours` to limit the scan
 * (default 168 = 7 days).
 */
export async function getAgentStats(userId: string, opts: { windowHours?: number; agentSlug?: string } = {}): Promise<AgentStats[]> {
  const db = createServerClient()
  if (!db) return []
  const window = opts.windowHours ?? 168
  const cutoff = new Date(Date.now() - window * 3600_000).toISOString()

  type Q = {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        gte: (c: string, v: string) => {
          eq?: (c: string, v: string) => Promise<{ data: SampleRow[] | null }>
        } & Promise<{ data: SampleRow[] | null }>
      }
    }
  }
  const q = (db.from('metric_samples' as never) as unknown as Q)
    .select('agent_slug,kind,value')
    .eq('user_id', userId)
    .gte('at', cutoff)

  const res = opts.agentSlug && q.eq
    ? await q.eq('agent_slug', opts.agentSlug)
    : await q

  const rows = res.data ?? []

  // Group by agent
  const byAgent = new Map<string, Record<MetricKind, number[]>>()
  for (const r of rows) {
    let slot = byAgent.get(r.agent_slug)
    if (!slot) {
      slot = { input_tokens: [], output_tokens: [], cache_hit_ratio: [], latency_ms: [], review_outcome: [], cost_usd: [] }
      byAgent.set(r.agent_slug, slot)
    }
    slot[r.kind].push(r.value)
  }

  const out: AgentStats[] = []
  for (const [agentSlug, series] of byAgent) {
    const tokens  = [...series.input_tokens, ...series.output_tokens].sort((a, b) => a - b)
    const latency = [...series.latency_ms].sort((a, b) => a - b)
    const cost    = [...series.cost_usd].sort((a, b) => a - b)
    const cacheAvg   = series.cache_hit_ratio.length > 0
      ? series.cache_hit_ratio.reduce((s, v) => s + v, 0) / series.cache_hit_ratio.length
      : 0
    const approveAvg = series.review_outcome.length > 0
      ? series.review_outcome.reduce((s, v) => s + v, 0) / series.review_outcome.length
      : 0
    out.push({
      agentSlug,
      sampleCount:   series.input_tokens.length + series.output_tokens.length + series.latency_ms.length,
      tokensP50:     percentile(tokens,  0.5),
      tokensP95:     percentile(tokens,  0.95),
      latencyP50Ms:  percentile(latency, 0.5),
      latencyP95Ms:  percentile(latency, 0.95),
      cacheHitRatio: cacheAvg,
      approveRate:   approveAvg,
      costP50Usd:    percentile(cost, 0.5),
    })
  }
  return out
}

/**
 * Top-N worst offenders ranked by a composite score of high cost + high
 * latency + low approve rate. Used by the Dashboard widget.
 */
export async function getWorstOffenders(userId: string, n = 5, windowHours = 168): Promise<AgentStats[]> {
  const stats = await getAgentStats(userId, { windowHours })
  return stats
    .filter(s => s.sampleCount >= 3)
    .map(s => ({ ...s, score: s.latencyP95Ms / 1000 + s.costP50Usd * 10 + (1 - s.approveRate) * 5 }))
    .sort((a, b) => (b as AgentStats & { score: number }).score - (a as AgentStats & { score: number }).score)
    .slice(0, n)
    .map(({ score: _score, ...rest }) => rest as AgentStats)
}

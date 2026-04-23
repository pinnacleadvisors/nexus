/**
 * lib/observability/regression.ts — C2
 *
 * Compares each agent's last-24h metrics against its 7-day baseline (baseline
 * excludes the last 24h so a single bad day does not mask itself). Flags any
 * agent whose p95 latency_ms OR p50 cost_usd regressed by more than 25%, or
 * whose approve rate dropped by more than 25 percentage points. Each flag is
 * filed as a `workflow_feedback` row (`status=open`) so the existing
 * `workflow-optimizer` managed agent picks it up through its normal queue.
 *
 * Dedupes against open rows to avoid spamming when a regression persists.
 */

import { createServerClient } from '@/lib/supabase'

export interface RegressionSignal {
  agentSlug:   string
  metric:      'latency-p95' | 'cost-p50' | 'approve-rate'
  baseline:    number
  current:     number
  deltaPct:    number          // signed — positive = worse for latency/cost, negative = worse for approve
  sampleSizeBaseline: number
  sampleSizeCurrent:  number
}

const REGRESSION_PCT       = 0.25   // 25% worsening triggers a flag
const APPROVE_DROP_PP      = 0.25   // 25 percentage points drop
const MIN_SAMPLES          = 5
const MAX_OPEN_PER_AGENT   = 5

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.max(0, Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length)))
  return sortedAsc[idx]
}

interface Row { agent_slug: string; kind: string; value: number; at: string }

export async function detectRegressions(userId: string): Promise<RegressionSignal[]> {
  const db = createServerClient()
  if (!db) return []

  const now        = Date.now()
  const baselineStart = new Date(now - 7 * 86_400_000).toISOString()
  const currentStart  = new Date(now - 1 * 86_400_000).toISOString()

  const { data } = await (db.from('metric_samples' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        gte: (c: string, v: string) => Promise<{ data: Row[] | null }>
      }
    }
  }).select('agent_slug,kind,value,at').eq('user_id', userId).gte('at', baselineStart)

  const rows = data ?? []
  if (rows.length === 0) return []

  // Group: agentSlug → { baseline: {kind: number[]}, current: {kind: number[]} }
  type Bucket = { latency_ms: number[]; cost_usd: number[]; review_outcome: number[] }
  const empty = (): Bucket => ({ latency_ms: [], cost_usd: [], review_outcome: [] })
  const agents = new Map<string, { baseline: Bucket; current: Bucket }>()

  for (const r of rows) {
    if (!['latency_ms','cost_usd','review_outcome'].includes(r.kind)) continue
    let slot = agents.get(r.agent_slug)
    if (!slot) {
      slot = { baseline: empty(), current: empty() }
      agents.set(r.agent_slug, slot)
    }
    const bucket = r.at >= currentStart ? slot.current : slot.baseline
    bucket[r.kind as keyof Bucket].push(r.value)
  }

  const out: RegressionSignal[] = []

  for (const [agentSlug, { baseline, current }] of agents) {
    // Latency p95
    if (baseline.latency_ms.length >= MIN_SAMPLES && current.latency_ms.length >= MIN_SAMPLES) {
      const basePct = percentile([...baseline.latency_ms].sort((a, b) => a - b), 0.95)
      const curPct  = percentile([...current.latency_ms] .sort((a, b) => a - b), 0.95)
      if (basePct > 0 && (curPct - basePct) / basePct > REGRESSION_PCT) {
        out.push({
          agentSlug,
          metric:            'latency-p95',
          baseline:          basePct,
          current:           curPct,
          deltaPct:          (curPct - basePct) / basePct,
          sampleSizeBaseline: baseline.latency_ms.length,
          sampleSizeCurrent:  current.latency_ms.length,
        })
      }
    }

    // Cost p50
    if (baseline.cost_usd.length >= MIN_SAMPLES && current.cost_usd.length >= MIN_SAMPLES) {
      const basePct = percentile([...baseline.cost_usd].sort((a, b) => a - b), 0.5)
      const curPct  = percentile([...current.cost_usd] .sort((a, b) => a - b), 0.5)
      if (basePct > 0 && (curPct - basePct) / basePct > REGRESSION_PCT) {
        out.push({
          agentSlug,
          metric:            'cost-p50',
          baseline:          basePct,
          current:           curPct,
          deltaPct:          (curPct - basePct) / basePct,
          sampleSizeBaseline: baseline.cost_usd.length,
          sampleSizeCurrent:  current.cost_usd.length,
        })
      }
    }

    // Approve-rate drop (percentage-point delta, not %)
    if (baseline.review_outcome.length >= MIN_SAMPLES && current.review_outcome.length >= MIN_SAMPLES) {
      const baseApprove = baseline.review_outcome.reduce((s, v) => s + v, 0) / baseline.review_outcome.length
      const curApprove  = current .review_outcome.reduce((s, v) => s + v, 0) / current .review_outcome.length
      if (baseApprove - curApprove > APPROVE_DROP_PP) {
        out.push({
          agentSlug,
          metric:            'approve-rate',
          baseline:          baseApprove,
          current:           curApprove,
          deltaPct:          -(baseApprove - curApprove),    // negative = worse
          sampleSizeBaseline: baseline.review_outcome.length,
          sampleSizeCurrent:  current.review_outcome.length,
        })
      }
    }
  }

  return out
}

export async function fileRegressions(userId: string, regressions: RegressionSignal[]): Promise<number> {
  const db = createServerClient()
  if (!db || regressions.length === 0) return 0

  const slugs = [...new Set(regressions.map(r => r.agentSlug))]
  const { data: existing } = await (db.from('workflow_feedback' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => {
          in: (c: string, v: readonly string[]) => Promise<{ data: Array<{ agent_slug: string; feedback: string }> | null }>
        }
      }
    }
  }).select('agent_slug,feedback').eq('user_id', userId).eq('status', 'open').in('agent_slug', slugs)

  const openByAgent = new Map<string, number>()
  const openKeys    = new Set<string>()
  for (const row of existing ?? []) {
    openByAgent.set(row.agent_slug, (openByAgent.get(row.agent_slug) ?? 0) + 1)
    // Feedback strings we file start with "perf-regression:" so the dedupe key
    // is (agent, metric name) — allows one open row per metric per agent.
    const m = row.feedback.match(/^perf-regression:\s*([a-z0-9-]+)=/i)
    if (m) openKeys.add(`${row.agent_slug}::${m[1]}`)
  }

  let filed = 0
  for (const s of regressions) {
    const openCount = openByAgent.get(s.agentSlug) ?? 0
    if (openCount >= MAX_OPEN_PER_AGENT) continue
    const key = `${s.agentSlug}::${s.metric}`
    if (openKeys.has(key)) continue

    const pct = (s.deltaPct * 100).toFixed(1)
    const feedback = `perf-regression: ${s.metric}=${pct}% (baseline ${s.baseline.toFixed(3)} → current ${s.current.toFixed(3)}, n_base=${s.sampleSizeBaseline}, n_cur=${s.sampleSizeCurrent})`

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

export async function runRegressionSweep(userId: string): Promise<{ detected: number; filed: number }> {
  const regressions = await detectRegressions(userId)
  const filed = await fileRegressions(userId, regressions)
  return { detected: regressions.length, filed }
}

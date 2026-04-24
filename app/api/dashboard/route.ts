import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { listRuns } from '@/lib/runs/controller'
import { REVENUE_DATA, KPI_DATA, AGENT_ROWS } from '@/lib/mock-data'
import type { AgentRow, RevenueDataPoint, KpiCard, DateRange } from '@/lib/types'

export const runtime = 'nodejs'

// ── Date range helpers ────────────────────────────────────────────────────────
function getRangeStart(range: DateRange): Date {
  const now = new Date()
  switch (range) {
    case '7d':  return new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000)
    case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    case '90d': return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    default:    return new Date(0)
  }
}

function bucketKey(range: DateRange, d: Date): string {
  // 7d → daily buckets, 30d/90d/all → monthly
  if (range === '7d') {
    return d.toLocaleString('default', { month: 'short', day: 'numeric' })
  }
  return d.toLocaleString('default', { month: 'short' })
}

function sliceMockRevenue(range: DateRange): RevenueDataPoint[] {
  switch (range) {
    case '7d':  return REVENUE_DATA.slice(-2)
    case '30d': return REVENUE_DATA.slice(-4)
    case '90d': return REVENUE_DATA.slice(-6)
    default:    return REVENUE_DATA
  }
}

// ── Row → AgentRow ───────────────────────────────────────────────────────────
interface AgentDbRow {
  id: string; name: string; status: string
  tasks_completed: number; tokens_used: number; cost_usd: number
  error_count: number; last_active: string
}

function toAgentRow(r: AgentDbRow): AgentRow {
  return {
    id:             r.id,
    name:           r.name,
    status:         r.status as AgentRow['status'],
    tasksCompleted: r.tasks_completed,
    tokensUsed:     r.tokens_used,
    costUsd:        Number(r.cost_usd),
    errorCount:     r.error_count,
    lastActive:     r.last_active,
  }
}

// ── Revenue / token bucketing ────────────────────────────────────────────────
function groupSeries(
  range:   DateRange,
  revenue: Array<{ amount_usd: number; created_at: string }>,
  costs:   Array<{ cost_usd: number; created_at: string }>,
): RevenueDataPoint[] {
  const buckets: Record<string, { revenue: number; cost: number; at: number }> = {}

  for (const r of revenue) {
    const d = new Date(r.created_at)
    const key = bucketKey(range, d)
    buckets[key] ??= { revenue: 0, cost: 0, at: d.getTime() }
    buckets[key].revenue += Number(r.amount_usd)
  }

  for (const c of costs) {
    const d = new Date(c.created_at)
    const key = bucketKey(range, d)
    buckets[key] ??= { revenue: 0, cost: 0, at: d.getTime() }
    buckets[key].cost += Number(c.cost_usd)
  }

  return Object.entries(buckets)
    .sort(([, a], [, b]) => a.at - b.at)
    .map(([month, v]) => ({
      month,
      revenue: Math.round(v.revenue * 100) / 100,
      cost:    Math.round(v.cost    * 100) / 100,
    }))
}

function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`
  return String(n)
}

function deltaPct(current: number, previous: number): number | undefined {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return undefined
  const pct = ((current - previous) / previous) * 100
  return Math.round(pct * 10) / 10
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const range = (req.nextUrl.searchParams.get('range') ?? '30d') as DateRange

  const db = createServerClient()

  // Supabase unconfigured → mock fallback so the page still renders.
  if (!db) {
    return NextResponse.json({
      agents: AGENT_ROWS,
      revenue: sliceMockRevenue(range),
      kpis: KPI_DATA,
      source: 'mock',
    })
  }

  try {
    const rangeStart = getRangeStart(range)
    const prevRangeStart = new Date(rangeStart.getTime() - (Date.now() - rangeStart.getTime()))
    const { userId } = await auth()

    // Fetch all observability sources in parallel. `runs` is read via the
    // controller to avoid the untyped `db.from('runs')` cast dance.
    const [agentsRes, revenueRes, tokenRes, prevTokenRes, userRuns] = await Promise.all([
      db.from('agents').select('*').order('cost_usd', { ascending: false }),

      db.from('revenue_events')
        .select('amount_usd, created_at')
        .gte('created_at', rangeStart.toISOString()),

      db.from('token_events')
        .select('agent_id, input_tokens, output_tokens, cost_usd, created_at')
        .gte('created_at', rangeStart.toISOString())
        .order('created_at', { ascending: false })
        .limit(5000),

      db.from('token_events')
        .select('cost_usd, input_tokens, output_tokens')
        .gte('created_at', prevRangeStart.toISOString())
        .lt('created_at', rangeStart.toISOString())
        .limit(5000),

      userId ? listRuns(userId, { limit: 200 }) : Promise.resolve([]),
    ])

    // Any hard query error (e.g. table missing) → fall back to mock so the page
    // still renders instead of erroring out the caller.
    if (agentsRes.error || revenueRes.error || tokenRes.error) {
      return NextResponse.json({
        agents: AGENT_ROWS,
        revenue: sliceMockRevenue(range),
        kpis: KPI_DATA,
        source: 'mock',
        error: (agentsRes.error ?? revenueRes.error ?? tokenRes.error)?.message,
      })
    }

    const agentsRaw  = (agentsRes.data ?? []) as AgentDbRow[]
    const revenueRaw = (revenueRes.data ?? []) as Array<{ amount_usd: number; created_at: string }>
    const tokenRaw   = (tokenRes.data ?? []) as Array<{ agent_id: string | null; input_tokens: number; output_tokens: number; cost_usd: number; created_at: string }>
    const prevTokenRaw = (prevTokenRes.data ?? []) as Array<{ cost_usd: number; input_tokens: number; output_tokens: number }>
    const runsRaw    = userRuns.filter(r => new Date(r.updatedAt).getTime() >= rangeStart.getTime())

    // Per-agent aggregation from token_events (authoritative — fed by every AI
    // call). Falls back to the roll-up columns on `agents` when token_events is
    // empty for an agent.
    const byAgent: Record<string, { tokens: number; cost: number; lastAt: number }> = {}
    for (const t of tokenRaw) {
      if (!t.agent_id) continue
      const key = t.agent_id
      byAgent[key] ??= { tokens: 0, cost: 0, lastAt: 0 }
      byAgent[key].tokens += (t.input_tokens ?? 0) + (t.output_tokens ?? 0)
      byAgent[key].cost   += Number(t.cost_usd ?? 0)
      const at = new Date(t.created_at).getTime()
      if (at > byAgent[key].lastAt) byAgent[key].lastAt = at
    }

    const agents: AgentRow[] = agentsRaw.map(row => {
      const agg = byAgent[row.id]
      const base = toAgentRow(row)
      if (!agg) return base
      return {
        ...base,
        // Prefer in-range aggregates from token_events so KPIs match the selected range.
        tokensUsed: agg.tokens || base.tokensUsed,
        costUsd:    agg.cost   || base.costUsd,
        lastActive: agg.lastAt ? new Date(agg.lastAt).toISOString() : base.lastActive,
      }
    })

    // Totals — derive from token_events first, then fall back to agent columns.
    const totalTokensFromEvents = tokenRaw.reduce((s, t) => s + (t.input_tokens ?? 0) + (t.output_tokens ?? 0), 0)
    const totalCostFromEvents   = tokenRaw.reduce((s, t) => s + Number(t.cost_usd ?? 0), 0)
    const totalTokens = totalTokensFromEvents || agents.reduce((s, a) => s + a.tokensUsed, 0)
    const totalCost   = totalCostFromEvents   || agents.reduce((s, a) => s + a.costUsd,    0)

    const totalRevenue = revenueRaw.reduce((s, e) => s + Number(e.amount_usd), 0)
    const netProfit    = totalRevenue - totalCost
    const activeAgents = agents.filter(a => a.status === 'active').length

    // Tasks done — prefer completed runs over the legacy `tasks_completed`
    // column which is only bumped by the Claude session dispatcher.
    const completedRuns = runsRaw.filter(r => r.status === 'done').length
    const totalTasks    = completedRuns || agents.reduce((s, a) => s + a.tasksCompleted, 0)

    const prevTotalCost = prevTokenRaw.reduce((s, t) => s + Number(t.cost_usd ?? 0), 0)
    const prevTotalTokens = prevTokenRaw.reduce((s, t) => s + (t.input_tokens ?? 0) + (t.output_tokens ?? 0), 0)

    const kpis: KpiCard[] = [
      {
        label: 'Total Revenue',
        value: `$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
        color: 'green',
      },
      {
        label: 'Total Cost',
        value: `$${totalCost.toFixed(2)}`,
        delta: deltaPct(totalCost, prevTotalCost),
        color: 'red',
      },
      {
        label: 'Net Profit',
        value: `$${netProfit.toFixed(2)}`,
        color: netProfit >= 0 ? 'green' : 'red',
      },
      {
        label: 'Active Agents',
        value: String(activeAgents),
        color: 'default',
      },
      {
        label: 'Tokens Used',
        value: formatTokens(totalTokens),
        delta: deltaPct(totalTokens, prevTotalTokens),
        color: 'default',
      },
      {
        label: 'Tasks Done',
        value: String(totalTasks),
        color: 'default',
      },
    ]

    const revenue = groupSeries(
      range,
      revenueRaw,
      tokenRaw.map(t => ({ cost_usd: Number(t.cost_usd ?? 0), created_at: t.created_at })),
    )

    return NextResponse.json({
      agents,
      revenue,
      kpis,
      source: 'supabase',
    })
  } catch (err) {
    // Any unexpected exception → mock fallback (keeps the page alive).
    return NextResponse.json({
      agents: AGENT_ROWS,
      revenue: sliceMockRevenue(range),
      kpis: KPI_DATA,
      source: 'mock',
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}

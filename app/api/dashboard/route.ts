import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
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

// Slice mock monthly data to approximate the date range for demo purposes
function sliceMockRevenue(range: DateRange): RevenueDataPoint[] {
  switch (range) {
    case '7d':  return REVENUE_DATA.slice(-2)
    case '30d': return REVENUE_DATA.slice(-4)
    case '90d': return REVENUE_DATA.slice(-6)
    default:    return REVENUE_DATA
  }
}

// ── Transform Supabase rows → app types ──────────────────────────────────────
function toAgentRow(r: {
  id: string; name: string; status: string
  tasks_completed: number; tokens_used: number; cost_usd: number
  error_count: number; last_active: string
}): AgentRow {
  return {
    id: r.id,
    name: r.name,
    status: r.status as AgentRow['status'],
    tasksCompleted: r.tasks_completed,
    tokensUsed: r.tokens_used,
    costUsd: Number(r.cost_usd),
    errorCount: r.error_count,
    lastActive: r.last_active,
  }
}

// Group raw revenue events into monthly buckets for the chart
function groupRevenueByMonth(
  events: Array<{ amount_usd: number; created_at: string }>,
  costs: number,
): RevenueDataPoint[] {
  const buckets: Record<string, number> = {}
  for (const e of events) {
    const label = new Date(e.created_at).toLocaleString('default', { month: 'short' })
    buckets[label] = (buckets[label] ?? 0) + Number(e.amount_usd)
  }
  return Object.entries(buckets).map(([month, revenue]) => ({
    month,
    revenue: Math.round(revenue),
    cost: costs, // simplified — cost is total agent cost divided across months
  }))
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const range = (req.nextUrl.searchParams.get('range') ?? '30d') as DateRange

  const db = createServerClient()

  if (db) {
    try {
      const rangeStart = getRangeStart(range)

      const [agentsRes, revenueRes] = await Promise.all([
        db.from('agents').select('*').order('cost_usd', { ascending: false }),
        db.from('revenue_events')
          .select('amount_usd, created_at')
          .gte('created_at', rangeStart.toISOString()),
      ])

      if (!agentsRes.error && !revenueRes.error && agentsRes.data.length > 0) {
        const agents: AgentRow[] = agentsRes.data.map(toAgentRow)
        const totalCost = agents.reduce((s, a) => s + a.costUsd, 0)
        const revenue = groupRevenueByMonth(revenueRes.data, totalCost / Math.max(1, agents.length))
        const totalRevenue = revenueRes.data.reduce((s, e) => s + Number(e.amount_usd), 0)
        const netProfit = totalRevenue - totalCost
        const activeAgents = agents.filter(a => a.status === 'active').length
        const totalTokens = agents.reduce((s, a) => s + a.tokensUsed, 0)
        const totalTasks = agents.reduce((s, a) => s + a.tasksCompleted, 0)

        const kpis: KpiCard[] = [
          { label: 'Total Revenue', value: `$${totalRevenue.toLocaleString()}`, color: 'green' },
          { label: 'Total Cost',    value: `$${totalCost.toFixed(0)}`,          color: 'red' },
          { label: 'Net Profit',    value: `$${netProfit.toFixed(0)}`,           color: 'purple' },
          { label: 'Active Agents', value: String(activeAgents),                 color: 'default' },
          { label: 'Tokens Used',   value: totalTokens >= 1e6 ? `${(totalTokens / 1e6).toFixed(1)}M` : `${(totalTokens / 1e3).toFixed(0)}k`, color: 'default' },
          { label: 'Tasks Done',    value: String(totalTasks),                   color: 'default' },
        ]

        return NextResponse.json({ agents, revenue, kpis, source: 'supabase' })
      }
    } catch {
      // Fall through to mock data
    }
  }

  // ── Mock data fallback ────────────────────────────────────────────────────
  return NextResponse.json({
    agents: AGENT_ROWS,
    revenue: sliceMockRevenue(range),
    kpis: KPI_DATA,
    source: 'mock',
  })
}

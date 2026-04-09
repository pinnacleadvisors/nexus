'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import KpiGrid from '@/components/dashboard/KpiGrid'
import AgentTable from '@/components/dashboard/AgentTable'
import DateRangeFilter from '@/components/dashboard/DateRangeFilter'
import AlertsPanel from '@/components/dashboard/AlertsPanel'
import { supabase } from '@/lib/supabase'
import type { AgentRow, RevenueDataPoint, KpiCard, DateRange } from '@/lib/types'
import { KPI_DATA, REVENUE_DATA, AGENT_ROWS } from '@/lib/mock-data'
import { Database, Wifi } from 'lucide-react'

// Recharts uses ResizeObserver / window — must not run during SSR
const RevenueChart = dynamic(() => import('@/components/dashboard/RevenueChart'), {
  ssr: false,
  loading: () => (
    <div
      className="rounded-xl"
      style={{ height: 324, backgroundColor: '#12121e', border: '1px solid #24243e' }}
    />
  ),
})

interface DashboardData {
  agents: AgentRow[]
  revenue: RevenueDataPoint[]
  kpis: KpiCard[]
  source: 'supabase' | 'mock'
}

export default function DashboardPage() {
  const [range, setRange]       = useState<DateRange>('30d')
  const [data, setData]         = useState<DashboardData>({
    agents: AGENT_ROWS,
    revenue: REVENUE_DATA,
    kpis: KPI_DATA,
    source: 'mock',
  })
  const [loading, setLoading]   = useState(false)
  const [showAlerts, setShowAlerts] = useState(false)

  const fetchData = useCallback(async (r: DateRange) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/dashboard?range=${r}`)
      if (res.ok) {
        const json = await res.json() as DashboardData
        setData(json)
      }
    } catch {
      // Keep existing data on error
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => { fetchData(range) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch when range changes
  function handleRangeChange(r: DateRange) {
    setRange(r)
    fetchData(r)
  }

  // ── Supabase Realtime subscription ─────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return // Supabase not configured

    const channel = supabase!
      .channel('agents-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agents' },
        payload => {
          const updated = payload.new as AgentRow | undefined
          if (!updated) return
          setData(prev => ({
            ...prev,
            agents: prev.agents.map(a =>
              a.id === (updated as { id: string }).id
                ? {
                    ...a,
                    status: (updated as { status: AgentRow['status'] }).status,
                    // @ts-expect-error -- DB row uses snake_case
                    tasksCompleted: updated.tasks_completed ?? a.tasksCompleted,
                    // @ts-expect-error -- DB row uses snake_case
                    tokensUsed: updated.tokens_used ?? a.tokensUsed,
                    // @ts-expect-error -- DB row uses snake_case
                    costUsd: Number(updated.cost_usd ?? a.costUsd),
                    // @ts-expect-error -- DB row uses snake_case
                    errorCount: updated.error_count ?? a.errorCount,
                    // @ts-expect-error -- DB row uses snake_case
                    lastActive: updated.last_active ?? a.lastActive,
                  }
                : a,
            ),
          }))
        },
      )
      .subscribe()

    return () => { supabase!.removeChannel(channel) }
  }, [])

  return (
    <div
      className="p-4 sm:p-6 space-y-4 sm:space-y-6 min-h-full"
      style={{ backgroundColor: '#050508' }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>
            Operations Dashboard
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-sm" style={{ color: '#9090b0' }}>
              Live performance across all agents and businesses
            </p>
            {/* Data source indicator */}
            <span
              className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={
                data.source === 'supabase'
                  ? { backgroundColor: '#0d2e0d', color: '#22c55e', border: '1px solid #22c55e33' }
                  : { backgroundColor: '#1a1a2e', color: '#55556a', border: '1px solid #24243e' }
              }
            >
              {data.source === 'supabase' ? (
                <><Wifi size={10} /> Live</>
              ) : (
                <><Database size={10} /> Demo data</>
              )}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangeFilter value={range} onChange={handleRangeChange} />
          <button
            onClick={() => setShowAlerts(a => !a)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors"
            style={
              showAlerts
                ? { backgroundColor: '#1a1a2e', color: '#f59e0b', border: '1px solid #f59e0b44' }
                : { backgroundColor: '#12121e', color: '#55556a', border: '1px solid #24243e' }
            }
          >
            🔔 Alerts
          </button>
          <button
            onClick={() => fetchData(range)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: '#12121e', color: '#6c63ff', border: '1px solid #24243e' }}
          >
            {loading ? '↻' : '↺'} Refresh
          </button>
        </div>
      </div>

      {/* ── KPI grid ────────────────────────────────────────────────────── */}
      <KpiGrid cards={data.kpis} />

      {/* ── Revenue chart ───────────────────────────────────────────────── */}
      <RevenueChart data={data.revenue} range={range} />

      {/* ── Agent table ─────────────────────────────────────────────────── */}
      <AgentTable agents={data.agents} />

      {/* ── Alerts panel (toggle) ───────────────────────────────────────── */}
      {showAlerts && <AlertsPanel />}
    </div>
  )
}

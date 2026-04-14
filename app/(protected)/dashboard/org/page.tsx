'use client'

import { useState, useEffect } from 'react'
import {
  GitBranch, Layers, Users, Zap, Loader2,
  RefreshCw, LayoutGrid, Network,
  AlertCircle, CheckCircle2, Clock,
  Coins, Cpu,
} from 'lucide-react'
import OrgTree from '@/components/org/OrgTree'
import DrillDownPanel from '@/components/org/DrillDownPanel'
import SwimlanesView from '@/components/org/SwimlanesView'
import type { OrgAgent, OrgTree as OrgTreeType, OrgStats, Swimlane, OrgViewMode } from '@/lib/org/types'
import { LAYER_META, STATUS_META } from '@/lib/org/types'

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  Icon, label, value, sub, color,
}: {
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>
  label: string
  value: string
  sub?: string
  color: string
}) {
  return (
    <div
      className="rounded-xl p-3 flex items-start gap-3"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
        style={{ backgroundColor: '#1a1a2e' }}
      >
        <Icon size={14} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-base font-bold leading-tight" style={{ color: '#e8e8f0' }}>{value}</p>
        <p className="text-xs mt-0.5" style={{ color: '#55556a' }}>{label}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color }}>{sub}</p>}
      </div>
    </div>
  )
}

// ── Layer breakdown bar ────────────────────────────────────────────────────────
function LayerBreakdown({ stats }: { stats: OrgStats }) {
  const layers = ([0, 1, 2, 3, 4] as const).filter(l => stats.byLayer[l] > 0)
  const total  = stats.total || 1
  return (
    <div
      className="rounded-xl p-3"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <p className="text-xs font-medium mb-2" style={{ color: '#55556a' }}>Agents by layer</p>
      <div className="flex gap-1 h-2 rounded-full overflow-hidden">
        {layers.map(l => (
          <div
            key={l}
            style={{
              flex: stats.byLayer[l] / total,
              backgroundColor: LAYER_META[l].color,
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {layers.map(l => (
          <span key={l} className="text-xs flex items-center gap-1" style={{ color: LAYER_META[l].color }}>
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: LAYER_META[l].color }} />
            {LAYER_META[l].shortLabel}: {stats.byLayer[l]}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Status summary ─────────────────────────────────────────────────────────────
function StatusSummary({ stats }: { stats: OrgStats }) {
  const items = [
    { key: 'running',   Icon: Loader2,      label: 'Running' },
    { key: 'idle',      Icon: Clock,        label: 'Idle' },
    { key: 'error',     Icon: AlertCircle,  label: 'Errors' },
    { key: 'completed', Icon: CheckCircle2, label: 'Done' },
  ] as const

  return (
    <div className="flex gap-2 flex-wrap">
      {items.map(({ key, Icon, label }) => {
        const count = stats.byStatus[key] ?? 0
        if (count === 0) return null
        const s = STATUS_META[key]
        return (
          <div
            key={key}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs"
            style={{ backgroundColor: s.bg, color: s.color }}
          >
            <Icon size={10} className={key === 'running' ? 'animate-spin' : ''} />
            {count} {label}
          </div>
        )
      })}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function OrgChartPage() {
  const [tree,       setTree]      = useState<OrgTreeType | null>(null)
  const [swimlanes,  setSwimlanes] = useState<Swimlane[]>([])
  const [selected,   setSelected]  = useState<OrgAgent | null>(null)
  const [viewMode,   setViewMode]  = useState<OrgViewMode>('tree')
  const [loading,    setLoading]   = useState(true)
  const [lastFetch,  setLastFetch] = useState<Date | null>(null)

  async function fetchData() {
    setLoading(true)
    try {
      const res = await fetch('/api/org', { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json() as { tree: OrgTreeType; swimlanes: Swimlane[] }
        setTree(json.tree)
        setSwimlanes(json.swimlanes)
        setLastFetch(new Date())
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchData()
    const interval = setInterval(fetchData, 15_000)  // poll every 15s
    return () => clearInterval(interval)
  }, [])

  const stats = tree?.stats

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden" style={{ backgroundColor: '#050508' }}>
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between gap-4 px-6 py-4 flex-wrap"
          style={{ borderBottom: '1px solid #24243e' }}
        >
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>Organisation Chart</h1>
            <p className="text-sm mt-0.5" style={{ color: '#55556a' }}>
              Live agent hierarchy · {stats?.total ?? '…'} agents across {stats?.activeSwarms ?? '…'} active swarm{stats?.activeSwarms !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div
              className="flex rounded-lg overflow-hidden"
              style={{ border: '1px solid #24243e' }}
            >
              {([
                { mode: 'tree' as const,      Icon: GitBranch, label: 'Tree' },
                { mode: 'swimlane' as const,  Icon: LayoutGrid, label: 'Swimlanes' },
              ]).map(({ mode, Icon, label }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: viewMode === mode ? '#6c63ff' : '#12121e',
                    color:           viewMode === mode ? '#fff'    : '#9090b0',
                  }}
                >
                  <Icon size={12} />
                  {label}
                </button>
              ))}
            </div>

            {/* Refresh */}
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-2 rounded-lg transition-colors"
              style={{ backgroundColor: '#12121e', color: '#55556a', border: '1px solid #24243e' }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Stats row */}
        {stats && (
          <div className="shrink-0 px-6 py-3 flex flex-col gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                Icon={Users as React.ComponentType<{ size?: number; style?: React.CSSProperties }>}
                label="Total agents" value={stats.total.toString()}
                sub={`${stats.byStatus.running ?? 0} running`} color="#818cf8"
              />
              <StatCard
                Icon={Network as React.ComponentType<{ size?: number; style?: React.CSSProperties }>}
                label="Active swarms" value={stats.activeSwarms.toString()}
                color="#22d3ee"
              />
              <StatCard
                Icon={Cpu as React.ComponentType<{ size?: number; style?: React.CSSProperties }>}
                label="Total tokens" value={`${(stats.totalTokens / 1000).toFixed(0)}k`}
                color="#4ade80"
              />
              <StatCard
                Icon={Coins as React.ComponentType<{ size?: number; style?: React.CSSProperties }>}
                label="Total cost" value={`$${stats.totalCost.toFixed(3)}`}
                color="#f59e0b"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <LayerBreakdown stats={stats} />
              <div className="flex flex-col justify-between gap-2 rounded-xl p-3"
                style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
              >
                <p className="text-xs font-medium" style={{ color: '#55556a' }}>Status overview</p>
                <StatusSummary stats={stats} />
                {lastFetch && (
                  <p className="text-xs" style={{ color: '#24243e' }}>
                    Updated {lastFetch.toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Chart area */}
        <div className="flex-1 overflow-auto p-6">
          {loading && !tree ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={28} className="animate-spin" style={{ color: '#6c63ff' }} />
            </div>
          ) : tree ? (
            viewMode === 'tree' ? (
              <OrgTree
                root={tree.root}
                selected={selected}
                onSelect={setSelected}
              />
            ) : (
              <SwimlanesView
                swimlanes={swimlanes}
                selected={selected}
                onSelect={setSelected}
              />
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Layers size={32} style={{ color: '#24243e' }} />
              <p className="text-sm" style={{ color: '#55556a' }}>No agents found</p>
            </div>
          )}
        </div>
      </div>

      {/* Drill-down panel */}
      {selected && (
        <div className="w-80 shrink-0 overflow-hidden flex flex-col" style={{ borderLeft: '1px solid #24243e' }}>
          <DrillDownPanel agent={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, TrendingDown } from 'lucide-react'

interface AgentStats {
  agentSlug:     string
  sampleCount:   number
  tokensP50:     number
  tokensP95:     number
  latencyP50Ms:  number
  latencyP95Ms:  number
  cacheHitRatio: number
  approveRate:   number
  costP50Usd:    number
}

export default function WorstOffendersWidget({ windowHours = 168, n = 5 }: { windowHours?: number; n?: number }) {
  const [rows,    setRows]    = useState<AgentStats[]>([])
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    ;(async () => {
      try {
        const res = await fetch(`/api/dashboard/worst-offenders?n=${n}&windowHours=${windowHours}`, { signal: ac.signal })
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const data = await res.json() as { offenders: AgentStats[] }
        setRows(data.offenders)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setErr((e as Error).message ?? 'Failed to load')
      } finally {
        setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [windowHours, n])

  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#e8e8f0' }}>
          <TrendingDown size={14} style={{ color: '#f59e0b' }} />
          Worst offenders
        </h3>
        <span className="text-xs" style={{ color: '#55556a' }}>last {Math.round(windowHours / 24)}d</span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs" style={{ color: '#9090b0' }}>
          <Loader2 size={12} className="animate-spin" /> Loading metrics…
        </div>
      )}
      {err && (
        <div className="flex items-center gap-2 text-xs" style={{ color: '#f59e0b' }}>
          <AlertTriangle size={12} /> {err}
        </div>
      )}
      {!loading && !err && rows.length === 0 && (
        <div className="text-xs" style={{ color: '#55556a' }}>
          Not enough samples yet. Run a swarm to populate metric_samples.
        </div>
      )}

      {rows.length > 0 && (
        <table className="w-full text-xs" style={{ color: '#e8e8f0' }}>
          <thead>
            <tr style={{ color: '#9090b0' }}>
              <th className="text-left pb-2">Agent</th>
              <th className="text-right pb-2">p50 latency</th>
              <th className="text-right pb-2">p95 latency</th>
              <th className="text-right pb-2">p50 cost</th>
              <th className="text-right pb-2">approve</th>
              <th className="text-right pb-2">cache</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.agentSlug} style={{ borderTop: '1px solid #24243e' }}>
                <td className="py-2 font-medium">{r.agentSlug}</td>
                <td className="py-2 text-right" style={{ color: '#9090b0' }}>{Math.round(r.latencyP50Ms)}ms</td>
                <td className="py-2 text-right" style={{ color: r.latencyP95Ms > 10_000 ? '#ef4444' : '#9090b0' }}>
                  {Math.round(r.latencyP95Ms)}ms
                </td>
                <td className="py-2 text-right" style={{ color: r.costP50Usd > 0.5 ? '#f59e0b' : '#9090b0' }}>
                  ${r.costP50Usd.toFixed(3)}
                </td>
                <td className="py-2 text-right" style={{ color: r.approveRate < 0.5 ? '#ef4444' : '#22c55e' }}>
                  {Math.round(r.approveRate * 100)}%
                </td>
                <td className="py-2 text-right" style={{ color: '#6c63ff' }}>
                  {Math.round(r.cacheHitRatio * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

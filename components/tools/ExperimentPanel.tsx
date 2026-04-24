'use client'

import { useEffect, useState } from 'react'
import type { Experiment } from '@/lib/experiments/types'

interface Props {
  runId?: string
}

/**
 * ExperimentPanel — C5
 *
 * Lists the running + decided A/B experiments for the caller. Fetches from
 * `/api/experiments` and renders variant rates, confidence, and the decision
 * badge. Read-only for now — sample writes come from the measure phase.
 */
export default function ExperimentPanel({ runId }: Props) {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)

  useEffect(() => {
    const url = runId ? `/api/experiments?runId=${encodeURIComponent(runId)}` : '/api/experiments'
    setLoading(true)
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ experiments: Experiment[] }>
      })
      .then(d => { setExperiments(d.experiments); setError(null) })
      .catch(e => setError(e instanceof Error ? e.message : 'failed to load'))
      .finally(() => setLoading(false))
  }, [runId])

  if (loading) return <p className="text-xs" style={{ color: '#9090b0' }}>Loading experiments…</p>
  if (error)   return <p className="text-xs" style={{ color: '#f87171' }}>Error: {error}</p>
  if (experiments.length === 0) {
    return <p className="text-xs" style={{ color: '#9090b0' }}>No experiments yet.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {experiments.map(exp => <ExperimentRow key={exp.id} exp={exp} />)}
    </div>
  )
}

function ExperimentRow({ exp }: { exp: Experiment }) {
  const rateA = exp.samplesA > 0 ? exp.successesA / exp.samplesA : 0
  const rateB = exp.samplesB > 0 ? exp.successesB / exp.samplesB : 0
  const confidencePct = ((exp.confidence ?? 0) * 100).toFixed(1)

  const statusColor = exp.status === 'decided'
    ? (exp.winner === 'a' ? '#818cf8' : exp.winner === 'b' ? '#c084fc' : '#f59e0b')
    : '#55556a'

  return (
    <div
      className="rounded-lg p-3"
      style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold" style={{ color: '#e8e8f0' }}>
          {exp.hypothesis ?? `Experiment ${exp.id.slice(0, 8)}`}
        </p>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-medium"
          style={{ color: statusColor, backgroundColor: `${statusColor}22`, border: `1px solid ${statusColor}55` }}
        >
          {exp.status === 'decided' ? `Winner: ${exp.winner?.toUpperCase()}` : 'Running'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <VariantBlock label={exp.variantA.label} rate={rateA} samples={exp.samplesA} highlight={exp.winner === 'a'} />
        <VariantBlock label={exp.variantB.label} rate={rateB} samples={exp.samplesB} highlight={exp.winner === 'b'} />
      </div>

      <p className="text-[10px] mt-2" style={{ color: '#9090b0' }}>
        Confidence: {confidencePct}% · {exp.samplesA + exp.samplesB} total samples
      </p>
    </div>
  )
}

function VariantBlock({ label, rate, samples, highlight }: { label: string; rate: number; samples: number; highlight: boolean }) {
  return (
    <div
      className="rounded p-2"
      style={{
        backgroundColor: highlight ? 'rgba(129,140,248,0.1)' : '#0a0a14',
        border: `1px solid ${highlight ? '#6366f1' : '#1c1c2e'}`,
      }}
    >
      <p className="text-[10px] mb-1" style={{ color: '#9090b0' }}>{label}</p>
      <p className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
        {(rate * 100).toFixed(2)}%
      </p>
      <p className="text-[10px]" style={{ color: '#55556a' }}>n={samples}</p>
    </div>
  )
}

'use client'

/**
 * Client surface for /memory/pending-edges. Lists mol_edge rows with
 * pending_approval=true; approve/reject buttons call /api/memory/pending-edges/:id/decide.
 */

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Check, X, AlertCircle, Filter } from 'lucide-react'

interface EdgeRow {
  id:               string
  scope_id:         string
  src_kind:         string
  src_id:           string
  predicate:        string
  dst_kind:         string
  dst_id:           string
  confidence:       number
  source:           string
  pending_approval: boolean
  created_at:       string
}

type ConfidenceBucket = 'all' | 'high' | 'medium' | 'low'

export default function PendingEdgesClient({ scope }: { scope: string }) {
  const [edges, setEdges]     = useState<EdgeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)
  const [err, setErr]         = useState<string | null>(null)
  const [bucket, setBucket]   = useState<ConfidenceBucket>('all')

  async function load() {
    setLoading(true); setErr(null)
    try {
      const res  = await fetch(`/api/memory/pending-edges?scope=${encodeURIComponent(scope)}&limit=200`)
      const json = (await res.json()) as { ok: boolean; edges?: EdgeRow[]; error?: string }
      if (!json.ok) throw new Error(json.error || 'load failed')
      setEdges(json.edges ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [scope])

  async function decide(edge: EdgeRow, decision: 'approve' | 'reject') {
    setBusy(edge.id); setErr(null)
    try {
      const res = await fetch(`/api/memory/pending-edges/${edge.id}/decide`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ decision }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (!json.ok) throw new Error(json.error || 'decision failed')
      // Optimistic — remove from list either way (approve flips
      // pending_approval=false; reject leaves it set but operator's done with it).
      setEdges(prev => prev.filter(e => e.id !== edge.id))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'decision failed')
    } finally {
      setBusy(null)
    }
  }

  const filtered = useMemo(() => {
    if (bucket === 'all') return edges
    if (bucket === 'high')   return edges.filter(e => e.confidence >= 0.7)
    if (bucket === 'medium') return edges.filter(e => e.confidence >= 0.4 && e.confidence < 0.7)
    /* low */                return edges.filter(e => e.confidence < 0.4)
  }, [edges, bucket])

  return (
    <div className="space-y-3">
      {err && (
        <div className="px-3.5 py-2.5 flex items-start gap-2.5 text-sm"
             style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.10), rgba(239,68,68,0.02))',
                      border: '1px solid rgba(239,68,68,0.22)', borderRadius: '14px', color: '#e8e8f0' }}>
          <AlertCircle size={16} style={{ color: '#f87171' }} />
          <div className="flex-1">{err}</div>
          <button onClick={() => setErr(null)} className="rounded-md p-0.5" style={{ color: '#9090b0' }}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={11} style={{ color: '#9090b0' }} />
        {(['all', 'high', 'medium', 'low'] as ConfidenceBucket[]).map(b => {
          const active = bucket === b
          const label  = b === 'all' ? `All (${edges.length})` :
                         b === 'high'   ? `High ≥ 0.7 (${edges.filter(e => e.confidence >= 0.7).length})` :
                         b === 'medium' ? `Medium 0.4–0.7 (${edges.filter(e => e.confidence >= 0.4 && e.confidence < 0.7).length})` :
                                          `Low < 0.4 (${edges.filter(e => e.confidence < 0.4).length})`
          return (
            <button key={b} type="button" onClick={() => setBucket(b)}
                    className="text-[11px] px-2 py-0.5 rounded-md"
                    style={active
                      ? { color: '#e8e8f0', background: 'rgba(108,99,255,0.15)', border: '1px solid rgba(108,99,255,0.30)' }
                      : { color: '#9090b0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              {label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm px-4 py-3"
             style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px' }}>
          <Loader2 size={14} className="animate-spin" /> Loading pending edges…
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm"
             style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px' }}>
          Nothing pending. The cron at <span className="font-mono" style={{ color: '#a8a3ff' }}>/api/cron/hmem-extract-edges</span> will surface new edges on its next run.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map(e => <EdgeRowCard key={e.id} edge={e} busy={busy === e.id} onDecide={d => void decide(e, d)} />)}
        </ul>
      )}
    </div>
  )
}

function EdgeRowCard({ edge, busy, onDecide }: { edge: EdgeRow; busy: boolean; onDecide: (d: 'approve' | 'reject') => void }) {
  const confColor = edge.confidence >= 0.7 ? '#4ade80' : edge.confidence >= 0.4 ? '#fbbf24' : '#9090b0'
  return (
    <li className="rounded-2xl p-3 flex items-center gap-3 flex-wrap"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
                 border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-mono" style={{ color: '#e8e8f0' }}>
          <span style={{ color: '#a8a3ff' }}>{edge.src_id}</span>
          {' '}—<span style={{ color: '#fbbf24' }}> {edge.predicate} </span>→{' '}
          <span style={{ color: '#a8a3ff' }}>{edge.dst_id}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px]" style={{ color: '#9090b0' }}>
          <span className="font-mono">{edge.source}</span>
          <span style={{ color: '#55556a' }}>·</span>
          <span style={{ color: confColor }}>confidence {(edge.confidence * 100).toFixed(0)}%</span>
          <span style={{ color: '#55556a' }}>·</span>
          <time dateTime={edge.created_at}>{new Date(edge.created_at).toLocaleDateString()}</time>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button type="button" onClick={() => onDecide('reject')} disabled={busy}
                className="text-[11px] px-2 py-1 rounded-md inline-flex items-center gap-1 disabled:opacity-40"
                style={{ color: '#f87171', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.20)' }}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
          Reject
        </button>
        <button type="button" onClick={() => onDecide('approve')} disabled={busy}
                className="text-[11px] px-2 py-1 rounded-md inline-flex items-center gap-1 disabled:opacity-40"
                style={{ color: '#4ade80', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.22)' }}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Approve
        </button>
      </div>
    </li>
  )
}

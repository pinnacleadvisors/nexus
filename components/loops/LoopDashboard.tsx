'use client'

/**
 * LoopDashboard — body for /settings/loops/[id].
 *
 * Shows the Loop's North Star + end-outcome + caps + status, an iteration log
 * (n / scope / intent / outcome / cost / timing), the running total cost, and
 * operator controls: Start (next iteration), Pause / Resume, Kill.
 *
 * Refetches after each action (no setInterval — avoids a polling storm; the
 * operator hits Refresh or an action to update). Fail-soft on {ok:false}.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Play, Pause, RotateCcw, Square, RefreshCw } from 'lucide-react'
import type { Loop, LoopIteration } from '@/lib/loops/types'
import { panelStyle, StatusPill, ModeBadge, OutcomePill, FG, MUTED, ACCENT_SOFT } from './shared'

const btn = (tone: 'primary' | 'neutral' | 'danger') => ({
  primary: { color: FG, background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.10))', border: '1px solid rgba(108,99,255,0.30)' },
  neutral: { color: MUTED, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' },
  danger:  { color: '#fca5a5', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)' },
}[tone])

export default function LoopDashboard({ loopId }: { loopId: string }) {
  const [loop, setLoop] = useState<Loop | null>(null)
  const [iterations, setIterations] = useState<LoopIteration[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/loops/${loopId}`, { cache: 'no-store' })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; loop?: Loop; iterations?: LoopIteration[]; error?: string }
      if (!j.ok) { setErr(j.error ?? 'failed to load'); setLoop(null) }
      else { setErr(null); setLoop(j.loop ?? null); setIterations(j.iterations ?? []) }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load')
    } finally {
      setLoading(false)
    }
  }, [loopId])

  useEffect(() => { void load() }, [load])

  async function start() {
    setBusy('start'); setErr(null)
    try {
      const res = await fetch(`/api/loops/${loopId}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; pending?: boolean; error?: string }
      if (!j.ok) setErr(j.error ?? 'start failed')
      await load()
    } finally { setBusy(null) }
  }

  async function patch(status: Loop['status']) {
    if (status === 'killed' && !confirm('Kill this loop? It will stop firing iterations.')) return
    setBusy(status); setErr(null)
    try {
      const res = await fetch(`/api/loops/${loopId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!j.ok) setErr(j.error ?? 'update failed')
      await load()
    } finally { setBusy(null) }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm px-4 py-3 rounded-xl" style={{ ...panelStyle, color: MUTED }}><Loader2 size={14} className="animate-spin" /> Loading loop…</div>
  }
  if (!loop) {
    return (
      <div className="px-4 py-3 rounded-xl text-sm" style={{ ...panelStyle, color: '#fcd34d' }}>
        {err === 'migration_094_not_applied' ? 'Loops schema not applied yet — run migrations 094–096, then reload.' : (err === 'not_found' ? 'Loop not found.' : `Couldn't load: ${err}`)}
      </div>
    )
  }

  const totalCost = iterations.reduce((s, it) => s + (it.cost_usd ?? 0), 0)
  const canStart = loop.status === 'active'

  return (
    <div className="space-y-4">
      {/* Header + controls */}
      <div className="p-4 rounded-xl" style={panelStyle}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold" style={{ color: FG }}>{loop.name}</h2>
              <ModeBadge mode={loop.mode} />
              <StatusPill status={loop.status} />
            </div>
            {loop.business_slug && <div className="text-[11px] mt-1 font-mono" style={{ color: MUTED }}>{loop.business_slug}</div>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] min-h-[40px]" style={btn('neutral')}><RefreshCw size={13} /> Refresh</button>
            {canStart && <button onClick={start} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold min-h-[40px] disabled:opacity-40" style={btn('primary')}>{busy === 'start' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Start iteration</button>}
            {loop.status === 'active' && <button onClick={() => patch('paused')} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] min-h-[40px] disabled:opacity-40" style={btn('neutral')}><Pause size={13} /> Pause</button>}
            {loop.status === 'paused' && <button onClick={() => patch('active')} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] min-h-[40px] disabled:opacity-40" style={btn('primary')}><RotateCcw size={13} /> Resume</button>}
            {(loop.status === 'active' || loop.status === 'paused') && <button onClick={() => patch('killed')} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] min-h-[40px] disabled:opacity-40" style={btn('danger')}><Square size={13} /> Kill</button>}
          </div>
        </div>
        {err && <div className="mt-3 px-3 py-2 rounded-lg text-[12px]" style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)' }}>{err}</div>}

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
          <Stat label="Iterations" value={`${iterations.length}${loop.iteration_cap !== null ? ` / ${loop.iteration_cap}` : ''}`} />
          <Stat label="Spent" value={`$${totalCost.toFixed(2)}${loop.cost_cap_usd !== null ? ` / $${loop.cost_cap_usd}` : ''}`} />
          <Stat label="Time cap" value={loop.time_cap_hours !== null ? `${loop.time_cap_hours}h` : '—'} />
          <Stat label="Agent" value={loop.delegated_agent_slug} mono />
        </div>
      </div>

      {/* North Star + end outcome */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Block title="North Star" body={loop.north_star_md} />
        <Block title="End-outcome predicate" body={loop.end_outcome_md} />
      </div>

      {/* Iteration log */}
      <div className="p-4 rounded-xl" style={panelStyle}>
        <div className="text-xs uppercase tracking-[0.14em] mb-3" style={{ color: ACCENT_SOFT }}>Iteration log</div>
        {iterations.length === 0 ? (
          <div className="text-sm" style={{ color: MUTED }}>No iterations yet. {canStart ? 'Hit “Start iteration”.' : ''}</div>
        ) : (
          <div className="space-y-2">
            {iterations.map(it => (
              <div key={it.id} className="flex items-start gap-3 px-3 py-2 rounded-lg text-[12px]" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="font-mono shrink-0" style={{ color: ACCENT_SOFT }}>#{it.iteration_n}</span>
                <div className="flex-1 min-w-0">
                  <div style={{ color: FG }}>{it.intent || it.scope || '(no intent recorded)'}</div>
                  <div className="mt-0.5" style={{ color: MUTED }}>{it.scope ? `${it.scope} · ` : ''}{it.summary_md ? it.summary_md.slice(0, 160) : ''}</div>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  <OutcomePill outcome={it.outcome} />
                  {it.cost_usd > 0 && <span style={{ color: MUTED }}>${it.cost_usd.toFixed(4)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: MUTED }}>{label}</div>
      <div className={`mt-0.5 ${mono ? 'font-mono text-[11px]' : 'text-sm font-medium'} truncate`} style={{ color: FG }}>{value}</div>
    </div>
  )
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-4 rounded-xl" style={panelStyle}>
      <div className="text-xs uppercase tracking-[0.14em] mb-2" style={{ color: ACCENT_SOFT }}>{title}</div>
      <p className="text-[13px] whitespace-pre-wrap" style={{ color: body ? FG : MUTED }}>{body || '(none provided)'}</p>
    </div>
  )
}

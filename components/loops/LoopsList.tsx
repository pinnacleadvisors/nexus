'use client'

/**
 * LoopsList — body for /settings/loops.
 *
 * Lists every Loop the operator owns (GET /api/loops) with status pill, mode,
 * iteration count, total cost, last activity. "+ New Loop" → /settings/loops/new.
 * Each card links to its dashboard at /settings/loops/[id].
 *
 * Fail-soft: when the API returns {ok:false} (e.g. migrations not yet applied),
 * we render an informative banner rather than a crash.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus, Repeat } from 'lucide-react'
import type { LoopSummary } from '@/lib/loops/types'
import { panelStyle, StatusPill, ModeBadge, FG, MUTED, ACCENT, ACCENT_SOFT } from './shared'

export default function LoopsList() {
  const [loops, setLoops]   = useState<LoopSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]       = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/loops', { cache: 'no-store' })
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; loops?: LoopSummary[]; error?: string }
        if (!alive) return
        if (!j.ok) setErr(j.error ?? 'failed to load loops')
        else setLoops(j.loops ?? [])
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'failed to load loops')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm max-w-2xl" style={{ color: MUTED }}>
          Declare an end-outcome + a delegated agent, set cost / iteration / time caps,
          and the platform runs an iteration loop within bounds. Inherits every Ralph-loop
          invariant (operator-gated, bounded, draft-only, cost-aware).
        </p>
        <Link
          href="/settings/loops/new"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[13px] font-semibold whitespace-nowrap shrink-0"
          style={{ color: FG, background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.10))', border: '1px solid rgba(108,99,255,0.30)' }}
        >
          <Plus size={14} /> New Loop
        </Link>
      </div>

      {err && (
        <div className="px-4 py-3 rounded-xl text-sm" style={{ ...panelStyle, color: '#fcd34d', border: '1px solid rgba(245,158,11,0.30)' }}>
          {err === 'migration_094_not_applied'
            ? 'Loops schema not applied yet — run migrations 094–096 (Group A) on Supabase, then reload.'
            : `Couldn't load loops: ${err}`}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm px-4 py-3 rounded-xl" style={{ ...panelStyle, color: MUTED }}>
          <Loader2 size={14} className="animate-spin" /> Loading loops…
        </div>
      ) : loops.length === 0 && !err ? (
        <div className="flex flex-col items-center text-center gap-2 px-4 py-10 rounded-xl" style={{ ...panelStyle, color: MUTED }}>
          <Repeat size={22} style={{ color: ACCENT_SOFT }} />
          <div className="text-sm font-medium" style={{ color: FG }}>No loops yet</div>
          <div className="text-xs max-w-sm">Create your first Loop to have the platform iterate toward an outcome within the bounds you set.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {loops.map(l => (
            <Link key={l.id} href={`/settings/loops/${l.id}`} className="block p-4 rounded-xl transition-all hover:brightness-110" style={panelStyle}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: FG }}>{l.name}</div>
                  {l.business_slug && <div className="text-[11px] mt-0.5 font-mono" style={{ color: MUTED }}>{l.business_slug}</div>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <ModeBadge mode={l.mode} />
                  <StatusPill status={l.status} />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-4 text-[12px]" style={{ color: MUTED }}>
                <span><span style={{ color: ACCENT_SOFT }}>{l.iteration_count}</span> iter</span>
                <span><span style={{ color: ACCENT_SOFT }}>${(l.total_cost_usd ?? 0).toFixed(2)}</span> spent</span>
                {l.cost_cap_usd !== null && <span>cap ${l.cost_cap_usd}</span>}
              </div>
              <div className="mt-1 text-[11px]" style={{ color: MUTED }}>
                agent <span className="font-mono" style={{ color: ACCENT }}>{l.delegated_agent_slug}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

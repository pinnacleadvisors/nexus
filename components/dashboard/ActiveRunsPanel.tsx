'use client'

/**
 * Active Runs panel — Mission Control's primary "what is the system doing
 * right now?" surface. Polls `/api/runs?phase=...` for non-terminal phases
 * (ideate / spec / decompose / build / review / launch / measure / optimise)
 * and renders one row per run with phase + age + click-through to /board.
 *
 * Empty state explicitly tells the operator the system is idle so a blank
 * panel never looks like a bug.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Activity, ArrowRight, Loader2 } from 'lucide-react'
import type { Run, RunPhase } from '@/lib/types'

const POLL_MS = 15_000

const ACTIVE_PHASES: RunPhase[] = [
  'ideate', 'spec', 'decompose', 'build', 'review', 'launch', 'measure', 'optimise',
]

function timeAgo(iso: string): string {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60)    return `${seconds}s`
  if (seconds < 3600)  return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

const PHASE_COLOR: Record<RunPhase, { bg: string; fg: string }> = {
  ideate:    { bg: '#1e2a3a', fg: '#7ab8ff' },
  spec:      { bg: '#1e2a3a', fg: '#7ab8ff' },
  decompose: { bg: '#2a1e3a', fg: '#c084fc' },
  build:     { bg: '#0d2e1a', fg: '#4ade80' },
  review:    { bg: '#2a1f0d', fg: '#f59e0b' },
  launch:    { bg: '#2a1f0d', fg: '#f59e0b' },
  measure:   { bg: '#1a1a2e', fg: '#9090b0' },
  optimise:  { bg: '#1a1a2e', fg: '#9090b0' },
  done:      { bg: '#0d2e1a', fg: '#4ade80' },
}

export default function ActiveRunsPanel() {
  const [runs, setRuns] = useState<Run[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const all: Run[] = []
        // Fetch all active phases in parallel — one call per phase keeps the
        // /api/runs query simple and aligns with how the controller indexes.
        const results = await Promise.all(
          ACTIVE_PHASES.map(p =>
            fetch(`/api/runs?phase=${p}`, { cache: 'no-store' })
              .then(r => r.ok ? r.json() : { runs: [] })
              .then((j: { runs?: Run[] }) => j.runs ?? [])
              .catch(() => [] as Run[])
          )
        )
        for (const r of results) all.push(...r)
        // De-dupe + sort newest first
        const seen = new Set<string>()
        const unique = all.filter(r => seen.has(r.id) ? false : (seen.add(r.id), true))
        unique.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        if (!cancelled) setRuns(unique.slice(0, 8))
      } catch { /* keep last */ }
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity size={14} style={{ color: '#6c63ff' }} />
          <span className="text-xs uppercase tracking-wide font-medium" style={{ color: '#9090b0' }}>
            Active runs
          </span>
        </div>
        {runs === null && <Loader2 size={12} className="animate-spin" style={{ color: '#55556a' }} />}
        <Link
          href="/board"
          className="text-xs flex items-center gap-1 hover:underline"
          style={{ color: '#9090b0' }}
        >
          Board <ArrowRight size={11} />
        </Link>
      </div>

      {runs !== null && runs.length === 0 && (
        <p className="text-xs" style={{ color: '#55556a' }}>
          Hive idle. Pick an idea from the library and hit ▶ to spin one up.
        </p>
      )}

      <div className="space-y-2">
        {runs?.map(run => {
          const c = PHASE_COLOR[run.phase] ?? PHASE_COLOR.measure
          return (
            <Link
              key={run.id}
              href={`/board?runId=${run.id}`}
              className="block p-2.5 rounded-lg transition-colors"
              style={{ backgroundColor: '#050508', border: '1px solid #24243e' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#12121e' }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#050508' }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-medium uppercase tracking-wide px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: c.bg, color: c.fg }}
                >
                  {run.phase}
                </span>
                <span className="text-xs flex-1 truncate" style={{ color: '#e8e8f0' }}>
                  {run.ideaId ? `idea:${run.ideaId.slice(0, 8)}` : `run:${run.id.slice(0, 8)}`}
                </span>
                <span className="text-xs tabular-nums" style={{ color: '#55556a' }}>
                  {timeAgo(run.updatedAt)} ago
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

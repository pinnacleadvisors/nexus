'use client'

/**
 * BackgroundTasksView — Phase 4 of task_plan-collaborative-chat.md.
 *
 * Read-only list of background tasks for this scope. Polls every 5s while
 * the panel is open. v1 surfaces what the agent has delegated; v2 will
 * add a "+ New background task" button + restart actions when Inngest
 * handlers are wired.
 */

import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Clock, Ban, Cog } from 'lucide-react'

interface BackgroundTaskRow {
  id:                string
  scope:             string
  /** Phase 5 v2: parent swarm row when present. Null for standalone tasks. */
  parent_id?:        string | null
  kind:              string
  title:             string
  description:       string | null
  status:            'pending' | 'running' | 'done' | 'error' | 'cancelled'
  error:             string | null
  started_at:        string | null
  finished_at:       string | null
  cancelled_at:      string | null
  created_at:        string
}

const STATUS_STYLE: Record<BackgroundTaskRow['status'], { color: string; label: string; Icon: typeof Clock }> = {
  pending:   { color: '#9090b0', label: 'Pending',   Icon: Clock },
  running:   { color: '#a8a3ff', label: 'Running',   Icon: Loader2 },
  done:      { color: '#22c55e', label: 'Done',      Icon: CheckCircle2 },
  error:     { color: '#ef4444', label: 'Error',     Icon: XCircle },
  cancelled: { color: '#f59e0b', label: 'Cancelled', Icon: Ban },
}

interface Props {
  scope: string
  onCountChange?: (n: number) => void
}

export default function BackgroundTasksView({ scope, onCountChange }: Props) {
  const [rows, setRows]       = useState<BackgroundTaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function refresh() {
      try {
        const res = await fetch(`/api/background-tasks?scope=${encodeURIComponent(scope)}`, { cache: 'no-store' })
        if (!res.ok) { setError(`HTTP ${res.status}`); return }
        const data = await res.json() as { ok: boolean; tasks?: BackgroundTaskRow[]; error?: string }
        if (!alive) return
        if (data.ok && data.tasks) {
          setRows(data.tasks)
          const active = data.tasks.filter(t => t.status === 'pending' || t.status === 'running').length
          onCountChange?.(active)
          setError(null)
        } else {
          setError(data.error ?? 'unknown')
        }
      } catch (e) {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    }
    void refresh()
    const id = setInterval(refresh, 5_000)
    return () => { alive = false; clearInterval(id) }
  }, [scope, onCountChange])

  async function cancel(id: string) {
    const res = await fetch(`/api/background-tasks/${id}/cancel`, { method: 'POST' })
    if (res.ok) {
      setRows(prev => prev.map(r => r.id === id ? { ...r, status: 'cancelled', cancelled_at: new Date().toISOString() } : r))
    }
  }

  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs px-4 py-3" style={{ color: '#9090b0' }}>
        <Loader2 size={12} className="animate-spin" /> Loading background tasks…
      </div>
    )
  }
  if (error && rows.length === 0) {
    return <div className="text-xs px-4 py-3" style={{ color: '#ef4444' }}>Failed to load: {error}</div>
  }
  if (rows.length === 0) {
    return (
      <div className="px-4 py-6 text-center space-y-2" style={{ color: '#9090b0' }}>
        <Cog size={20} className="mx-auto opacity-50" />
        <div className="text-xs">No background tasks yet.</div>
        <div className="text-[10.5px] opacity-70">The agent will delegate here when work is too long to fit one turn.</div>
      </div>
    )
  }

  // Phase 5 v2 — group children under their parent. Top-level rows are
  // those with no parent_id (or whose parent is not in this page of rows).
  // Children render in a 2-col grid nested under the parent.
  const byId = new Map(rows.map(r => [r.id, r]))
  const childrenOf = new Map<string, BackgroundTaskRow[]>()
  for (const r of rows) {
    if (r.parent_id && byId.has(r.parent_id)) {
      if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, [])
      childrenOf.get(r.parent_id)!.push(r)
    }
  }
  const topLevel = rows.filter(r => !r.parent_id || !byId.has(r.parent_id))

  return (
    <div className="px-2 py-2 space-y-1.5">
      {topLevel.map(r => (
        <TaskRow key={r.id} row={r} childRows={childrenOf.get(r.id) ?? []} onCancel={cancel} />
      ))}
    </div>
  )
}

/**
 * Phase 5 v2 — a parent row with (optionally) a 2-col grid of child rows
 * nested below + an aggregate-status badge ("3/4 done"). Used for swarm
 * parents. Standalone tasks fall through with an empty children array.
 */
function TaskRow({ row, childRows, onCancel }: { row: BackgroundTaskRow; childRows: BackgroundTaskRow[]; onCancel: (id: string) => void }) {
  // Aggregate child status for the parent badge.
  let aggregateLabel: string | null = null
  let aggregateColor: string | null = null
  if (childRows.length > 0) {
    const counts = { pending: 0, running: 0, done: 0, error: 0, cancelled: 0 }
    for (const c of childRows) counts[c.status]++
    const finished = counts.done + counts.cancelled
    aggregateLabel = `${counts.done}/${childRows.length} done`
    if (counts.error > 0)                          { aggregateLabel += ` · ${counts.error} err`; aggregateColor = '#ef4444' }
    else if (counts.running > 0)                   { aggregateColor = '#a8a3ff' }
    else if (finished === childRows.length)        { aggregateColor = '#22c55e' }
    else                                           { aggregateColor = '#9090b0' }
  }

  const s = STATUS_STYLE[row.status]
  const Icon = s.Icon
  const isActive = row.status === 'pending' || row.status === 'running'
  const isSwarm = childRows.length > 0 || row.kind === 'swarm'

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: isSwarm ? 'rgba(108,99,255,0.04)' : 'rgba(255,255,255,0.03)',
        border:     isSwarm ? '1px solid rgba(108,99,255,0.20)' : '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Parent row — same shape as the v1 task card, with an aggregate badge when it's a swarm. */}
      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2">
          <Icon size={14} className={row.status === 'running' ? 'animate-spin' : ''} style={{ color: s.color, marginTop: 1, flexShrink: 0 }} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>
              {isSwarm && <span className="opacity-60 mr-1" aria-hidden>🐝</span>}
              {row.title}
            </div>
            {row.description && (
              <div className="text-[11px] mt-0.5 line-clamp-2" style={{ color: '#9090b0' }}>{row.description}</div>
            )}
            <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: '#55556a' }}>
              <span className="font-mono uppercase tracking-wider" style={{ color: s.color }}>{s.label}</span>
              <span>·</span>
              <span className="font-mono">{row.kind}</span>
              {aggregateLabel && (
                <>
                  <span>·</span>
                  <span className="font-mono" style={{ color: aggregateColor ?? '#9090b0' }}>{aggregateLabel}</span>
                </>
              )}
              {row.error && (
                <>
                  <span>·</span>
                  <span className="truncate" style={{ color: '#ef4444' }}>{row.error}</span>
                </>
              )}
            </div>
          </div>
          {isActive && (
            <button
              onClick={() => onCancel(row.id)}
              className="shrink-0 text-[10px] px-2 py-1 min-h-[28px] rounded transition-colors"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      {/* Children — 2-col grid nested under the parent. Single column at <sm so mobile stacks vertically. */}
      {childRows.length > 0 && (
        <div className="px-3 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5" style={{ borderTop: '1px dashed rgba(108,99,255,0.15)' }}>
          {childRows.map(c => {
            const cs = STATUS_STYLE[c.status]
            const CIcon = cs.Icon
            const cActive = c.status === 'pending' || c.status === 'running'
            return (
              <div key={c.id} className="px-2.5 py-2 rounded" style={{ background: 'rgba(0,0,0,0.20)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div className="flex items-start gap-1.5">
                  <CIcon size={11} className={c.status === 'running' ? 'animate-spin' : ''} style={{ color: cs.color, marginTop: 2, flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium truncate" style={{ color: '#e8e8f0' }}>{c.title}</div>
                    <div className="flex items-center gap-1 mt-0.5 text-[10px]" style={{ color: '#55556a' }}>
                      <span className="font-mono" style={{ color: cs.color }}>{cs.label}</span>
                      <span>·</span>
                      <span className="font-mono truncate">{c.kind}</span>
                    </div>
                  </div>
                  {cActive && (
                    <button
                      onClick={() => onCancel(c.id)}
                      title="Cancel"
                      aria-label="Cancel child task"
                      className="shrink-0 text-[9px] px-1.5 py-0.5 min-h-[22px] rounded"
                      style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.20)', color: '#fca5a5' }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

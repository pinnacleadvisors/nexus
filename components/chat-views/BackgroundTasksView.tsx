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

  return (
    <div className="px-2 py-2 space-y-1.5">
      {rows.map(r => {
        const s = STATUS_STYLE[r.status]
        const Icon = s.Icon
        const isActive = r.status === 'pending' || r.status === 'running'
        return (
          <div key={r.id} className="px-3 py-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-start gap-2">
              <Icon size={14} className={r.status === 'running' ? 'animate-spin' : ''} style={{ color: s.color, marginTop: 1, flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>{r.title}</div>
                {r.description && (
                  <div className="text-[11px] mt-0.5 line-clamp-2" style={{ color: '#9090b0' }}>{r.description}</div>
                )}
                <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: '#55556a' }}>
                  <span className="font-mono uppercase tracking-wider" style={{ color: s.color }}>{s.label}</span>
                  <span>·</span>
                  <span className="font-mono">{r.kind}</span>
                  {r.error && (
                    <>
                      <span>·</span>
                      <span className="truncate" style={{ color: '#ef4444' }}>{r.error}</span>
                    </>
                  )}
                </div>
              </div>
              {isActive && (
                <button
                  onClick={() => void cancel(r.id)}
                  className="shrink-0 text-[10px] px-2 py-1 min-h-[28px] rounded transition-colors"
                  style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

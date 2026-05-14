'use client'

/**
 * CalendarView — flat list of upcoming events ordered by `at` ascending.
 *
 * Three kinds:
 *   - 'task' — operator_tasks rows with due_at >= now()
 *   - 'run'  — recent run_events (last 24h, for cadence visibility)
 *   - 'cron' — static "system rhythm" hints (idle scale-down, digest, …)
 *
 * MVP — single scrollable list. If this ever needs to grow, swap to a
 * proper calendar grid component (react-day-picker or similar).
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, ListTodo, Activity, Clock } from 'lucide-react'

interface CalendarEntry {
  id:      string
  kind:    'task' | 'run' | 'cron'
  title:   string
  at:      string
  detail?: string
  href?:   string
}

interface Props { scope: string }

export default function CalendarView({ scope }: Props) {
  const [entries, setEntries] = useState<CalendarEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/views/calendar?scope=${encodeURIComponent(scope)}`, { cache: 'no-store' })
      if (!res.ok) { setErr(`HTTP ${res.status}`); return }
      const j = (await res.json()) as { ok: true; entries: CalendarEntry[] } | { ok: false; error: string }
      if (!j.ok) { setErr(j.error); return }
      setEntries(j.entries)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load')
    } finally { setLoading(false) }
  }, [scope])

  useEffect(() => { void reload() }, [reload])

  return (
    <div className="px-3 py-3 space-y-1.5">
      {loading && entries.length === 0 && (
        <div className="flex items-center gap-2 text-xs py-6 justify-center" style={{ color: '#9090b0' }}>
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      )}

      {err && (
        <div className="text-xs rounded p-2" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}>{err}</div>
      )}

      {!loading && !err && entries.length === 0 && (
        <div className="text-[11px] text-center py-6" style={{ color: '#55556a' }}>
          Nothing scheduled. Set a due_at on a task or kick off a run to see it here.
        </div>
      )}

      {entries.map(e => <CalRow key={e.id} entry={e} />)}
    </div>
  )
}

function CalRow({ entry }: { entry: CalendarEntry }) {
  const Icon  = entry.kind === 'task' ? ListTodo : entry.kind === 'run' ? Activity : Clock
  const color = entry.kind === 'task' ? '#a8a3ff' : entry.kind === 'run' ? '#22c55e' : '#9090b0'
  return (
    <div className="flex items-start gap-2 p-2 rounded transition-colors" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <Icon size={12} style={{ color }} className="mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs truncate" style={{ color: '#e8e8f0' }} title={entry.title}>{entry.title}</div>
        <div className="text-[10px] mt-0.5" style={{ color: '#9090b0' }}>
          {new Date(entry.at).toLocaleString()}
          {entry.detail && <span style={{ color: '#55556a' }}> · {entry.detail}</span>}
        </div>
      </div>
    </div>
  )
}

'use client'

/**
 * AuditPanel — recent audit log + pin/unpin controls.
 *
 * Mirrors HealthPanel's styling. Owner-only via /api/audit (already enforces
 * ALLOWED_USER_IDS). Pinned rows survive the daily 90-day prune cron.
 */

import { useEffect, useState } from 'react'
import { Loader2, Pin, PinOff, RefreshCw, ScrollText } from 'lucide-react'

interface AuditRow {
  id:          string
  user_id:     string | null
  action:      string
  resource:    string
  resource_id: string | null
  metadata:    unknown
  ip:          string | null
  pinned:      boolean
  created_at:  string
}

const PAGE_SIZE = 50

export default function AuditPanel() {
  const [rows, setRows]       = useState<AuditRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [filterAction, setFilterAction] = useState<string>('')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (filterAction) params.set('action', filterAction)
      const res = await fetch(`/api/audit?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(data.error ?? `failed (${res.status})`)
        setRows([])
        return
      }
      const data = await res.json() as { entries: AuditRow[] }
      setRows(data.entries ?? [])
    } catch (err) {
      setError((err as Error).message)
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filterAction])

  async function togglePin(row: AuditRow) {
    setPending(row.id)
    try {
      const res = await fetch('/api/audit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: row.id, pinned: !row.pinned }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(data.error ?? `failed (${res.status})`)
        return
      }
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: '#e8e8f0' }}>
            <ScrollText size={16} style={{ color: '#6c63ff' }} />
            Audit log
          </h2>
          <p className="text-xs mt-1" style={{ color: '#6c6c88' }}>
            Append-only history of state-changing actions. Pinned rows survive the 90-day prune.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            placeholder="filter by action…"
            className="px-3 py-1.5 rounded-lg text-xs outline-none"
            style={{ backgroundColor: '#12121e', color: '#e8e8f0', border: '1px solid #24243e' }}
          />
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs disabled:opacity-50"
            style={{ color: '#9090b0', backgroundColor: '#12121e', border: '1px solid #24243e' }}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm flex items-center gap-2"
          style={{ backgroundColor: '#1a0d0d', border: '1px solid #ef444444', color: '#c08080' }}>
          {error}
        </div>
      )}

      {loading && !rows && (
        <div className="flex items-center gap-2 text-sm" style={{ color: '#6c6c88' }}>
          <Loader2 size={14} className="animate-spin" /> Loading audit log…
        </div>
      )}

      {rows && rows.length === 0 && !loading && (
        <p className="text-sm" style={{ color: '#6c6c88' }}>No audit entries match.</p>
      )}

      {rows && rows.length > 0 && (
        <div className="rounded-lg border overflow-hidden"
          style={{ borderColor: '#24243e', backgroundColor: '#0d0d14' }}>
          <table className="w-full text-xs">
            <thead style={{ backgroundColor: '#12121e' }}>
              <tr style={{ color: '#6c6c88' }}>
                <th className="text-left px-3 py-2 font-medium">When</th>
                <th className="text-left px-3 py-2 font-medium">Action</th>
                <th className="text-left px-3 py-2 font-medium">Resource</th>
                <th className="text-left px-3 py-2 font-medium">User</th>
                <th className="text-right px-3 py-2 font-medium">Pin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isPending = pending === row.id
                return (
                  <tr
                    key={row.id}
                    style={{
                      borderTop: '1px solid #1a1a2e',
                      backgroundColor: row.pinned ? '#15151f' : (i % 2 ? '#0d0d14' : 'transparent'),
                    }}
                  >
                    <td className="px-3 py-2 font-mono" style={{ color: '#9090b0' }}>
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono" style={{ color: '#e8e8f0' }}>{row.action}</td>
                    <td className="px-3 py-2" style={{ color: '#9090b0' }}>
                      {row.resource}{row.resource_id ? ` · ${row.resource_id.slice(0, 8)}` : ''}
                    </td>
                    <td className="px-3 py-2 font-mono" style={{ color: '#6c6c88' }}>
                      {row.user_id ? `${row.user_id.slice(0, 14)}…` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => togglePin(row)}
                        disabled={isPending}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs disabled:opacity-50"
                        style={row.pinned
                          ? { backgroundColor: '#6c63ff22', color: '#6c63ff', border: '1px solid #6c63ff44' }
                          : { backgroundColor: 'transparent', color: '#55556a', border: '1px solid #24243e' }}
                        title={row.pinned ? 'Unpin (will be pruned after 90 days)' : 'Pin (survive prune)'}
                      >
                        {isPending
                          ? <Loader2 size={11} className="animate-spin" />
                          : row.pinned
                            ? <Pin size={11} />
                            : <PinOff size={11} />}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

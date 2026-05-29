'use client'

/**
 * components/audit/AuditStreamTable.tsx — generic dense pane for one source.
 *
 * Renders any AuditSource: header (label, live row count, filter pills,
 * freeze, refresh) + a dense scrollable table driven by source.columns.
 * Initial/refresh reads go through the Server Action (table sources) or the
 * source endpoint (poll sources). Live Realtime deltas are wired in Group B
 * via the marked effect slot — this file already merges/caps rows so that
 * edit is additive.
 *
 * Filtering (window / business / agent / mcp / outcome) is client-side over
 * the in-memory rows so it applies uniformly to fetched + streamed rows.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Bot, Clock, Sparkles, Wrench, Plug, Cpu, CheckCheck, Activity, TriangleAlert,
  Snowflake, RefreshCw, Play, Radio, type LucideIcon,
} from 'lucide-react'
import { fetchAuditRows } from '@/app/(protected)/audit/actions'
import { subscribeToSource } from '@/lib/audit/streams'
import { usePollWithBackoff } from '@/lib/hooks/usePollWithBackoff'
import { WINDOW_OPTIONS, type AuditRecord, type AuditSource, type CellTone, type FilterKind } from '@/lib/audit/types'
import { ROW_LIMIT } from '@/lib/audit/sources'

const ICONS: Record<string, LucideIcon> = {
  Bot, Clock, Sparkles, Wrench, Plug, Cpu, CheckCheck, Activity, TriangleAlert,
}

const TONE_TEXT: Record<CellTone, string> = {
  default: 'text-zinc-200', muted: 'text-zinc-500', ok: 'text-emerald-400',
  error: 'text-red-400', warn: 'text-amber-400', info: 'text-sky-400', pending: 'text-amber-300',
}
const TONE_BADGE: Record<CellTone, string> = {
  default: 'bg-zinc-800 text-zinc-300', muted: 'bg-zinc-800/60 text-zinc-500',
  ok: 'bg-emerald-900/40 text-emerald-300', error: 'bg-red-900/40 text-red-300',
  warn: 'bg-amber-900/40 text-amber-300', info: 'bg-sky-900/40 text-sky-300',
  pending: 'bg-amber-900/30 text-amber-300',
}

/** Newest-first, de-duplicated by id, capped at ROW_LIMIT. */
export function dedupeRows(rows: AuditRecord[], idField: string, tsField: string): AuditRecord[] {
  const seen = new Set<string>()
  const out: AuditRecord[] = []
  for (const r of rows) {
    const id = String(r[idField] ?? `${out.length}`)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(r)
  }
  out.sort((a, b) => Date.parse(String(b[tsField] ?? 0)) - Date.parse(String(a[tsField] ?? 0)))
  return out.slice(0, ROW_LIMIT)
}

function distinct(rows: AuditRecord[], field: string): string[] {
  const s = new Set<string>()
  for (const r of rows) {
    const v = String(r[field] ?? '')
    if (v && v !== '—') s.add(v)
  }
  return [...s].sort()
}

interface Props {
  source: AuditSource
  initialRows?: AuditRecord[]
}

export default function AuditStreamTable({ source, initialRows }: Props) {
  const [rows, setRows]       = useState<AuditRecord[]>(initialRows ?? [])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [frozen, setFrozen]   = useState(false)
  const [now, setNow]         = useState(() => Date.now())
  const [windowVal, setWindowVal] = useState('all')
  const [values, setValues]   = useState<Partial<Record<FilterKind, string>>>({})
  const [pending, setPending] = useState(0)
  const didInitialLoad = useRef(false)
  // Realtime callback is a stable closure; read live `frozen` via a ref so a
  // freeze toggle never tears down + re-subscribes the channel.
  const frozenRef = useRef(false)
  frozenRef.current = frozen
  const bufferRef = useRef<AuditRecord[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (source.kind === 'poll-endpoint' && source.endpoint) {
        const res = await fetch(source.endpoint, { signal: AbortSignal.timeout(15_000) })
        const json: unknown = await res.json()
        const mapped = source.mapResponse ? source.mapResponse(json) : []
        setRows(dedupeRows(mapped, source.idField, source.tsField))
      } else {
        const res = await fetchAuditRows(source.id)
        if (!res.ok) setError(res.error ?? 'failed to load')
        setRows(dedupeRows(res.rows, source.idField, source.tsField))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load')
    } finally {
      setLoading(false)
    }
  }, [source])

  const applyRow = useCallback((row: AuditRecord) => {
    setRows(prev => dedupeRows([row, ...prev], source.idField, source.tsField))
  }, [source])

  // Resume flushes buffered deltas accumulated while frozen.
  const toggleFreeze = useCallback(() => {
    setFrozen(prev => {
      const next = !prev
      if (!next && bufferRef.current.length > 0) {
        setRows(r => dedupeRows([...bufferRef.current, ...r], source.idField, source.tsField))
        bufferRef.current = []
        setPending(0)
      }
      return next
    })
  }, [source])

  // Initial load for table sources — skip poll sources (usePollWithBackoff
  // loads them) and skip when the server pre-seeded a default tab.
  useEffect(() => {
    if (source.kind === 'poll-endpoint') return
    if (didInitialLoad.current) return
    didInitialLoad.current = true
    if (!initialRows || initialRows.length === 0) void load()
  }, [source, initialRows, load])

  // Auto-poll poll-endpoint sources (crons, heartbeats) with backoff. Inert
  // for table sources (enabled=false) and paused while frozen.
  usePollWithBackoff(load, { intervalMs: 60_000, enabled: source.kind === 'poll-endpoint' && !frozen })

  // Live Realtime deltas (realtime sources only). Buffers while frozen for a
  // stable review surface; flushes on resume via toggleFreeze.
  useEffect(() => {
    if (!source.realtime) return
    const handle = subscribeToSource(source, row => {
      if (frozenRef.current) {
        bufferRef.current = [row, ...bufferRef.current].slice(0, ROW_LIMIT)
        setPending(bufferRef.current.length)
      } else {
        applyRow(row)
      }
    })
    return () => handle?.unsubscribe()
  }, [source, applyRow])

  // Relative-time clock. Pauses while frozen. Pure tick — no fetch.
  useEffect(() => {
    if (frozen) return
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [frozen])

  const visibleRows = useMemo(() => {
    const winMs = WINDOW_OPTIONS.find(w => w.value === windowVal)?.ms ?? null
    const cutoff = winMs ? now - winMs : null
    return rows.filter(row => {
      if (cutoff !== null) {
        const t = Date.parse(String(row[source.tsField]))
        if (!Number.isNaN(t) && t < cutoff) return false
      }
      for (const f of source.filters) {
        if (f.kind === 'window') continue
        const sel = values[f.kind]
        if (!sel) continue
        if (f.kind === 'outcome') { if (f.outcomeOf?.(row) !== sel) return false }
        else if (f.field && String(row[f.field] ?? '') !== sel) return false
      }
      return true
    })
  }, [rows, windowVal, values, now, source])

  const Icon = ICONS[source.icon] ?? Activity

  return (
    <div className="flex flex-col rounded-xl border" style={{ borderColor: '#24243e', backgroundColor: '#0a0a12' }}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: '#1a1a2e' }}>
        <Icon size={15} className="text-zinc-400 shrink-0" />
        <span className="text-sm font-semibold text-zinc-200">{source.label}</span>
        <span className="rounded-full bg-zinc-800/80 px-2 py-0.5 text-[11px] font-mono text-zinc-400">{visibleRows.length}</span>
        {source.realtime && !frozen && (
          <span title="Live — streaming via Supabase Realtime" className="flex items-center gap-1 text-[10px] text-emerald-400">
            <Radio size={11} className="animate-pulse" />live
          </span>
        )}
        {loading && <RefreshCw size={12} className="animate-spin text-zinc-500" />}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {renderFilters(source, rows, windowVal, setWindowVal, values, setValues)}
          <button
            onClick={toggleFreeze}
            title={frozen ? 'Resume live updates' : 'Freeze (pause updates while reviewing)'}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors"
            style={frozen
              ? { backgroundColor: '#1a2e1a', color: '#7dd3fc', borderColor: '#2563eb44' }
              : { backgroundColor: '#12121e', color: '#9090b0', borderColor: '#24243e' }}
          >
            {frozen ? <Play size={11} /> : <Snowflake size={11} />}
            {frozen ? (pending > 0 ? `Frozen (${pending})` : 'Frozen') : 'Freeze'}
          </button>
          <button
            onClick={() => void load()}
            disabled={loading}
            title="Refresh"
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-zinc-400 transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#12121e', borderColor: '#24243e' }}
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b px-3 py-1.5 text-[11px] text-red-300" style={{ borderColor: '#1a1a2e', backgroundColor: '#2a0a0a' }}>
          {error}
        </div>
      )}

      {/* Dense table */}
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10" style={{ backgroundColor: '#0d0d18' }}>
            <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-600">
              {source.columns.map(c => (
                <th key={c.key} className={`px-2.5 py-1.5 font-medium ${c.className ?? ''}`}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr key={String(row[source.idField] ?? i)} className="border-t hover:bg-white/[0.02]" style={{ borderColor: '#15151f' }}>
                {source.columns.map(col => {
                  const c = col.cell(row, now)
                  const tone = c.tone ?? 'default'
                  return (
                    <td key={col.key} className={`px-2.5 py-1 align-top ${col.className ?? ''}`}>
                      {c.badge
                        ? <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${TONE_BADGE[tone]}`}>{c.text}</span>
                        : <span className={`${TONE_TEXT[tone]} ${c.mono ? 'font-mono' : ''}`}>{c.text}</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
            {visibleRows.length === 0 && !loading && (
              <tr><td colSpan={source.columns.length} className="px-3 py-8 text-center text-[12px] text-zinc-600">
                No rows{rows.length > 0 ? ' match the active filters' : ' yet'}.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Filter pills row — only the kinds the source declares. */
function renderFilters(
  source: AuditSource,
  rows: AuditRecord[],
  windowVal: string,
  setWindowVal: (v: string) => void,
  values: Partial<Record<FilterKind, string>>,
  setValues: (v: Partial<Record<FilterKind, string>>) => void,
) {
  const sel = "rounded-md border px-1.5 py-1 text-[11px] text-zinc-300 outline-none"
  const selStyle = { backgroundColor: '#12121e', borderColor: '#24243e' }
  return source.filters.map(f => {
    if (f.kind === 'window') {
      return (
        <select key="window" value={windowVal} onChange={e => setWindowVal(e.target.value)} className={sel} style={selStyle}>
          {WINDOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    }
    if (f.kind === 'outcome') {
      const present = [...new Set(rows.map(r => f.outcomeOf?.(r)).filter(Boolean) as string[])]
      return (
        <select key="outcome" value={values.outcome ?? ''} onChange={e => setValues({ ...values, outcome: e.target.value || undefined })} className={sel} style={selStyle}>
          <option value="">outcome</option>
          {present.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    const opts = f.field ? distinct(rows, f.field) : []
    return (
      <select key={f.kind} value={values[f.kind] ?? ''} onChange={e => setValues({ ...values, [f.kind]: e.target.value || undefined })} className={sel} style={selStyle}>
        <option value="">{f.kind}</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  })
}

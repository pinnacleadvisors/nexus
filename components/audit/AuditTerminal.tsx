'use client'

/**
 * components/audit/AuditTerminal.tsx — the multi-pane terminal shell.
 *
 * Owns the tab list (which source panes are open + which is active),
 * persisted to localStorage. Each open pane stays mounted (hidden when
 * inactive) so it keeps its rows + Realtime subscription (Group B) and tab
 * switches are instant. Mobile (<640px): the tab strip collapses to a
 * <select> and one pane shows at a time.
 *
 * Group C adds ?layout= URL hydrate + share. v1 persists to localStorage.
 */

import { useState, useEffect, useCallback } from 'react'
import { Plus, X } from 'lucide-react'
import AuditStreamTable from './AuditStreamTable'
import { AUDIT_SOURCES, DEFAULT_TAB_IDS, getSource } from '@/lib/audit/sources'
import type { AuditRecord } from '@/lib/audit/types'

const TABS_KEY   = 'nexus:audit:tabs'
const ACTIVE_KEY = 'nexus:audit:active'

function readStoredTabs(): string[] {
  if (typeof window === 'undefined') return DEFAULT_TAB_IDS
  try {
    const raw = window.localStorage.getItem(TABS_KEY)
    if (!raw) return DEFAULT_TAB_IDS
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return DEFAULT_TAB_IDS
    const valid = parsed.filter((id): id is string => typeof id === 'string' && Boolean(getSource(id)))
    return valid.length > 0 ? valid : DEFAULT_TAB_IDS
  } catch { return DEFAULT_TAB_IDS }
}

interface Props {
  /** Server-prefetched rows for default table panes (kills first-paint flash). */
  initialData: Record<string, AuditRecord[]>
}

export default function AuditTerminal({ initialData }: Props) {
  const [tabs, setTabs]     = useState<string[]>(DEFAULT_TAB_IDS)
  const [active, setActive] = useState<string>(DEFAULT_TAB_IDS[0])
  const [hydrated, setHydrated] = useState(false)

  // Hydrate from localStorage after mount (SSR renders defaults to avoid a
  // hydration mismatch; we swap to stored tabs on the client).
  useEffect(() => {
    const stored = readStoredTabs()
    setTabs(stored)
    const storedActive = window.localStorage.getItem(ACTIVE_KEY)
    setActive(storedActive && stored.includes(storedActive) ? storedActive : stored[0])
    setHydrated(true)
  }, [])

  // Persist after hydration (don't clobber storage with the SSR default).
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(TABS_KEY, JSON.stringify(tabs))
      window.localStorage.setItem(ACTIVE_KEY, active)
    } catch { /* quota / disabled — non-fatal */ }
  }, [tabs, active, hydrated])

  const addTab = useCallback((id: string) => {
    if (!getSource(id)) return
    setTabs(prev => (prev.includes(id) ? prev : [...prev, id]))
    setActive(id)
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const next = prev.filter(t => t !== id)
      setActive(cur => (cur === id ? (next[0] ?? '') : cur))
      return next
    })
  }, [])

  const available = AUDIT_SOURCES.filter(s => !tabs.includes(s.id))

  return (
    <div className="flex flex-col gap-3">
      {/* ── Tab strip (desktop) ─────────────────────────────────────────── */}
      <div className="hidden flex-wrap items-center gap-1 sm:flex">
        {tabs.map(id => {
          const s = getSource(id)
          if (!s) return null
          const isActive = id === active
          return (
            <div
              key={id}
              className="group flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-[12px] transition-colors"
              style={isActive
                ? { color: '#e8e8f0', borderColor: '#6c63ff', backgroundColor: '#12121e' }
                : { color: '#9090b0', borderColor: 'transparent', backgroundColor: 'transparent' }}
            >
              <button onClick={() => setActive(id)} className="font-medium">{s.label}</button>
              <button
                onClick={() => closeTab(id)}
                title={`Close ${s.label}`}
                className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
        {available.length > 0 && (
          <AddPane available={available} onAdd={addTab} />
        )}
      </div>

      {/* ── Tab selector (mobile) ───────────────────────────────────────── */}
      <div className="flex items-center gap-2 sm:hidden">
        <select
          value={active}
          onChange={e => setActive(e.target.value)}
          className="flex-1 rounded-md border px-2 py-2 text-sm text-zinc-200"
          style={{ backgroundColor: '#12121e', borderColor: '#24243e' }}
        >
          {tabs.map(id => {
            const s = getSource(id)
            return s ? <option key={id} value={id}>{s.label}</option> : null
          })}
        </select>
        {available.length > 0 && <AddPane available={available} onAdd={addTab} compact />}
      </div>

      {/* ── Panes (all mounted; inactive hidden to retain state) ────────── */}
      {tabs.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-zinc-500" style={{ borderColor: '#24243e' }}>
          No panes open. Use <span className="text-zinc-300">+ Add pane</span> to start a stream.
        </div>
      ) : (
        tabs.map(id => {
          const s = getSource(id)
          if (!s) return null
          return (
            <div key={id} className={id === active ? '' : 'hidden'}>
              <AuditStreamTable source={s} initialRows={initialData[id]} />
            </div>
          )
        })
      )}
    </div>
  )
}

/** "+ Add pane" — a select of the not-yet-open sources. */
function AddPane({
  available, onAdd, compact,
}: { available: typeof AUDIT_SOURCES; onAdd: (id: string) => void; compact?: boolean }) {
  return (
    <label
      className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-[12px] text-zinc-400"
      style={{ backgroundColor: '#12121e', borderColor: '#24243e' }}
      title="Add a pane"
    >
      <Plus size={13} />
      {!compact && <span>Add pane</span>}
      <select
        value=""
        onChange={e => { if (e.target.value) onAdd(e.target.value) }}
        className="cursor-pointer bg-transparent text-zinc-400 outline-none"
        aria-label="Add pane"
      >
        <option value="">…</option>
        {available.map(s => <option key={s.id} value={s.id} className="bg-zinc-900">{s.label}</option>)}
      </select>
    </label>
  )
}

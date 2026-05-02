'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import PathView from '@/components/learn/PathView'
import { Play, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react'
import type { LearnPathUnit, LearnStats } from '@/lib/types'

interface SyncResponse {
  ok:        boolean
  inserted?: number
  reset?:    number
  archived?: number
  scanned?:  number
  skipped?:  number
  error?:    string
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const ageMs = Date.now() - new Date(iso).getTime()
  const mins  = Math.round(ageMs / 60_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export default function LearnHomePage() {
  const [units, setUnits]   = useState<LearnPathUnit[]>([])
  const [stats, setStats]   = useState<LearnStats | null>(null)
  const [loading, setLoad]  = useState(true)
  const [syncing, setSync]  = useState(false)
  const [syncMsg, setMsg]   = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function loadAll() {
    const [pathRes, statsRes] = await Promise.all([
      fetch('/api/learn/path').then(r => r.ok ? r.json() : { units: [] }),
      fetch('/api/learn/stats').then(r => r.ok ? r.json() : null),
    ])
    setUnits(pathRes.units ?? [])
    setStats(statsRes)
    setLoad(false)
  }

  useEffect(() => {
    let alive = true
    loadAll().catch(() => { if (alive) setLoad(false) })
    return () => { alive = false }
  }, [])

  async function handleSync() {
    setSync(true)
    setMsg(null)
    try {
      const res = await fetch('/api/cron/sync-learning-cards', { method: 'POST' })
      const data = (await res.json()) as SyncResponse
      if (!res.ok || !data.ok) {
        setMsg({ kind: 'err', text: data.error ?? `Sync failed (${res.status})` })
      } else {
        const parts: string[] = []
        if (data.inserted) parts.push(`${data.inserted} new`)
        if (data.reset)    parts.push(`${data.reset} reset`)
        if (data.archived) parts.push(`${data.archived} archived`)
        const summary = parts.length > 0 ? parts.join(', ') : 'no changes'
        setMsg({ kind: 'ok', text: `Synced — ${summary}` })
        await loadAll()
      }
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Network error' })
    } finally {
      setSync(false)
    }
  }

  const dueCount = units.reduce(
    (sum, u) => sum + u.lessons.filter(l => l.nextDueAt && new Date(l.nextDueAt).getTime() <= Date.now()).length,
    0,
  )
  const stale = stats?.staleCount ?? 0
  const lastSync = formatRelative(stats?.lastSyncedAt ?? null)
  const empty = !loading && units.length === 0

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: '#e8e8f0' }}>Learn</h1>
          <p className="text-sm" style={{ color: '#9090b0' }}>
            {dueCount > 0 ? `${dueCount} card${dueCount === 1 ? '' : 's'} due` : 'All caught up — nothing due'}
            {stale > 0 && (
              <span className="ml-3 inline-flex items-center gap-1" style={{ color: '#f59e0b' }}>
                <AlertTriangle size={12} /> {stale} stale
              </span>
            )}
            <span className="ml-3 text-xs" style={{ color: '#6c6c88' }}>
              · Last sync: {lastSync} · Cron: 05:00 UTC daily
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{
              backgroundColor: '#12121e',
              color:           '#c0c0d8',
              border:          '1px solid #24243e',
            }}
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <Link
            href="/learn/session"
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 font-bold"
            style={{ backgroundColor: '#6c63ff', color: '#fff' }}
          >
            <Play size={16} />
            {dueCount > 0 ? 'Start review' : 'Practice anyway'}
          </Link>
        </div>
      </div>

      {syncMsg && (
        <div
          className="rounded-lg px-4 py-3 text-sm flex items-center gap-2"
          style={
            syncMsg.kind === 'ok'
              ? { backgroundColor: '#0d1a0d', border: '1px solid #22c55e44', color: '#6c9e6c' }
              : { backgroundColor: '#1a0d0d', border: '1px solid #ef444444', color: '#c08080' }
          }
        >
          {syncMsg.kind === 'ok'
            ? <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
            : <AlertTriangle size={14} style={{ color: '#ef4444' }} />}
          {syncMsg.text}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl py-16 text-center" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
          <p className="text-sm" style={{ color: '#9090b0' }}>Loading path…</p>
        </div>
      ) : empty ? (
        <div className="rounded-xl py-12 text-center space-y-3" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
          <p className="text-sm font-medium" style={{ color: '#c0c0d8' }}>No cards yet</p>
          <p className="text-xs max-w-md mx-auto" style={{ color: '#6c6c88' }}>
            Cards are derived from atoms in <code>memory/molecular/</code>. The cron runs nightly at 05:00 UTC; click <strong>Sync now</strong> above to materialise cards immediately. If <code>mol_atoms</code> is empty, add atoms first via <code>cli.mjs atom</code>.
          </p>
        </div>
      ) : (
        <PathView units={units} />
      )}
    </div>
  )
}

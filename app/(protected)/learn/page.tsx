'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import PathView from '@/components/learn/PathView'
import { Play, AlertTriangle, RefreshCw, Loader2, CheckCircle, XCircle } from 'lucide-react'
import type { LearnPathUnit, LearnStats } from '@/lib/types'

interface SyncResult {
  ok: boolean
  inserted?: number
  reset?: number
  archived?: number
  scanned?: number
  skipped?: number
  error?: string
}

export default function LearnHomePage() {
  const [units, setUnits] = useState<LearnPathUnit[]>([])
  const [stats, setStats] = useState<LearnStats | null>(null)
  const [loading, setLoading] = useState(true)

  // Manual sync state
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)

  async function reload() {
    const [p, s] = await Promise.all([
      fetch('/api/learn/path').then(r => r.ok ? r.json() : { units: [] }),
      fetch('/api/learn/stats').then(r => r.ok ? r.json() : null),
    ])
    setUnits(p.units ?? [])
    setStats(s)
    setLoading(false)
  }

  useEffect(() => { void reload().catch(() => setLoading(false)) }, [])

  async function runSyncNow() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/cron/sync-learning-cards', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as SyncResult
      if (!res.ok) {
        setSyncResult({ ok: false, error: data.error ?? `HTTP ${res.status}` })
      } else {
        setSyncResult({ ok: true, ...data })
        await reload()
      }
    } catch (err) {
      setSyncResult({ ok: false, error: err instanceof Error ? err.message : 'network error' })
    } finally {
      setSyncing(false)
    }
  }

  const dueCount = units.reduce(
    (sum, u) => sum + u.lessons.filter(l => l.nextDueAt && new Date(l.nextDueAt).getTime() <= Date.now()).length,
    0,
  )
  const stale = stats?.staleCount ?? 0
  const lastSyncedAt = stats?.lastSyncedAt ?? null

  function formatLastSync(iso: string | null): string {
    if (!iso) return 'never'
    const ms = Date.now() - new Date(iso).getTime()
    if (ms < 60_000) return 'just now'
    if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`
    if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)}h ago`
    return `${Math.floor(ms / 86_400_000)}d ago`
  }

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
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runSyncNow}
            disabled={syncing}
            title="POST /api/cron/sync-learning-cards — reconciles flashcards against memory/molecular atoms"
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
            style={{ backgroundColor: '#12121e', color: '#e8e8f0', border: '1px solid #24243e' }}
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {syncing ? 'Syncing…' : 'Run sync now'}
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

      {/* Sync schedule + last-sync indicator (always visible) */}
      <div
        className="rounded-lg px-4 py-2.5 flex items-center justify-between flex-wrap gap-2 text-xs"
        style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#9090b0' }}
      >
        <span>
          Sync cron runs daily at <code style={{ color: '#e8e8f0' }}>05:00 UTC</code>. Last successful sync:{' '}
          <span style={{ color: lastSyncedAt ? '#4ade80' : '#f59e0b' }}>{formatLastSync(lastSyncedAt)}</span>
        </span>
        {syncResult && (
          syncResult.ok ? (
            <span className="inline-flex items-center gap-1.5" style={{ color: '#4ade80' }}>
              <CheckCircle size={12} />
              Synced — inserted {syncResult.inserted ?? 0} · reset {syncResult.reset ?? 0} · archived {syncResult.archived ?? 0} · scanned {syncResult.scanned ?? 0}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5" style={{ color: '#ef4444' }}>
              <XCircle size={12} />
              Sync failed: {syncResult.error}
            </span>
          )
        )}
      </div>

      {loading ? (
        <div className="rounded-xl py-16 text-center" style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}>
          <p className="text-sm" style={{ color: '#9090b0' }}>Loading path…</p>
        </div>
      ) : (
        <PathView units={units} />
      )}
    </div>
  )
}

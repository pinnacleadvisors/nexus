'use client'

/**
 * Admin "Clean orphans now" card.
 *
 * Two-stage destructive action:
 *  1. Click "Preview" → POST /api/cron/sweep-orphan-cards?dryRun=1, render counts
 *  2. Click "Run sweep" → POST without dryRun, render confirmed counts
 *
 * Mounted on /manage-platform. Server-side path lives in
 * lib/runs/orphan-sweeper.ts and is also wired to the nightly cron at 04:30 UTC.
 */

import { useState } from 'react'
import { Trash2, Loader2, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'

interface SweepResponse {
  ok:               boolean
  scanned?:         number
  archivedLegacy?:  number
  archivedRunDone?: number
  hardDeleted?:     number
  dryRun?:          boolean
  error?:           string
}

export default function OrphanSweepCard() {
  const [busy,    setBusy]    = useState<'preview' | 'run' | null>(null)
  const [preview, setPreview] = useState<SweepResponse | null>(null)
  const [result,  setResult]  = useState<SweepResponse | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  async function fetchSweep(dry: boolean): Promise<SweepResponse | null> {
    const url = `/api/cron/sweep-orphan-cards${dry ? '?dryRun=1' : ''}`
    try {
      const res = await fetch(url, { method: 'POST', credentials: 'include' })
      const data = (await res.json().catch(() => ({}))) as SweepResponse
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        return null
      }
      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error')
      return null
    }
  }

  async function handlePreview() {
    setBusy('preview'); setError(null); setResult(null)
    const data = await fetchSweep(true)
    setPreview(data)
    setBusy(null)
  }

  async function handleRun() {
    setBusy('run'); setError(null)
    const data = await fetchSweep(false)
    setResult(data)
    if (data?.ok) setPreview(null)
    setBusy(null)
  }

  const totalToTouch = (preview?.archivedLegacy ?? 0) + (preview?.archivedRunDone ?? 0) + (preview?.hardDeleted ?? 0)

  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Trash2 size={16} style={{ color: '#f59e0b' }} />
          <h3 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Clean orphan board cards</h3>
        </div>
        <span className="text-xs" style={{ color: '#55556a' }}>nightly @ 04:30 UTC</span>
      </div>

      <p className="text-xs mb-3" style={{ color: '#9090b0' }}>
        Soft-archives Board cards whose lineage points to nothing — pre-mig-025 legacy cards,
        cards from runs that finished &gt;14d ago. Hard-deletes rows that have been archived &gt;7d.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handlePreview}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
          style={{ backgroundColor: '#12121e', color: '#e8e8f0', border: '1px solid #24243e' }}
        >
          {busy === 'preview' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Preview (dry run)
        </button>
        {preview?.ok && totalToTouch > 0 && (
          <button
            onClick={handleRun}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{ backgroundColor: '#ef4444', color: '#fff' }}
          >
            {busy === 'run' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Confirm — sweep {totalToTouch} card{totalToTouch === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {preview?.ok && (
        <div className="mt-3 text-xs grid grid-cols-3 gap-2" style={{ color: '#c0c0d0' }}>
          <span><b style={{ color: '#f59e0b' }}>{preview.archivedLegacy ?? 0}</b> legacy unanchored</span>
          <span><b style={{ color: '#f59e0b' }}>{preview.archivedRunDone ?? 0}</b> finished-run cards</span>
          <span><b style={{ color: '#ef4444' }}>{preview.hardDeleted ?? 0}</b> to hard-delete</span>
        </div>
      )}

      {preview?.ok && totalToTouch === 0 && (
        <div className="mt-3 inline-flex items-center gap-1.5 text-xs" style={{ color: '#4ade80' }}>
          <CheckCircle2 size={12} /> No orphans found — board is clean.
        </div>
      )}

      {result?.ok && (
        <div
          className="mt-3 rounded-md p-2 text-xs flex items-start gap-1.5"
          style={{ backgroundColor: '#0d2e1a', color: '#4ade80', border: '1px solid #22c55e44' }}
        >
          <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
          <span>
            Swept · archived {(result.archivedLegacy ?? 0) + (result.archivedRunDone ?? 0)} ·
            hard-deleted {result.hardDeleted ?? 0}
          </span>
        </div>
      )}

      {error && (
        <div
          className="mt-3 rounded-md p-2 text-xs flex items-start gap-1.5"
          style={{ backgroundColor: '#2a1116', color: '#ff7a90', border: '1px solid #ff4d6d44' }}
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

'use client'

/**
 * HealthPanel — the visible-failure surface for /manage-platform.
 *
 * Two responsibilities:
 *   1. Cron health table (from /api/health/cron) — green/amber/red verdicts
 *      so the operator notices when a scheduled job stops running.
 *   2. Orphan-card sweep — dry-run preview, then confirm-delete via
 *      /api/cron/sweep-orphan-cards. Mirrors the nightly cron but lets the
 *      owner run it on demand.
 *
 * Pure client component, hits owner-only endpoints. Self-contained styling so
 * it can be embedded inside the existing Build console layout.
 */

import { useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  XCircle,
  HelpCircle,
  Zap,
} from 'lucide-react'

interface CronStatus {
  path:        string
  schedule:    string
  description: string
  lastRunAt:   string | null
  lastStatus:  number | null
  ageMinutes:  number | null
  verdict:     'green' | 'amber' | 'red' | 'unknown'
  detail:      string
}

interface SweepSample {
  id:         string
  title:      string | null
  reason:     string
  column_id:  string
  updated_at: string
}

interface SweepResponse {
  ok:        boolean
  dryRun?:   boolean
  total:     number
  deleted?:  number
  byReason:  Record<string, number>
  sample:    SweepSample[]
  warnings?: string[]
  error?:    string
}

const VERDICT_STYLE: Record<CronStatus['verdict'], { bg: string; color: string; label: string; icon: typeof CheckCircle2 }> = {
  green:   { bg: '#0d1a0d', color: '#22c55e', label: 'OK',       icon: CheckCircle2  },
  amber:   { bg: '#1a1408', color: '#f59e0b', label: 'Stale',    icon: AlertTriangle },
  red:     { bg: '#1a0d0d', color: '#ef4444', label: 'Failing',  icon: XCircle       },
  unknown: { bg: '#12121e', color: '#6c6c88', label: 'Unknown',  icon: HelpCircle    },
}

interface RunResponse {
  ok:          boolean
  status?:     number
  duration_ms?: number
  response?:   unknown
  error?:      string
  targetPath?: string
}

export default function HealthPanel() {
  const [crons, setCrons]         = useState<CronStatus[] | null>(null)
  const [cronLoading, setCronLoading] = useState(true)
  const [cronError, setCronError] = useState<string | null>(null)

  // Per-cron manual trigger: which cron path is currently running, plus the
  // last result for each (success/failure summary shown inline next to the
  // verdict pill).
  const [runningPath, setRunningPath] = useState<string | null>(null)
  const [runResults, setRunResults]   = useState<Record<string, { ok: boolean; status?: number; ms?: number; error?: string; at: number }>>({})

  const [sweepPreview, setSweepPreview] = useState<SweepResponse | null>(null)
  const [sweepLoading, setSweepLoading] = useState(false)
  const [sweepDeleting, setSweepDeleting] = useState(false)
  const [sweepResult, setSweepResult] = useState<SweepResponse | null>(null)
  const [sweepError, setSweepError] = useState<string | null>(null)

  async function loadCrons() {
    setCronLoading(true)
    setCronError(null)
    try {
      const res = await fetch('/api/health/cron')
      if (!res.ok) {
        setCronError(`Health check failed (${res.status})`)
        setCrons(null)
      } else {
        const data = await res.json() as { ok: boolean; jobs: CronStatus[] }
        setCrons(data.jobs ?? [])
      }
    } catch (err) {
      setCronError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setCronLoading(false)
    }
  }

  useEffect(() => { void loadCrons() }, [])

  async function handleRunCron(path: string) {
    setRunningPath(path)
    try {
      const res = await fetch('/api/health/cron/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ path }),
      })
      let data: RunResponse | null = null
      try { data = (await res.json()) as RunResponse } catch { /* response wasn't JSON */ }
      setRunResults(prev => ({
        ...prev,
        [path]: {
          ok:     res.ok && (data?.ok ?? false),
          status: data?.status ?? res.status,
          ms:     data?.duration_ms,
          error:  res.ok && data?.ok ? undefined : (data?.error ?? `HTTP ${res.status}`),
          at:     Date.now(),
        },
      }))
      // Refresh the panel so the cron's new last-run timestamp shows up
      // (assuming Vercel log-drain is wired — otherwise verdict stays Unknown
      // but the inline run result still confirms it executed).
      void loadCrons()
    } catch (err) {
      setRunResults(prev => ({
        ...prev,
        [path]: {
          ok:    false,
          error: err instanceof Error ? err.message : 'Network error',
          at:    Date.now(),
        },
      }))
    } finally {
      setRunningPath(null)
    }
  }

  async function handlePreviewSweep() {
    setSweepLoading(true)
    setSweepError(null)
    setSweepResult(null)
    try {
      const res = await fetch('/api/cron/sweep-orphan-cards?dryRun=1', { method: 'POST' })
      const data = (await res.json()) as SweepResponse
      if (!res.ok || !data.ok) {
        setSweepError(data.error ?? `Preview failed (${res.status})`)
      } else {
        setSweepPreview(data)
      }
    } catch (err) {
      setSweepError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSweepLoading(false)
    }
  }

  async function handleConfirmSweep() {
    if (!sweepPreview || sweepPreview.total === 0) return
    setSweepDeleting(true)
    setSweepError(null)
    try {
      const res = await fetch('/api/cron/sweep-orphan-cards', { method: 'POST' })
      const data = (await res.json()) as SweepResponse
      if (!res.ok || !data.ok) {
        setSweepError(data.error ?? `Sweep failed (${res.status})`)
      } else {
        setSweepResult(data)
        setSweepPreview(null)
      }
    } catch (err) {
      setSweepError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSweepDeleting(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Cron health ───────────────────────────────────────────────────── */}
      <section className="rounded-xl border" style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}>
        <header className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: '#1a1a2e' }}>
          <div className="flex items-center gap-2">
            <Activity size={16} style={{ color: '#6c63ff' }} />
            <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Cron jobs</h2>
            <span className="text-xs" style={{ color: '#6c6c88' }}>vercel.json schedule</span>
          </div>
          <button
            onClick={() => void loadCrons()}
            disabled={cronLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-opacity disabled:opacity-50"
            style={{ backgroundColor: '#12121e', color: '#9090b0', border: '1px solid #1a1a2e' }}
          >
            <RefreshCw size={12} className={cronLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </header>

        {cronError && (
          <div className="px-5 py-3 text-sm" style={{ color: '#c08080' }}>
            {cronError}
          </div>
        )}

        {!cronError && (
          <div className="divide-y" style={{ borderColor: '#1a1a2e' }}>
            {(crons ?? []).map(c => {
              const style    = VERDICT_STYLE[c.verdict]
              const Icon     = style.icon
              const isRunning = runningPath === c.path
              const lastRun  = runResults[c.path]
              return (
                <div key={c.path} className="px-5 py-3 grid gap-3 grid-cols-12 items-start">
                  <div
                    className="col-span-2 flex items-center gap-2 px-2 py-1 rounded text-xs font-medium self-center"
                    style={{ backgroundColor: style.bg, color: style.color, border: `1px solid ${style.color}33` }}
                  >
                    <Icon size={12} />
                    {style.label}
                  </div>
                  <div className="col-span-5">
                    <code className="text-xs font-mono block break-all" style={{ color: '#e8e8f0' }}>{c.path}</code>
                    <p className="text-xs mt-0.5" style={{ color: '#6c6c88' }}>{c.description}</p>
                    <p className="text-xs mt-0.5" style={{ color: '#9090b0' }}>{c.detail}</p>
                    {lastRun && (
                      <p
                        className="text-xs mt-1 inline-flex items-center gap-1"
                        style={{ color: lastRun.ok ? '#22c55e' : '#ef4444' }}
                      >
                        {lastRun.ok
                          ? <CheckCircle2 size={11} />
                          : <XCircle size={11} />}
                        {lastRun.ok
                          ? `Manual run OK${lastRun.ms ? ` (${lastRun.ms}ms)` : ''}`
                          : `Manual run failed: ${lastRun.error ?? 'unknown'}`}
                      </p>
                    )}
                  </div>
                  <div className="col-span-2 text-xs self-center" style={{ color: '#9090b0' }}>
                    <code className="font-mono">{c.schedule}</code>
                  </div>
                  <div className="col-span-3 self-center flex justify-end">
                    <button
                      onClick={() => void handleRunCron(c.path)}
                      disabled={isRunning || runningPath !== null}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-opacity disabled:opacity-50"
                      style={{ backgroundColor: '#1a1a2e', color: '#c0c0d8', border: '1px solid #24243e' }}
                      title={`POST ${c.path} via /api/health/cron/run`}
                    >
                      {isRunning
                        ? <><Loader2 size={11} className="animate-spin" />Running…</>
                        : <><Zap size={11} />Run now</>}
                    </button>
                  </div>
                </div>
              )
            })}
            {!cronLoading && (crons ?? []).length === 0 && (
              <p className="px-5 py-4 text-sm" style={{ color: '#6c6c88' }}>No crons configured.</p>
            )}
          </div>
        )}
      </section>

      {/* ── Orphan-card sweep ─────────────────────────────────────────────── */}
      <section className="rounded-xl border" style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}>
        <header className="px-5 py-4 border-b flex items-start justify-between gap-4" style={{ borderColor: '#1a1a2e' }}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Trash2 size={16} style={{ color: '#f59e0b' }} />
              <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Orphan-card sweep</h2>
            </div>
            <p className="text-xs max-w-2xl" style={{ color: '#9090b0' }}>
              Detects Kanban cards whose parent run was deleted, plus legacy backlog cards that
              haven&apos;t been touched in 30+ days and have no business / idea / run linkage.
              Nightly cron runs at 04:30 UTC; click below to run on demand.
            </p>
          </div>
          <button
            onClick={() => void handlePreviewSweep()}
            disabled={sweepLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-opacity disabled:opacity-50 shrink-0"
            style={{ backgroundColor: '#12121e', color: '#c0c0d8', border: '1px solid #24243e' }}
          >
            {sweepLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Preview
          </button>
        </header>

        {sweepError && (
          <div className="px-5 py-3 text-sm flex items-center gap-2"
               style={{ color: '#c08080', backgroundColor: '#1a0d0d', borderTop: '1px solid #ef444433' }}>
            <AlertTriangle size={13} />
            {sweepError}
          </div>
        )}

        {sweepPreview && (
          <div className="px-5 py-4 space-y-3">
            {(sweepPreview.warnings ?? []).length > 0 && (
              <div
                className="rounded border p-3 text-xs space-y-1"
                style={{ backgroundColor: '#1a1408', borderColor: '#f59e0b33', color: '#f59e0b' }}
              >
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle size={12} /> Sweep ran with warnings
                </p>
                {sweepPreview.warnings!.map((w, i) => (
                  <p key={i} className="pl-5" style={{ color: '#c08854' }}>{w}</p>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm" style={{ color: '#e8e8f0' }}>
                  <strong>{sweepPreview.total}</strong> orphan card{sweepPreview.total === 1 ? '' : 's'} detected
                </p>
                {sweepPreview.total === 0 && (
                  <p className="text-xs mt-0.5" style={{ color: '#6c6c88' }}>
                    Either there are no stale cards (legacy heuristic requires &gt;30 days untouched and no business / idea / run linkage), or migration 025 isn&apos;t applied yet.
                  </p>
                )}
                {Object.entries(sweepPreview.byReason).length > 0 && (
                  <p className="text-xs mt-0.5" style={{ color: '#6c6c88' }}>
                    {Object.entries(sweepPreview.byReason)
                      .map(([reason, n]) => `${n}× ${reason.replace(/_/g, ' ')}`)
                      .join(' · ')}
                  </p>
                )}
              </div>
              {sweepPreview.total > 0 && (
                <button
                  onClick={() => void handleConfirmSweep()}
                  disabled={sweepDeleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-opacity disabled:opacity-50"
                  style={{ backgroundColor: '#ef4444', color: '#fff' }}
                >
                  {sweepDeleting
                    ? <><Loader2 size={12} className="animate-spin" />Deleting…</>
                    : <><Trash2 size={12} />Confirm delete {sweepPreview.total}</>}
                </button>
              )}
            </div>

            {sweepPreview.sample.length > 0 && (
              <div className="rounded border" style={{ borderColor: '#1a1a2e' }}>
                <p className="px-3 py-2 text-xs" style={{ color: '#6c6c88', borderBottom: '1px solid #1a1a2e' }}>
                  Sample (first {sweepPreview.sample.length})
                </p>
                <ul className="divide-y" style={{ borderColor: '#1a1a2e' }}>
                  {sweepPreview.sample.map(s => (
                    <li key={s.id} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                      <span style={{ color: '#c0c0d8' }} className="truncate">{s.title ?? '(untitled)'}</span>
                      <span style={{ color: '#6c6c88' }} className="shrink-0">
                        {s.column_id} · {s.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {sweepResult && (
          <div className="px-5 py-4 flex items-center gap-2 text-sm"
               style={{ color: '#6c9e6c', backgroundColor: '#0d1a0d', borderTop: '1px solid #22c55e33' }}>
            <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
            Deleted {sweepResult.deleted ?? sweepResult.total} card{(sweepResult.deleted ?? sweepResult.total) === 1 ? '' : 's'}.
          </div>
        )}
      </section>
    </div>
  )
}

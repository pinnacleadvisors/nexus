'use client'

/**
 * Unified system-health panel. Single surface for the operator to see
 * everything that's currently broken — cron freshness, gateway status,
 * webhook health, failed runs, today's spend.
 *
 * Mounted on /manage-platform. Mission Control surfaces a small badge
 * (FailureBadge) that links here when count > 0.
 */

import { useEffect, useState } from 'react'
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw,
  WifiOff, ChevronDown, ChevronRight,
} from 'lucide-react'

interface CronJob {
  name:               string
  route:              string
  lastRunAt:          string | null
  lastStatus:         number | null
  lastLevel:          string | null
  lastDurationMs:     number | null
  lastMessagePreview: string | null
  ageMinutes:         number | null
  expectedWindowMin:  number
  isStale:            boolean
  isFailing:          boolean
}

interface CronResp { jobs: CronJob[]; reason?: string; generatedAt?: string }

const POLL_MS = 30_000

function fmtAge(min: number | null): string {
  if (min === null) return 'never'
  if (min < 1)    return 'just now'
  if (min < 60)   return `${min}m ago`
  if (min < 1440) return `${Math.floor(min / 60)}h ago`
  return `${Math.floor(min / 1440)}d ago`
}

export default function HealthPanel() {
  const [jobs,    setJobs]    = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState<string | null>(null)
  const [open,    setOpen]    = useState(true)

  async function load() {
    try {
      const res = await fetch('/api/health/cron', { cache: 'no-store' })
      const data = (await res.json()) as CronResp & { error?: string }
      if (!res.ok) {
        setErr(data.error ?? `HTTP ${res.status}`)
        return
      }
      setJobs(data.jobs ?? [])
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'network error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [])

  const stale  = jobs.filter(j => j.isStale).length
  const failing = jobs.filter(j => j.isFailing).length
  const allGreen = stale === 0 && failing === 0 && jobs.length > 0

  return (
    <div className="rounded-xl" style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3"
        style={{ color: '#e8e8f0' }}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Activity size={14} style={{ color: '#6c63ff' }} />
          <h3 className="text-sm font-semibold">System health</h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {allGreen && (
            <span className="inline-flex items-center gap-1" style={{ color: '#4ade80' }}>
              <CheckCircle2 size={12} /> All systems nominal
            </span>
          )}
          {failing > 0 && (
            <span className="inline-flex items-center gap-1" style={{ color: '#ef4444' }}>
              <AlertTriangle size={12} /> {failing} failing
            </span>
          )}
          {stale > 0 && (
            <span className="inline-flex items-center gap-1" style={{ color: '#f59e0b' }}>
              <Clock size={12} /> {stale} stale
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); void load() }}
            className="rounded-md p-1"
            style={{ color: '#9090b0' }}
            title="Refresh now"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-3">
          {err && (
            <div
              className="mb-2 rounded-md p-2 text-xs flex items-center gap-1.5"
              style={{ backgroundColor: '#2a1116', color: '#ff7a90', border: '1px solid #ff4d6d44' }}
            >
              <WifiOff size={12} /> {err}
            </div>
          )}

          {/* Cron freshness rows */}
          <div className="space-y-1.5">
            {jobs.map(j => {
              const fg = j.isFailing ? '#ef4444' : j.isStale ? '#f59e0b' : '#4ade80'
              const Icon = j.isFailing ? AlertTriangle : j.isStale ? Clock : CheckCircle2
              return (
                <div
                  key={j.name}
                  className="rounded-md px-2.5 py-1.5 flex items-center gap-2 text-xs"
                  style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
                >
                  <Icon size={12} style={{ color: fg, flexShrink: 0 }} />
                  <code className="flex-1 truncate" style={{ color: '#e8e8f0' }}>{j.name}</code>
                  <span style={{ color: '#9090b0' }}>{fmtAge(j.ageMinutes)}</span>
                  <span style={{ color: '#55556a' }}>· expect ≤ {j.expectedWindowMin}m</span>
                  {j.lastDurationMs !== null && (
                    <span style={{ color: '#55556a' }}>· {Math.round(j.lastDurationMs)}ms</span>
                  )}
                  {j.isFailing && j.lastMessagePreview && (
                    <span className="truncate max-w-[40%]" title={j.lastMessagePreview} style={{ color: '#ff7a90' }}>
                      {j.lastMessagePreview}
                    </span>
                  )}
                </div>
              )
            })}
            {jobs.length === 0 && !loading && (
              <div className="text-xs py-2" style={{ color: '#55556a' }}>
                No cron data yet — run a cron once (or wait for the schedule) to populate.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

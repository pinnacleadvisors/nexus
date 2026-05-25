'use client'

import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, X, CheckCircle2, AlertTriangle, XCircle, HelpCircle, RefreshCw } from 'lucide-react'

interface CronStatus {
  job_id:           number
  title:            string
  enabled:          boolean
  last_status:      number
  last_status_text: 'ok' | 'fail' | 'never_run'
  last_execution:   string | null
  next_execution:   string | null
  health:           'green' | 'yellow' | 'red' | 'unknown'
}

export default function CronHealthClient() {
  const [jobs, setJobs]       = useState<CronStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/cron-health/status', { cache: 'no-store' })
      const json = (await res.json()) as { ok: boolean; jobs?: CronStatus[]; error?: string }
      if (!json.ok) throw new Error(json.error || 'load failed')
      setJobs(json.jobs ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }
  useEffect(() => { void load() }, [])

  // Summary counts by health bucket.
  const reds    = jobs.filter(j => j.health === 'red' || !j.enabled).length
  const yellows = jobs.filter(j => j.enabled && j.health === 'yellow').length
  const greens  = jobs.filter(j => j.enabled && j.health === 'green').length
  const unknown = jobs.filter(j => j.enabled && j.health === 'unknown').length

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm px-4 py-3"
           style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px' }}>
        <Loader2 size={14} className="animate-spin" /> Loading cron health…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {err && (
        <div className="px-3.5 py-2.5 flex items-start gap-2.5 text-sm"
             style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)', borderRadius: '14px', color: '#e8e8f0' }}>
          <AlertCircle size={16} style={{ color: '#f87171' }} />
          <div className="flex-1">{err}</div>
          <button onClick={() => setErr(null)} className="rounded-md p-0.5" style={{ color: '#9090b0' }}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <SummaryChip label="Red / disabled" count={reds}    icon={<XCircle size={11} />} color="#f87171" bg="rgba(239,68,68,0.10)" border="rgba(239,68,68,0.22)" />
        <SummaryChip label="Yellow"          count={yellows} icon={<AlertTriangle size={11} />} color="#fbbf24" bg="rgba(251,191,36,0.10)" border="rgba(251,191,36,0.22)" />
        <SummaryChip label="Green"           count={greens}  icon={<CheckCircle2 size={11} />} color="#4ade80" bg="rgba(34,197,94,0.10)"  border="rgba(34,197,94,0.22)" />
        <SummaryChip label="Never run yet"   count={unknown} icon={<HelpCircle size={11} />}   color="#9090b0" bg="rgba(255,255,255,0.03)" border="rgba(255,255,255,0.06)" />
        <button type="button" onClick={() => void load(true)} disabled={refreshing}
                className="ml-auto text-[11px] px-2 py-1 rounded-md inline-flex items-center gap-1"
                style={{ color: '#e8e8f0', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Refresh
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm rounded-2xl"
             style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          No "Nexus:" cron entries found on cron-job.org. Run <span className="font-mono" style={{ color: '#a8a3ff' }}>scripts/migrate-crons-to-cronjob-org.mjs --apply</span> or <span className="font-mono" style={{ color: '#a8a3ff' }}>scripts/sync-crons-hmem.mjs --apply</span> to register them.
        </div>
      ) : (
        <ul className="space-y-2">
          {jobs.map(j => <CronRow key={j.job_id} job={j} />)}
        </ul>
      )}
    </div>
  )
}

function SummaryChip({ label, count, icon, color, bg, border }: { label: string; count: number; icon: React.ReactNode; color: string; bg: string; border: string }) {
  return (
    <div className="text-[11px] px-2 py-1 rounded-md inline-flex items-center gap-1.5"
         style={{ color, background: bg, border: `1px solid ${border}` }}>
      {icon}
      <span style={{ color: '#e8e8f0' }}>{count}</span>
      <span>{label}</span>
    </div>
  )
}

function CronRow({ job }: { job: CronStatus }) {
  const healthMeta = {
    red:     { color: '#f87171', label: 'RED',     bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.22)' },
    yellow:  { color: '#fbbf24', label: 'YELLOW',  bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.22)' },
    green:   { color: '#4ade80', label: 'GREEN',   bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.22)' },
    unknown: { color: '#9090b0', label: 'NEW',     bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)' },
  }[job.health]

  const lastRun = job.last_execution ? new Date(job.last_execution).toLocaleString() : 'never'
  const nextRun = job.next_execution ? new Date(job.next_execution).toLocaleString() : 'n/a'

  return (
    <li className="rounded-2xl p-3 flex items-center gap-3 flex-wrap"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
                 border:     '1px solid rgba(255,255,255,0.08)' }}>
      <div className="min-w-0 flex-1">
        <div className="text-sm" style={{ color: '#e8e8f0' }}>{job.title.replace(/^Nexus:\s*/, '')}</div>
        <div className="mt-1 flex items-center gap-2 text-[11px] flex-wrap" style={{ color: '#9090b0' }}>
          <span>last: {job.last_status === 0 ? 'never' : job.last_status} · {lastRun}</span>
          <span style={{ color: '#55556a' }}>·</span>
          <span>next: {nextRun}</span>
          {!job.enabled && (
            <>
              <span style={{ color: '#55556a' }}>·</span>
              <span style={{ color: '#f87171' }}>disabled (likely auto-disabled by cron-job.org after repeated failures)</span>
            </>
          )}
        </div>
      </div>
      <span className="text-[9px] font-mono tracking-[0.12em] px-1.5 py-0.5 rounded-full shrink-0"
            style={{ color: healthMeta.color, background: healthMeta.bg, border: `1px solid ${healthMeta.border}` }}>
        {healthMeta.label}
      </span>
    </li>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertCircle, X, CheckCircle2, AlertTriangle, XCircle, HelpCircle, RefreshCw, Play, Pencil, Check, Clock, Building2 } from 'lucide-react'
import { usePollWithBackoff } from '@/lib/hooks/usePollWithBackoff'
import { cronStringToSchedule, validateCronString } from '@/lib/cron/parse'

interface CronStatus {
  job_id:           number
  title:            string
  enabled:          boolean
  url:              string
  schedule_cron:    string
  last_status:      number
  last_status_text: 'ok' | 'fail' | 'never_run'
  last_execution:   string | null
  next_execution:   string | null
  health:           'green' | 'yellow' | 'red' | 'unknown'
}

/** Scrub `secret=<...>` so the URL is safe to render. */
function scrubSecret(url: string): string {
  return url.replace(/([?&]secret=)[^&]+/i, '$1<redacted>')
}

export default function CronHealthClient() {
  const [jobs, setJobs]       = useState<CronStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [enabling, setEnabling] = useState<number | null>(null)

  // Pollable fetcher — used by both the auto-poll hook AND the manual
  // refresh button. Throws on failure so usePollWithBackoff counts it.
  const fetcher = useCallback(async () => {
    const res = await fetch('/api/cron-health/status', { cache: 'no-store' })
    const json = (await res.json()) as { ok: boolean; jobs?: CronStatus[]; error?: string }
    if (!json.ok) throw new Error(json.error || 'load failed')
    setJobs(json.jobs ?? [])
    setErr(null)
  }, [])

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try { await fetcher() }
    catch (e) { setErr(e instanceof Error ? e.message : 'load failed') }
    finally { setLoading(false); setRefreshing(false) }
  }
  useEffect(() => { void load() }, [])
  // Auto-poll every 60s. Hook pauses on consecutive failures so a broken
  // cron-job.org API key doesn't spam the dashboard. Manual refresh button
  // still works via retry().
  const poll = usePollWithBackoff(fetcher, { intervalMs: 60_000, maxConsecutiveFailures: 5 })

  /** v10 — update a job's schedule. Cron string is parsed client-side
   *  via cronStringToSchedule(); the v9 /update endpoint accepts the
   *  schedule shape unchanged. Surfaces parse errors inline. */
  async function updateJobSchedule(jobId: number, cronString: string) {
    let schedule
    try { schedule = cronStringToSchedule(cronString) }
    catch (e) { setErr(e instanceof Error ? e.message : 'invalid cron string'); return }
    setEnabling(jobId); setErr(null)
    try {
      const res = await fetch(`/api/cron-health/jobs/${jobId}/update`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ schedule }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (!json.ok) throw new Error(json.error || 'schedule update failed')
      await fetcher()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'schedule update failed')
    } finally { setEnabling(null) }
  }

  /** v9 — update a job's URL via the cron-health update proxy. Used after
   *  CRON_SECRET rotation or when migrating a route. Refetches after success. */
  async function updateJobUrl(jobId: number, url: string) {
    setEnabling(jobId); setErr(null)
    try {
      const res = await fetch(`/api/cron-health/jobs/${jobId}/update`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ url }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (!json.ok) throw new Error(json.error || 'update failed')
      await fetcher()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'update failed')
    } finally {
      setEnabling(null)
    }
  }

  /** Inline re-enable for disabled jobs — calls cron-job.org PATCH via our
   *  proxy route. After success, refetch so the row flips green-or-yellow
   *  depending on the next scheduled run. */
  async function enableJob(jobId: number) {
    setEnabling(jobId); setErr(null)
    try {
      const res = await fetch(`/api/cron-health/jobs/${jobId}/enable`, { method: 'POST' })
      const json = (await res.json()) as { ok: boolean; error?: string }
      if (!json.ok) throw new Error(json.error || 'enable failed')
      // Refetch — easier than mutating local state when the upstream's
      // schedule + next_execution changed too.
      await fetcher()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'enable failed')
    } finally {
      setEnabling(null)
    }
  }

  // v10 — parse Nexus[<slug>]: titles into bucket keys (admin vs business slug)
  //        and let the operator filter the row list by bucket.
  function bucketFor(j: CronStatus): string {
    const m = j.title.match(/^Nexus\[([a-z0-9-]+)\]:/)
    return m ? m[1] : 'admin'
  }
  const [scopeFilter, setScopeFilter] = useState<string>('all')
  const scopeBuckets = useMemo(() => {
    const set = new Set<string>()
    for (const j of jobs) set.add(bucketFor(j))
    return ['all', ...[...set].sort()]
  }, [jobs])
  const visibleJobs = useMemo(() => {
    if (scopeFilter === 'all') return jobs
    return jobs.filter(j => bucketFor(j) === scopeFilter)
  }, [jobs, scopeFilter])

  // Summary counts use the FILTERED job set so the chips reflect what the
  // operator is currently looking at.
  const reds    = visibleJobs.filter(j => j.health === 'red' || !j.enabled).length
  const yellows = visibleJobs.filter(j => j.enabled && j.health === 'yellow').length
  const greens  = visibleJobs.filter(j => j.enabled && j.health === 'green').length
  const unknown = visibleJobs.filter(j => j.enabled && j.health === 'unknown').length

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

      {scopeBuckets.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Building2 size={11} style={{ color: '#9090b0' }} />
          <span className="text-[11px]" style={{ color: '#9090b0' }}>scope:</span>
          {scopeBuckets.map(b => {
            const active = scopeFilter === b
            const count  = b === 'all' ? jobs.length : jobs.filter(j => bucketFor(j) === b).length
            const label  = b === 'all'   ? `All (${count})`
                         : b === 'admin' ? `Admin (${count})`
                         :                 `${b} (${count})`
            return (
              <button key={b} type="button" onClick={() => setScopeFilter(b)}
                      className="text-[11px] px-2 py-0.5 rounded-md"
                      style={active
                        ? { color: '#e8e8f0', background: 'rgba(108,99,255,0.15)', border: '1px solid rgba(108,99,255,0.30)' }
                        : { color: '#9090b0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                {label}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <SummaryChip label="Red / disabled" count={reds}    icon={<XCircle size={11} />} color="#f87171" bg="rgba(239,68,68,0.10)" border="rgba(239,68,68,0.22)" />
        <SummaryChip label="Yellow"          count={yellows} icon={<AlertTriangle size={11} />} color="#fbbf24" bg="rgba(251,191,36,0.10)" border="rgba(251,191,36,0.22)" />
        <SummaryChip label="Green"           count={greens}  icon={<CheckCircle2 size={11} />} color="#4ade80" bg="rgba(34,197,94,0.10)"  border="rgba(34,197,94,0.22)" />
        <SummaryChip label="Never run yet"   count={unknown} icon={<HelpCircle size={11} />}   color="#9090b0" bg="rgba(255,255,255,0.03)" border="rgba(255,255,255,0.06)" />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px]" style={{ color: poll.paused ? '#f87171' : '#9090b0' }}>
            {poll.paused ? `auto-poll paused after ${poll.consecutiveFailures} fail(s)` : 'auto-poll every 60s'}
          </span>
          <button type="button" onClick={() => { void load(true); poll.retry() }} disabled={refreshing}
                  className="text-[11px] px-2 py-1 rounded-md inline-flex items-center gap-1"
                  style={{ color: '#e8e8f0', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Refresh
          </button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm rounded-2xl"
             style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          No "Nexus:" cron entries found on cron-job.org. Run <span className="font-mono" style={{ color: '#a8a3ff' }}>scripts/migrate-crons-to-cronjob-org.mjs --apply</span> or <span className="font-mono" style={{ color: '#a8a3ff' }}>scripts/sync-crons-hmem.mjs --apply</span> to register them.
        </div>
      ) : (
        <ul className="space-y-2">
          {visibleJobs.map(j => (
            <CronRow
              key={j.job_id}
              job={j}
              enabling={enabling === j.job_id}
              onEnable={() => void enableJob(j.job_id)}
              onUpdateUrl={url => void updateJobUrl(j.job_id, url)}
              onUpdateSchedule={cron => void updateJobSchedule(j.job_id, cron)}
            />
          ))}
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

function CronRow({ job, enabling, onEnable, onUpdateUrl, onUpdateSchedule }: {
  job:              CronStatus
  enabling:         boolean
  onEnable:         () => void
  onUpdateUrl:      (url: string) => void
  onUpdateSchedule: (cron: string) => void
}) {
  const [editing, setEditing]         = useState(false)
  const [draftUrl, setDraftUrl]       = useState(job.url)
  // v10 schedule editor state.
  const [editingSched, setEditingSched] = useState(false)
  const [draftCron, setDraftCron]       = useState(job.schedule_cron)
  const cronErr = useMemo(() => editingSched ? validateCronString(draftCron) : null, [editingSched, draftCron])
  useEffect(() => { if (!editing)      setDraftUrl(job.url)            }, [job.url, editing])
  useEffect(() => { if (!editingSched) setDraftCron(job.schedule_cron) }, [job.schedule_cron, editingSched])
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
        {/* v9 — inline URL editor. Useful after CRON_SECRET rotation or
            when migrating a route's path. Schedule editing is v10. */}
        {editing ? (
          <div className="mt-2 flex items-center gap-1.5">
            <input
              type="text"
              value={draftUrl}
              onChange={e => setDraftUrl(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  { onUpdateUrl(draftUrl); setEditing(false) }
                if (e.key === 'Escape') { setEditing(false) }
              }}
              className="flex-1 text-[10px] px-1.5 py-0.5 rounded-md font-mono"
              style={{ color: '#e8e8f0', background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(108,99,255,0.40)' }}
              autoFocus
            />
            <button type="button" onClick={() => { onUpdateUrl(draftUrl); setEditing(false) }}
                    className="rounded-md p-0.5" style={{ color: '#4ade80' }} title="Save">
              <Check size={11} />
            </button>
            <button type="button" onClick={() => setEditing(false)}
                    className="rounded-md p-0.5" style={{ color: '#9090b0' }} title="Cancel">
              <X size={11} />
            </button>
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono" style={{ color: '#a8a3ff' }}>
            <span className="truncate" title={scrubSecret(job.url)}>{scrubSecret(job.url)}</span>
            <button type="button" onClick={() => setEditing(true)}
                    className="rounded-md p-0.5 shrink-0" style={{ color: '#9090b0' }} title="Edit URL">
              <Pencil size={9} />
            </button>
          </div>
        )}
        {/* v10 — inline schedule editor. Cron-string text input + inline
            validation. Save sends parsed schedule to the v9 update endpoint. */}
        {editingSched ? (
          <div className="mt-1 flex items-center gap-1.5">
            <Clock size={10} style={{ color: '#9090b0' }} />
            <input
              type="text"
              value={draftCron}
              onChange={e => setDraftCron(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !cronErr) { onUpdateSchedule(draftCron); setEditingSched(false) }
                if (e.key === 'Escape')            { setEditingSched(false) }
              }}
              placeholder="m h dom mon dow"
              className="flex-1 text-[10px] px-1.5 py-0.5 rounded-md font-mono"
              style={{
                color: '#e8e8f0',
                background: 'rgba(5,5,16,0.55)',
                border: `1px solid ${cronErr ? 'rgba(239,68,68,0.40)' : 'rgba(108,99,255,0.40)'}`,
              }}
              autoFocus
            />
            <button type="button" disabled={!!cronErr}
                    onClick={() => { onUpdateSchedule(draftCron); setEditingSched(false) }}
                    className="rounded-md p-0.5 disabled:opacity-40"
                    style={{ color: '#4ade80' }} title="Save schedule">
              <Check size={11} />
            </button>
            <button type="button" onClick={() => setEditingSched(false)}
                    className="rounded-md p-0.5" style={{ color: '#9090b0' }} title="Cancel">
              <X size={11} />
            </button>
            {cronErr && (
              <span className="text-[10px]" style={{ color: '#f87171' }} title={cronErr}>!</span>
            )}
          </div>
        ) : job.schedule_cron ? (
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono" style={{ color: '#9090b0' }}>
            <Clock size={9} style={{ color: '#9090b0' }} />
            <span>{job.schedule_cron}</span>
            <button type="button" onClick={() => setEditingSched(true)}
                    className="rounded-md p-0.5 shrink-0" style={{ color: '#9090b0' }} title="Edit schedule">
              <Pencil size={9} />
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {!job.enabled && (
          <button type="button" onClick={onEnable} disabled={enabling}
                  className="text-[10px] px-2 py-0.5 rounded-md inline-flex items-center gap-1 disabled:opacity-40"
                  style={{ color: '#4ade80', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.22)' }}
                  title="Re-enable this cron on cron-job.org">
            {enabling ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
            Re-enable
          </button>
        )}
        <span className="text-[9px] font-mono tracking-[0.12em] px-1.5 py-0.5 rounded-full"
              style={{ color: healthMeta.color, background: healthMeta.bg, border: `1px solid ${healthMeta.border}` }}>
          {healthMeta.label}
        </span>
      </div>
    </li>
  )
}

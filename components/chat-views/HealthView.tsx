'use client'

/**
 * HealthView — Failure-visibility panel for the Views dropdown (PR #192).
 *
 * Surfaces the four signals that tell the operator "where is the platform
 * leaking right now":
 *
 *   1. Slack delivery — pill (configured? signing secret set?) + "Test now"
 *      button that fires a real webhook ping and reports the response.
 *   2. Errors by phase — count of error events per phase from the last
 *      24h. Hot rows surface "this is where things are dying".
 *   3. Recent error events — the actual 25 most-recent error events with
 *      payload preview. Click expands the full JSON.
 *   4. Cron route status — last-success + last-error timestamps per
 *      /api/cron/* route inferred from run_events.payload.source.
 *   5. Cost-guard signals — kill_switch_check / gate_* / cost_guard_tripped
 *      experiment_metrics rows so the operator sees autonomous-loop
 *      decisions.
 *
 * Scoped: pass `scope='admin'` for platform-wide, `scope='business:<slug>'`
 * for a single business. The API filters server-side.
 */

import { useEffect, useState, useCallback } from 'react'
import { Loader2, MessageSquare, AlertCircle, Activity, ChevronDown, ChevronRight, RefreshCw, Clock, Zap, Skull, CheckCircle2, XCircle } from 'lucide-react'

interface RunRef {
  id: string; user_id: string; phase: string; status: string; updated_at: string
}
interface EventRow {
  id: string; run_id: string; kind: string; payload: Record<string, unknown>; created_at: string; run?: RunRef
}
interface CronRow {
  route: string; last_run?: string; last_error?: string; last_error_message?: string
}
interface MetricRow {
  id: string; kind: string; business_slug: string | null; numeric_value: number | null; string_value: string | null; metadata: Record<string, unknown>; created_at: string
}

interface Summary {
  ok: true
  scope: string
  slack: { webhookConfigured: boolean; signingConfigured: boolean }
  errors_by_phase: Record<string, { count: number; latest: string; latestMessage: string | null }>
  recent_events:   EventRow[]
  cron_status:     CronRow[]
  cost_guard:      MetricRow[]
  fetched_at:      string
}

interface SlackTestResult {
  result:        'success' | 'rejected' | 'not_configured' | 'network_error'
  http_status?:  number
  response_body?: string
  duration_ms?:  number
  message:       string
}

interface Props {
  scope: string  // 'admin' or 'business:<slug>'
}

export default function HealthView({ scope }: Props) {
  const [data, setData]       = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [slackTest, setSlackTest] = useState<SlackTestResult | null>(null)
  const [slackTesting, setSlackTesting] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const fetchSummary = useCallback(async () => {
    try {
      const businessSlug = scope.startsWith('business:') ? scope.slice('business:'.length) : null
      const url = `/api/health/summary${businessSlug ? `?business=${encodeURIComponent(businessSlug)}` : ''}`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `HTTP ${res.status}`)
        return
      }
      const j = (await res.json()) as Summary
      setData(j)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error')
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => { void fetchSummary() }, [fetchSummary])
  // 30s refresh — failure surfaces shouldn't be stale.
  useEffect(() => {
    const t = setInterval(() => { void fetchSummary() }, 30_000)
    return () => clearInterval(t)
  }, [fetchSummary])

  async function testSlack() {
    setSlackTesting(true)
    setSlackTest(null)
    try {
      const res = await fetch('/api/health/slack-test', { method: 'POST' })
      const j = (await res.json()) as SlackTestResult | { ok: false; error: string }
      if ('result' in j) setSlackTest(j)
      else setError((j as { error: string }).error)
    } catch (e) {
      setSlackTest({ result: 'network_error', message: e instanceof Error ? e.message : 'network error' })
    } finally {
      setSlackTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 text-sm flex items-center gap-2" style={{ color: '#9090b0' }}>
        <Loader2 size={14} className="animate-spin" /> Loading platform health…
      </div>
    )
  }
  if (!data) {
    return (
      <div className="p-4 text-sm" style={{ color: '#fca5a5' }}>
        Failed to load: {error ?? 'unknown'}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto" style={{ color: '#e8e8f0' }}>
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider" style={{ color: '#9090b0' }}>
          Platform health · scope <span className="font-mono" style={{ color: '#a8a3ff' }}>{data.scope}</span>
        </div>
        <button
          onClick={() => void fetchSummary()}
          className="text-[11px] underline opacity-70 hover:opacity-100 inline-flex items-center gap-1"
          style={{ color: '#a8a3ff' }}
        >
          <RefreshCw size={10} /> Refresh
        </button>
      </div>

      {/* Slack delivery */}
      <Section icon={<MessageSquare size={13} />} title="Slack delivery">
        <div className="flex items-center gap-2 mb-2">
          <Pill ok={data.slack.webhookConfigured} okText="Webhook URL set" badText="NEXUS_SLACK_WEBHOOK_URL missing" />
          <Pill ok={data.slack.signingConfigured} okText="Signing secret set" badText="No signing secret" />
        </div>
        <button
          onClick={() => void testSlack()}
          disabled={slackTesting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, rgba(99,180,255,0.30), rgba(99,180,255,0.10))', border: '1px solid rgba(99,180,255,0.30)', color: '#e8e8f0' }}
        >
          {slackTesting ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
          Test webhook now
        </button>
        {slackTest && (
          <div className="mt-2 rounded-lg px-3 py-2 text-xs" style={{
            background: slackTest.result === 'success' ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
            border: slackTest.result === 'success' ? '1px solid rgba(34,197,94,0.30)' : '1px solid rgba(239,68,68,0.30)',
            color: slackTest.result === 'success' ? '#86efac' : '#fca5a5',
          }}>
            <div className="font-semibold mb-1">
              {slackTest.result === 'success'         && <><CheckCircle2 size={11} className="inline mr-1" /> Delivered ({slackTest.http_status}, {slackTest.duration_ms}ms)</>}
              {slackTest.result === 'rejected'        && <><XCircle      size={11} className="inline mr-1" /> Rejected ({slackTest.http_status})</>}
              {slackTest.result === 'not_configured'  && <>Not configured</>}
              {slackTest.result === 'network_error'   && <><AlertCircle  size={11} className="inline mr-1" /> Network error</>}
            </div>
            <div className="opacity-90">{slackTest.message}</div>
            {slackTest.response_body && (
              <pre className="mt-1 font-mono text-[10px] opacity-70 overflow-x-auto">{slackTest.response_body}</pre>
            )}
          </div>
        )}
      </Section>

      {/* Errors by phase */}
      <Section icon={<AlertCircle size={13} />} title={`Errors by phase (24h) · ${Object.keys(data.errors_by_phase).length} active`}>
        {Object.keys(data.errors_by_phase).length === 0 ? (
          <div className="text-xs opacity-60">No errors in the last 24h — agents may be quiet, OR they aren't running. Use cron status below to tell which.</div>
        ) : (
          <div className="space-y-1">
            {Object.entries(data.errors_by_phase)
              .sort(([, a], [, b]) => b.count - a.count)
              .map(([phase, info]) => (
                <div key={phase} className="flex items-center gap-2 text-xs">
                  <span className="font-mono shrink-0 w-10 text-right" style={{ color: info.count >= 5 ? '#fca5a5' : info.count >= 2 ? '#fbbf24' : '#9090b0' }}>{info.count}×</span>
                  <span className="font-mono truncate flex-1" title={info.latestMessage ?? ''}>{phase}</span>
                  <span className="opacity-50 text-[10px] shrink-0">{humanize(info.latest)}</span>
                </div>
              ))}
          </div>
        )}
      </Section>

      {/* Cron status */}
      <Section icon={<Clock size={13} />} title={`Cron routes (24h) · ${data.cron_status.length} seen`}>
        {data.cron_status.length === 0 ? (
          <div className="text-xs opacity-60">
            No cron routes wrote to run_events in the last 24h. If Vercel cron is enabled but routes aren't logging, the cron schedule may be disabled (check vercel.json) or the routes throw before they reach the run_events write — see Recent events below.
          </div>
        ) : (
          <div className="space-y-1.5">
            {data.cron_status.map(c => (
              <div key={c.route} className="text-xs">
                <div className="font-mono truncate" style={{ color: c.last_error && (!c.last_run || c.last_error > c.last_run) ? '#fca5a5' : '#e8e8f0' }}>{c.route}</div>
                <div className="ml-3 mt-0.5 grid grid-cols-2 gap-2 text-[10px] opacity-70">
                  <div>Last run: <span style={{ color: c.last_run ? '#86efac' : '#55556a' }}>{c.last_run ? humanize(c.last_run) : 'never'}</span></div>
                  <div>Last error: <span style={{ color: c.last_error ? '#fca5a5' : '#55556a' }}>{c.last_error ? humanize(c.last_error) : 'none'}</span></div>
                </div>
                {c.last_error_message && <div className="ml-3 mt-0.5 text-[10px] truncate opacity-60" style={{ color: '#fca5a5' }}>{c.last_error_message.slice(0, 200)}</div>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Recent error events */}
      <Section icon={<Activity size={13} />} title={`Recent error events · ${data.recent_events.length}`}>
        {data.recent_events.length === 0 ? (
          <div className="text-xs opacity-60">No error rows in run_events from the last 24h.</div>
        ) : (
          <div className="space-y-1.5">
            {data.recent_events.map(e => {
              const isOpen = expanded[e.id]
              const message = e.payload?.message as string | undefined
              return (
                <div key={e.id} className="text-xs rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                  <button
                    onClick={() => setExpanded(p => ({ ...p, [e.id]: !p[e.id] }))}
                    className="w-full px-2.5 py-1.5 flex items-start gap-2 text-left"
                    style={{ background: 'rgba(239,68,68,0.06)' }}
                  >
                    {isOpen ? <ChevronDown size={11} className="mt-0.5 shrink-0" /> : <ChevronRight size={11} className="mt-0.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-mono truncate" style={{ color: '#fca5a5' }}>{e.kind}</div>
                      {message && <div className="mt-0.5 truncate opacity-80">{message.slice(0, 180)}</div>}
                    </div>
                    <div className="shrink-0 text-[10px] opacity-60">{humanize(e.created_at)}</div>
                  </button>
                  {isOpen && (
                    <div className="px-3 py-2" style={{ background: 'rgba(0,0,0,0.20)' }}>
                      <pre className="font-mono text-[10px] overflow-x-auto" style={{ color: '#bababd' }}>{JSON.stringify(e.payload, null, 2)}</pre>
                      {e.run && (
                        <div className="mt-1.5 text-[10px] opacity-70">
                          run <span className="font-mono">{e.run_id.slice(0, 8)}</span> · phase <span className="font-mono">{e.run.phase}</span> · status <span className="font-mono">{e.run.status}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* Cost-guard signals */}
      <Section icon={<Skull size={13} />} title={`Cost-guard signals · ${data.cost_guard.length}`}>
        {data.cost_guard.length === 0 ? (
          <div className="text-xs opacity-60">No kill-switch or gate signals in the last 24h.</div>
        ) : (
          <div className="space-y-1">
            {data.cost_guard.map(m => (
              <div key={m.id} className="text-xs flex items-center gap-2">
                <span className="font-mono shrink-0" style={{ color: m.kind.includes('kill') || m.kind === 'cost_guard_tripped' ? '#fca5a5' : '#fbbf24' }}>{m.kind}</span>
                {m.business_slug && <span className="font-mono opacity-60 text-[10px]">{m.business_slug}</span>}
                {m.string_value && <span className="opacity-80 truncate flex-1">{m.string_value.slice(0, 100)}</span>}
                <span className="opacity-50 text-[10px] shrink-0">{humanize(m.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="text-[10px] opacity-50 text-center pt-2">
        Refreshed {humanize(data.fetched_at)} · auto-polls every 30s
      </div>
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background:           'rgba(255,255,255,0.02)',
        border:               '1px solid rgba(255,255,255,0.06)',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-wider" style={{ color: '#a8a3ff' }}>
        {icon} {title}
      </div>
      {children}
    </div>
  )
}

function Pill({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider"
      style={{
        background: ok ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
        border:     ok ? '1px solid rgba(34,197,94,0.30)' : '1px solid rgba(239,68,68,0.30)',
        color:      ok ? '#86efac' : '#fca5a5',
      }}
    >
      {ok ? <CheckCircle2 size={9} /> : <XCircle size={9} />}
      {ok ? okText : badText}
    </span>
  )
}

function humanize(iso: string): string {
  const ms  = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60)        return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60)        return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr  < 24)        return `${hr}h ago`
  const d  = Math.floor(hr / 24)
  return `${d}d ago`
}

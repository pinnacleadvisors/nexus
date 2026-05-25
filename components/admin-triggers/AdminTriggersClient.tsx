'use client'

/**
 * AdminTriggersClient — one row per /api/admin-trigger/* route, each with a
 * "Run now" button. State per row: idle / running / ok / err with the last
 * response body. Owner-only enforcement happens server-side; this UI just
 * fires the POST.
 *
 * Roster matches the directory listing of app/api/admin-trigger/ — when a
 * new admin-trigger ships, add an entry here. The check:admin-trigger
 * static check (v13) keeps the directory shape honest.
 */

import { useState } from 'react'

interface Trigger {
  slug:        string
  label:       string
  description: string
  /** Short tag for the system this belongs to (e.g. C2, C8, A11, E6). */
  tag?:        string
}

const TRIGGERS: Trigger[] = [
  {
    slug:        'rebuild-graph',
    label:       'Rebuild memory graph',
    description: 'Re-runs molecularmemory_local CLI + buildMemoryGraph(); emits node/orphan/avg-degree metrics.',
    tag:         'C8',
  },
  {
    slug:        'regression-sweep',
    label:       'Regression sweep',
    description: 'Re-checks the C2 regression set for prompt drift across active agents.',
    tag:         'C2',
  },
  {
    slug:        'metric-optimiser',
    label:       'Metric optimiser sweep',
    description: 'Hourly Inngest sweep equivalent — fires the optimiser pipeline once.',
    tag:         'opt',
  },
  {
    slug:        'ingest-metrics',
    label:       'Ingest metrics',
    description: 'A11 measure-phase sweep — pulls latest external KPIs (e.g. analytics, Stripe) into experiment_metrics.',
    tag:         'A11',
  },
  {
    slug:        'daily-extract',
    label:       'Daily extract',
    description: 'E6 daily extract — pulls Slack/Linear/Notion deltas for the daily digest.',
    tag:         'E6',
  },
]

type Status = 'idle' | 'running' | 'ok' | 'err'
interface RunState {
  status: Status
  msg?:   string
  at?:    number
}

export default function AdminTriggersClient() {
  const [states, setStates] = useState<Record<string, RunState>>({})

  async function run(slug: string) {
    setStates(s => ({ ...s, [slug]: { status: 'running' } }))
    try {
      const res  = await fetch(`/api/admin-trigger/${slug}`, { method: 'POST' })
      const body = await res.text()
      const trimmed = body.length > 200 ? body.slice(0, 200) + '…' : body
      if (!res.ok) {
        setStates(s => ({ ...s, [slug]: { status: 'err', msg: `${res.status}: ${trimmed}`, at: Date.now() } }))
        return
      }
      setStates(s => ({ ...s, [slug]: { status: 'ok', msg: trimmed || 'ok', at: Date.now() } }))
    } catch (err) {
      setStates(s => ({ ...s, [slug]: { status: 'err', msg: err instanceof Error ? err.message : 'network error', at: Date.now() } }))
    }
  }

  return (
    <div className="space-y-3">
      {TRIGGERS.map(t => {
        const st  = states[t.slug] ?? { status: 'idle' as const }
        const busy = st.status === 'running'
        return (
          <div key={t.slug}
               className="rounded-xl px-4 py-3 flex items-start gap-3"
               style={{
                 background:  'rgba(255,255,255,0.02)',
                 border:      '1px solid rgba(255,255,255,0.06)',
                 boxShadow:   '0 1px 0 0 rgba(255,255,255,0.04) inset',
               }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{t.label}</h3>
                {t.tag && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(108,99,255,0.15)', color: '#a5b4fc' }}>
                    {t.tag}
                  </span>
                )}
              </div>
              <p className="text-xs mt-1" style={{ color: '#9090b0' }}>{t.description}</p>
              <code className="text-[10px] mt-1 inline-block" style={{ color: '#6b7280' }}>
                POST /api/admin-trigger/{t.slug}
              </code>
              {st.msg && (
                <pre className="text-[10px] mt-2 px-2 py-1 rounded whitespace-pre-wrap"
                     style={{
                       background: st.status === 'err' ? 'rgba(248,113,113,0.08)' : 'rgba(74,222,128,0.06)',
                       border:     st.status === 'err' ? '1px solid rgba(248,113,113,0.25)' : '1px solid rgba(74,222,128,0.20)',
                       color:      st.status === 'err' ? '#fca5a5' : '#86efac',
                       maxWidth:   '100%',
                       overflow:   'auto',
                     }}>{st.msg}</pre>
              )}
            </div>
            <button
              onClick={() => run(t.slug)}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{
                background: busy ? 'rgba(108,99,255,0.20)' : 'rgba(108,99,255,0.40)',
                color:      '#e8e8f0',
                opacity:    busy ? 0.6 : 1,
                cursor:     busy ? 'wait' : 'pointer',
                border:     '1px solid rgba(108,99,255,0.50)',
              }}>
              {busy ? 'Running…' : 'Run now'}
            </button>
          </div>
        )
      })}
      <p className="text-[11px] mt-4" style={{ color: '#6b7280' }}>
        Owner-only — enforced by <code>ALLOWED_USER_IDS</code> at the route level.
        These routes do NOT auto-disable on 5xx (they aren&apos;t registered with cron-job.org).
      </p>
    </div>
  )
}

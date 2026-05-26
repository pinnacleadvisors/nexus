'use client'

/**
 * Hyperbolic-chamber console — drives the simulation lifecycle:
 *   - if no run is active, render the start form
 *   - if run is paused on a gate, render the Approve/Reject prompt
 *   - if running (auto), render the progress + run-to-completion control
 *   - if running (manual), render the "Next event" button
 *   - if done, render the graded report
 *
 * The page polls /api/simulations/:id every 2s while a run is active so
 * progress + recent events stay live without WebSockets.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Play, SkipForward, X, CheckCircle2, XCircle, Download, Upload } from 'lucide-react'

export interface SimulationRunRow {
  id:                    string
  business_slug:         string
  mode:                  'manual' | 'auto'
  compress_days:         number
  wallclock_budget_sec:  number
  approver_policy:       'permissive' | 'skeptical' | 'random' | null
  status:                string
  current_event_idx:     number
  total_events:          number
  started_at:            string | null
  ended_at:              string | null
  result:                Record<string, unknown> | null
  created_at:            string
}

interface PendingGate {
  id:         string
  sim_day:    number
  sim_hour:   number
  payload:    Record<string, unknown>
}

interface EventRow {
  id:               string
  sim_day:          number
  sim_hour:         number
  kind:             string
  payload:          Record<string, unknown>
  approval_state:   string | null
  approved_by:      string | null
  outcome:          Record<string, unknown> | null
  created_at:       string
}

interface SimStateBody {
  ok:           boolean
  run?:         SimulationRunRow
  events?:      EventRow[]
  pending_gate?: PendingGate | null
}

const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled'])

export default function SimulationConsole({ slug, initialRun }: { slug: string; initialRun: SimulationRunRow | null }) {
  const router = useRouter()
  const [run, setRun]                 = useState<SimulationRunRow | null>(initialRun)
  const [events, setEvents]           = useState<EventRow[]>([])
  const [pendingGate, setPendingGate] = useState<PendingGate | null>(null)
  const [pending, startTransition]    = useTransition()
  const [error, setError]             = useState<string | null>(null)

  // Poll for state while a run is active
  const refresh = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/simulations/${runId}`, { cache: 'no-store' })
      const body = await res.json() as SimStateBody
      if (!body.ok || !body.run) return
      setRun(body.run)
      setEvents(body.events ?? [])
      setPendingGate(body.pending_gate ?? null)
    } catch { /* fail silent — next poll will retry */ }
  }, [])

  useEffect(() => {
    if (!run) return
    if (TERMINAL_STATUSES.has(run.status)) {
      // One more refresh to ensure events list reflects final state
      void refresh(run.id)
      return
    }
    const intervalId = window.setInterval(() => { void refresh(run.id) }, 2_000)
    void refresh(run.id)
    return () => window.clearInterval(intervalId)
  }, [run, refresh])

  const start = (mode: 'manual' | 'auto', opts: { compress_days: number; wallclock_budget_sec: number; approver_policy?: string; synthetic_voice?: 'template' | 'llm' }) => {
    setError(null)
    startTransition(async () => {
      const res = await fetch('/api/simulations', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ business_slug: slug, mode, ...opts }),
      })
      const body = await res.json() as { ok: boolean; run_id?: string; error?: string }
      if (!body.ok || !body.run_id) {
        setError(body.error ?? 'unknown error')
        return
      }
      router.refresh()
      void refresh(body.run_id)
    })
  }

  const startAB = (opts: { policies: string[]; compress_days: number; wallclock_budget_sec: number; synthetic_voice?: 'template' | 'llm' }) => {
    setError(null)
    startTransition(async () => {
      const res = await fetch('/api/simulations/multi', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ business_slug: slug, ...opts }),
      })
      const body = await res.json() as { ok: boolean; group_id?: string; error?: string }
      if (!body.ok || !body.group_id) {
        setError(body.error ?? 'A/B start failed')
        return
      }
      router.push(`/businesses/${slug}/simulate/compare/${body.group_id}`)
    })
  }

  const tick = () => {
    if (!run) return
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/simulations/${run.id}/tick`, { method: 'POST' })
      const body = await res.json() as { ok: boolean; error?: string }
      if (!body.ok) setError(body.error ?? 'tick failed')
      void refresh(run.id)
    })
  }

  const runToCompletion = () => {
    if (!run) return
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/simulations/${run.id}/run`, { method: 'POST' })
      const body = await res.json() as { ok: boolean; final_status?: string; error?: string }
      if (!body.ok) setError(body.error ?? 'run failed')
      // If final_status === 'running', poll will trigger another run automatically
      void refresh(run.id)
      if (body.final_status === 'running') {
        // Kick another /run call after a beat so we keep draining
        setTimeout(runToCompletion, 1_000)
      }
    })
  }

  const decide = (eventId: string, decision: 'approve' | 'reject') => {
    if (!run) return
    setError(null)
    startTransition(async () => {
      const res = await fetch(`/api/simulations/${run.id}/decide`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ event_id: eventId, decision }),
      })
      const body = await res.json() as { ok: boolean; error?: string }
      if (!body.ok) setError(body.error ?? 'decision failed')
      void refresh(run.id)
    })
  }

  const cancel = () => {
    if (!run) return
    startTransition(async () => {
      await fetch(`/api/simulations/${run.id}/cancel`, { method: 'POST' })
      router.refresh()
    })
  }

  const importRun = (file: File) => {
    setError(null)
    startTransition(async () => {
      try {
        const text    = await file.text()
        const payload = JSON.parse(text)
        const res = await fetch('/api/simulations/import', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ payload, target_slug: slug }),
        })
        const body = await res.json() as { ok: boolean; run_id?: string; error?: string }
        if (!body.ok || !body.run_id) {
          setError(body.error ?? 'import failed')
          return
        }
        router.refresh()
        void refresh(body.run_id)
      } catch (err) {
        setError(`Import parse failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  }

  // ── Render: no run → start form ────────────────────────────────────────────
  if (!run || TERMINAL_STATUSES.has(run.status)) {
    return <StartForm onStart={start} onStartAB={startAB} onImport={importRun} pending={pending} error={error} lastRun={run} onReplay={() => { setRun(null) }} />

  }

  // ── Render: active run ─────────────────────────────────────────────────────
  const pct = run.total_events > 0 ? Math.round(100 * run.current_event_idx / run.total_events) : 0
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-zinc-300">
            {run.mode === 'manual' ? 'Manual replay' : `Auto-pilot (${run.approver_policy ?? '?'})`}
            {' · '}
            <span className="font-mono text-zinc-400">{run.status}</span>
          </span>
          <span className="font-mono text-xs text-zinc-500">{run.current_event_idx} / {run.total_events} · {pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {pendingGate && run.mode === 'manual' && (
        <PendingGateCard gate={pendingGate} onApprove={() => decide(pendingGate.id, 'approve')} onReject={() => decide(pendingGate.id, 'reject')} pending={pending} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {run.mode === 'manual' && !pendingGate && (
          <button onClick={tick} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SkipForward className="h-4 w-4" />} Next event
          </button>
        )}
        {run.mode === 'auto' && (
          <button onClick={runToCompletion} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run to completion
          </button>
        )}
        <button onClick={cancel} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800/70 disabled:opacity-50">
          <X className="h-4 w-4" /> Cancel
        </button>
      </div>

      {error && <p className="text-sm text-rose-400">⚠︎ {error}</p>}

      <EventFeed events={events} />
    </section>
  )
}

function PendingGateCard({ gate, onApprove, onReject, pending }: { gate: PendingGate; onApprove: () => void; onReject: () => void; pending: boolean }) {
  const p = gate.payload as { gate_kind?: string; title?: string; justification?: string; irreversible?: boolean }
  return (
    <div className="rounded-xl border border-amber-700/50 bg-amber-500/10 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full bg-amber-500/30 px-2 py-0.5 font-mono text-xs uppercase tracking-wider text-amber-100">
          {p.gate_kind ?? 'approval'}
        </span>
        {p.irreversible && <span className="rounded-full bg-rose-500/30 px-2 py-0.5 font-mono text-xs uppercase tracking-wider text-rose-100">irreversible</span>}
        <span className="font-mono text-xs text-amber-200/60">day {gate.sim_day} · {gate.sim_hour.toFixed(1)}h</span>
      </div>
      <h3 className="mb-1 text-sm font-semibold text-amber-100">{p.title ?? 'Approval needed'}</h3>
      {p.justification
        ? <p className="mb-3 text-sm text-amber-100/80">{p.justification}</p>
        : <p className="mb-3 text-sm italic text-amber-100/50">(no justification provided)</p>}
      <div className="flex gap-2">
        <button onClick={onApprove} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50">
          <CheckCircle2 className="h-4 w-4" /> Approve
        </button>
        <button onClick={onReject} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-50">
          <XCircle className="h-4 w-4" /> Reject
        </button>
      </div>
    </div>
  )
}

function EventFeed({ events }: { events: EventRow[] }) {
  if (events.length === 0) return null
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="mb-3 text-sm font-medium text-zinc-200">Recent activity</h3>
      <ul className="space-y-2">
        {events.slice(0, 20).map(ev => {
          const p = ev.payload as { persona_name?: string; agent?: string; action_title?: string; gate_kind?: string; source?: string; severity?: string; title?: string }
          const outcome = (ev.outcome ?? {}) as { body?: string }
          let line: string
          switch (ev.kind) {
            case 'inbound_ticket':  line = `📩 ${p.persona_name ?? 'someone'} — ${p.title ?? 'ticket'}`; break
            case 'agent_action':    line = `🤖 ${p.agent ?? 'agent'} — ${p.action_title ?? 'action'}`; break
            case 'approval_gate':   line = `🚦 gate [${p.gate_kind ?? '?'}] ${ev.approval_state ?? 'pending'}${ev.approved_by ? ` by ${ev.approved_by}` : ''}`; break
            case 'kpi_snapshot':    line = `📊 EOD snapshot`; break
            case 'failure':         line = `💥 ${p.source ?? '?'} failure (${p.severity ?? '?'})`; break
            default:                line = ev.kind
          }
          return (
            <li key={ev.id} className="text-sm text-zinc-300">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{line}</span>
                <span className="font-mono text-xs text-zinc-500">day {ev.sim_day} · {ev.sim_hour.toFixed(1)}h</span>
              </div>
              {ev.kind === 'inbound_ticket' && outcome.body && (
                <p className="ml-6 mt-0.5 text-xs italic text-zinc-500" title={outcome.body}>
                  {outcome.body.length > 140 ? outcome.body.slice(0, 137) + '…' : outcome.body}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function StartForm({ onStart, onStartAB, onImport, pending, error, lastRun, onReplay }: { onStart: (mode: 'manual' | 'auto', opts: { compress_days: number; wallclock_budget_sec: number; approver_policy?: string; synthetic_voice?: 'template' | 'llm' }) => void; onStartAB: (opts: { policies: string[]; compress_days: number; wallclock_budget_sec: number; synthetic_voice?: 'template' | 'llm' }) => void; onImport: (file: File) => void; pending: boolean; error: string | null; lastRun: SimulationRunRow | null; onReplay: () => void }) {
  const [mode, setMode]                  = useState<'manual' | 'auto' | 'ab-compare'>('manual')
  const [compress, setCompress]          = useState(30)
  const [budgetSec, setBudgetSec]        = useState(3_600)
  const [policy, setPolicy]              = useState<'permissive' | 'skeptical' | 'random'>('permissive')
  const [llmVoices, setLlmVoices]        = useState(false)
  const [abPolicies, setAbPolicies]      = useState<Record<'permissive' | 'skeptical' | 'random', boolean>>({ permissive: true, skeptical: true, random: false })
  const fileInputRef                     = useRef<HTMLInputElement>(null)

  const abPicked = (['permissive', 'skeptical', 'random'] as const).filter(p => abPolicies[p])

  return (
    <section className="space-y-4">
      {lastRun && (
        <FinalReport run={lastRun} />
      )}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Start a new run</h2>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-zinc-400">Mode</span>
            <select value={mode} onChange={e => setMode(e.target.value as 'manual' | 'auto' | 'ab-compare')} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100">
              <option value="manual">Manual (you approve each gate)</option>
              <option value="auto">Auto-pilot (heuristic decides)</option>
              <option value="ab-compare">A/B compare (run 2-4 policies side-by-side)</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-zinc-400">Sim days</span>
            <input type="number" value={compress} min={1} max={365} onChange={e => setCompress(Math.max(1, Math.min(365, Number(e.target.value))))} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100" />
          </label>
          <label className="text-sm">
            <span className="text-zinc-400">Wallclock budget (seconds)</span>
            <input type="number" value={budgetSec} min={60} max={86_400} step={60} onChange={e => setBudgetSec(Math.max(60, Math.min(86_400, Number(e.target.value))))} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100" />
          </label>
          {mode === 'auto' && (
            <label className="text-sm">
              <span className="text-zinc-400">Approver policy</span>
              <select value={policy} onChange={e => setPolicy(e.target.value as 'permissive' | 'skeptical' | 'random')} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100">
                <option value="permissive">Permissive (approve unless irreversible)</option>
                <option value="skeptical">Skeptical (approve only if justified)</option>
                <option value="random">Random (70/30 approve/reject)</option>
              </select>
            </label>
          )}
          {mode === 'ab-compare' && (
            <fieldset className="text-sm sm:col-span-2">
              <legend className="text-zinc-400">Policies to compare (pick 2-4)</legend>
              <div className="mt-1 flex flex-wrap gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2">
                {(['permissive', 'skeptical', 'random'] as const).map(p => (
                  <label key={p} className="flex items-center gap-1.5 text-zinc-200">
                    <input
                      type="checkbox"
                      checked={abPolicies[p]}
                      onChange={e => setAbPolicies(s => ({ ...s, [p]: e.target.checked }))}
                      className="h-4 w-4 accent-violet-500"
                    />
                    {p}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Same seed across all policies — like backtesting multiple strategies on the same historical bars.
              </p>
            </fieldset>
          )}
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={llmVoices}
              onChange={e => setLlmVoices(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-violet-500"
            />
            <span>
              <span className="text-zinc-200">LLM-generated ticket bodies</span>
              <span className="ml-1 text-xs text-zinc-500">
                (~$0.02 per run at default model. Each inbound_ticket gets a 1-2 sentence body in the persona&apos;s voice. Default off; templates stay $0.)
              </span>
            </span>
          </label>
        </div>
        {error && <p className="mb-2 text-sm text-rose-400">⚠︎ {error}</p>}
        <div className="flex gap-2">
          {mode === 'ab-compare' ? (
            <button
              onClick={() => onStartAB({
                policies:             abPicked,
                compress_days:        compress,
                wallclock_budget_sec: budgetSec,
                synthetic_voice:      llmVoices ? 'llm' : 'template',
              })}
              disabled={pending || abPicked.length < 2}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
              title={abPicked.length < 2 ? 'Pick at least 2 policies' : `Compare ${abPicked.join(' vs ')}`}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start A/B ({abPicked.length})
            </button>
          ) : (
            <button
              onClick={() => onStart(mode as 'manual' | 'auto', {
                compress_days:        compress,
                wallclock_budget_sec: budgetSec,
                approver_policy:      mode === 'auto' ? policy : undefined,
                synthetic_voice:      llmVoices ? 'llm' : 'template',
              })}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start
            </button>
          )}
          {lastRun && (
            <button onClick={onReplay} className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800/70">
              New from blank
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800/70 disabled:opacity-50"
            title="Replay a previously exported run (same seed → same timeline)"
          >
            <Upload className="h-4 w-4" /> Import…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) onImport(file)
              e.target.value = ''   // allow re-selecting the same file
            }}
          />
        </div>
      </div>
    </section>
  )
}

function FinalReport({ run }: { run: SimulationRunRow }) {
  if (!run.result) return null
  const exportUrl = `/api/simulations/${run.id}/export`
  const r = run.result as {
    events_processed?:    number
    approvals?:           { approved?: number; rejected?: number; auto_approved?: number; auto_rejected?: number }
    sim_revenue_cents?:   number
    sim_spend_cents?:     number
    sim_net_cents?:       number
    failures?:            number
    critical_failures?:   number
    kpis_hit?:            Record<string, boolean | null>
    takeaways?:           string[]
  }
  const a = r.approvals ?? {}
  return (
    <div className="rounded-xl border border-emerald-700/40 bg-emerald-500/5 p-4 text-zinc-200">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-emerald-200">Run finished — {run.status}</h2>
        <div className="flex items-center gap-3">
          <a
            href={exportUrl}
            download
            className="inline-flex items-center gap-1 rounded-md border border-emerald-700/50 bg-emerald-500/10 px-2 py-1 font-mono text-xs text-emerald-200 transition hover:bg-emerald-500/20"
            title="Download this run as JSON. Re-import elsewhere to replay with identical seed."
          >
            <Download className="h-3 w-3" /> Export
          </a>
          <span className="font-mono text-xs text-emerald-300/60">{r.events_processed ?? 0} events · {run.compress_days} sim-days</span>
        </div>
      </div>
      {r.takeaways && r.takeaways.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {r.takeaways.map((t, i) => <li key={i}>• {t}</li>)}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div className="rounded-lg bg-zinc-900/40 p-2">
          <div className="text-zinc-500">Approved</div>
          <div className="font-mono text-zinc-100">{(a.approved ?? 0) + (a.auto_approved ?? 0)}</div>
        </div>
        <div className="rounded-lg bg-zinc-900/40 p-2">
          <div className="text-zinc-500">Rejected</div>
          <div className="font-mono text-zinc-100">{(a.rejected ?? 0) + (a.auto_rejected ?? 0)}</div>
        </div>
        <div className="rounded-lg bg-zinc-900/40 p-2">
          <div className="text-zinc-500">Sim revenue</div>
          <div className="font-mono text-zinc-100">${((r.sim_revenue_cents ?? 0) / 100).toFixed(2)}</div>
        </div>
        <div className="rounded-lg bg-zinc-900/40 p-2">
          <div className="text-zinc-500">Sim net</div>
          <div className={`font-mono ${(r.sim_net_cents ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            ${((r.sim_net_cents ?? 0) / 100).toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  )
}

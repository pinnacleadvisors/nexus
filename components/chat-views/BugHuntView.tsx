'use client'

/**
 * BugHuntView — operator-gated bug-hunt loop control panel.
 *
 * Three sections:
 *   1. Session header — status pill + two-bar plan-window meter +
 *                       Pause/Resume/Stop buttons (when active)
 *   2. Findings list — grouped by status (Open / PR-opened / Wont-fix / Merged)
 *   3. Start banner — when no active session
 *
 * Polls /api/bug-hunt/active every 4s while the panel is open. Refresh
 * on every Pause/Resume/Stop click.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Play, Pause, Square, AlertCircle, CheckCircle2, ExternalLink, FileText, ChevronDown, ChevronRight, Wrench, ListChecks, AlertTriangle, Send, Bug } from 'lucide-react'
import type { BugHuntSessionRow, BugHuntFindingRow } from '@/lib/bug-hunt/sessions'
import type { PlanWindowUsage } from '@/lib/claw/plan-window'
import type { ActivityEvent, ActivityKind } from '@/app/api/bug-hunt/[id]/activity/route'

interface ActiveResp {
  ok:       true
  session:  BugHuntSessionRow | null
  usage?:   { claude_max: PlanWindowUsage; codex_pro: PlanWindowUsage }
  findings?: { open: number; pr_opened: number; merged: number; wont_fix: number }
}

interface DetailResp {
  ok:       true
  session:  BugHuntSessionRow
  findings: BugHuntFindingRow[]
  usage:    { claude_max: PlanWindowUsage; codex_pro: PlanWindowUsage }
}

interface Props {
  onCountChange?:  (openFindings: number) => void
  /** Optional — when provided, the panel renders an "Iterate now" button
   *  that calls this with a fixed chat command to auto-send. Parent
   *  (PlatformChat) wires it to its own send() so the operator doesn't
   *  have to type. */
  onSendChatMessage?: (text: string) => void
}

const POLL_MS = 4_000

export default function BugHuntView({ onCountChange, onSendChatMessage }: Props) {
  const [state, setState] = useState<{ session: BugHuntSessionRow | null; usage?: ActiveResp['usage']; findings: BugHuntFindingRow[]; openCount: number }>(
    { session: null, findings: [], openCount: 0 },
  )
  const [loading, setLoading]     = useState(true)
  const [error,   setError]       = useState<string | null>(null)
  const [activity, setActivity]   = useState<ActivityEvent[]>([])
  const [activityOpen, setActivityOpen] = useState(true)

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/bug-hunt/active?scope=admin', { cache: 'no-store' })
      if (!res.ok) { setError(`HTTP ${res.status}`); setLoading(false); return }
      const j = (await res.json()) as ActiveResp | { ok: false; error: string }
      if (!j.ok) { setError(j.error); setLoading(false); return }
      if (!j.session) {
        setState({ session: null, findings: [], openCount: 0 })
        setLoading(false); setError(null)
        onCountChange?.(0)
        return
      }
      // Active session — fetch detail + activity in parallel
      const [detRes, actRes] = await Promise.all([
        fetch(`/api/bug-hunt/${encodeURIComponent(j.session.id)}`, { cache: 'no-store' }),
        fetch(`/api/bug-hunt/${encodeURIComponent(j.session.id)}/activity`, { cache: 'no-store' }),
      ])
      const det = (await detRes.json()) as DetailResp | { ok: false; error: string }
      if (!det.ok) { setError(det.error); setLoading(false); return }
      const act = (await actRes.json()) as { ok: true; events: ActivityEvent[] } | { ok: false; error: string }
      if (act.ok) setActivity(act.events)
      const openCount = det.findings.filter(f => f.status === 'open').length
      setState({ session: det.session, usage: det.usage, findings: det.findings, openCount })
      onCountChange?.(openCount)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load')
    } finally {
      setLoading(false)
    }
  }, [onCountChange])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (!state.session || state.session.status !== 'active') return
    const id = setInterval(() => { void reload() }, POLL_MS)
    return () => clearInterval(id)
  }, [state.session, reload])

  async function postLifecycle(action: 'pause' | 'resume' | 'stop') {
    if (!state.session) return
    setLoading(true)
    try {
      await fetch(`/api/bug-hunt/${encodeURIComponent(state.session.id)}/${action}`, { method: 'POST' })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : `${action} failed`)
    }
  }

  async function startNew() {
    setLoading(true)
    try {
      const res = await fetch('/api/bug-hunt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'admin' }) })
      const j = (await res.json()) as { ok: true } | { ok: false; error: string; code?: string }
      if (!j.ok) { setError(j.error); setLoading(false); return }
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'start failed')
    }
  }

  if (loading && !state.session) {
    return (
      <div className="px-4 py-8 flex items-center justify-center text-xs gap-2" style={{ color: '#9090b0' }}>
        <Loader2 size={12} className="animate-spin" /> Loading bug-hunt session…
      </div>
    )
  }

  if (!state.session) {
    return (
      <div className="px-4 py-6 space-y-3">
        {error && <ErrorBox msg={error} />}
        <div className="rounded-xl p-4 text-center space-y-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.10)' }}>
          <FileText size={24} style={{ color: '#a8a3ff' }} className="mx-auto" />
          <div className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>No active bug-hunt session</div>
          <div className="text-[11px]" style={{ color: '#9090b0' }}>
            Start a session — the loop proposes iterations, you approve each one. Defaults: 33% of 5h Max window, 33% of Pro window, force_plan_window=true.
          </div>
          <button
            onClick={() => void startNew()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium"
            style={{ background: 'rgba(108,99,255,0.20)', border: '1px solid rgba(108,99,255,0.30)', color: '#e8e8f0' }}
          >
            <Play size={11} /> Start session
          </button>
          <div className="text-[10px]" style={{ color: '#55556a' }}>
            Once started, type <span className="font-mono">/bug-hunt iterate</span> in chat to ask the copilot to propose the first iteration.
          </div>
        </div>
      </div>
    )
  }

  const s = state.session
  return (
    <div className="px-3 py-3 space-y-3">
      {error && <ErrorBox msg={error} />}

      {/* Session header */}
      <div className="rounded-lg p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-mono truncate" style={{ color: '#9090b0' }} title={s.id}>{s.id}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <StatusPill status={s.status} />
              <span className="text-[10px]" style={{ color: '#55556a' }}>iter {s.iteration_count}/{s.max_iterations}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {s.status === 'active' && (
              <button onClick={() => void postLifecycle('pause')} title="Pause" className="p-1 rounded" style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.20)' }}>
                <Pause size={11} />
              </button>
            )}
            {s.status === 'paused' && (
              <button onClick={() => void postLifecycle('resume')} title="Resume" className="p-1 rounded" style={{ color: '#22c55e', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.20)' }}>
                <Play size={11} />
              </button>
            )}
            {(s.status === 'active' || s.status === 'paused') && (
              <button onClick={() => void postLifecycle('stop')} title="Stop" className="p-1 rounded" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}>
                <Square size={11} />
              </button>
            )}
          </div>
        </div>

        {state.usage && (
          <div className="space-y-1.5">
            <UsageBar label="Claude Max" usage={state.usage.claude_max} cap={s.plan_window_share_pct} />
            <UsageBar label="Codex Pro"  usage={state.usage.codex_pro}  cap={s.codex_window_share_pct} />
          </div>
        )}
        {!s.force_plan_window && (
          <div className="text-[10px]" style={{ color: '#9090b0' }}>
            USD fallback: ${s.spent_usd.toFixed(2)} / ${s.budget_usd.toFixed(2)}
          </div>
        )}

        {/* Propose-next-iteration button — visible only when status=active
            AND the parent provided a send-callback (i.e. we're rendered
            inside a chat where typing /bug-hunt iterate makes sense). */}
        {s.status === 'active' && onSendChatMessage && (
          <button
            onClick={() => onSendChatMessage('/bug-hunt iterate')}
            className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-medium transition-colors"
            style={{
              background: 'linear-gradient(135deg, rgba(108,99,255,0.25), rgba(108,99,255,0.08))',
              border:     '1px solid rgba(108,99,255,0.30)',
              color:      '#e8e8f0',
            }}
          >
            <Send size={11} /> Propose iteration {s.iteration_count + 1} in chat
          </button>
        )}
      </div>

      {/* Session activity dropdown — chronological feed of what the loop
          has done. Collapsible. Failures (tool errors, etc.) get a red
          border so they stand out. */}
      <ActivitySection
        events={activity}
        open={activityOpen}
        onToggle={() => setActivityOpen(o => !o)}
        sessionId={s.id}
      />

      {/* Findings */}
      <FindingsList findings={state.findings} sessionId={s.id} reload={reload} />
    </div>
  )
}

// ── Activity feed ───────────────────────────────────────────────────────────

function ActivitySection({ events, open, onToggle, sessionId }: { events: ActivityEvent[]; open: boolean; onToggle: () => void; sessionId: string }) {
  const failureCount = events.filter(e => !e.ok).length
  const hasEvents = events.length > 0
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${failureCount > 0 ? 'rgba(239,68,68,0.30)' : 'rgba(255,255,255,0.08)'}` }}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        style={{ color: '#c8c8d8' }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="text-xs font-semibold flex-1">Session activity</span>
        {hasEvents && (
          <span className="text-[10px]" style={{ color: '#55556a' }}>{events.length} event{events.length === 1 ? '' : 's'}</span>
        )}
        {failureCount > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}>
            {failureCount} failure{failureCount === 1 ? '' : 's'}
          </span>
        )}
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1">
          {!hasEvents && (
            <div className="text-[11px] text-center py-3" style={{ color: '#55556a' }}>
              No activity yet. Click <span className="font-mono">Propose iteration</span> above or type <span className="font-mono">/bug-hunt iterate</span> in the chat to start the loop.
            </div>
          )}
          {events.map((e, i) => <ActivityRow key={`${sessionId}-${i}-${e.at}`} event={e} />)}
        </div>
      )}
    </div>
  )
}

const KIND_ICON: Record<ActivityKind, typeof Bug> = {
  'session-started':     Play,
  'session-paused':      Pause,
  'session-resumed':     Play,
  'session-stopped':     Square,
  'iteration-proposed':  ListChecks,
  'iteration-approved':  CheckCircle2,
  'tool-call':           Wrench,
  'finding-inserted':    Bug,
  'pr-opened':           ExternalLink,
  'turn-completed':      CheckCircle2,
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const Icon = KIND_ICON[event.kind] ?? CheckCircle2
  const isFail = !event.ok
  return (
    <div
      className="flex items-start gap-2 px-2 py-1.5 rounded"
      style={{
        background: isFail ? 'rgba(239,68,68,0.08)' : 'transparent',
        border:     isFail ? '1px solid rgba(239,68,68,0.25)' : '1px solid transparent',
      }}
    >
      {isFail
        ? <AlertTriangle size={11} className="mt-0.5 shrink-0" style={{ color: '#fca5a5' }} />
        : <Icon         size={11} className="mt-0.5 shrink-0" style={{ color: '#a8a3ff' }} />}
      <div className="flex-1 min-w-0">
        <div className="text-[11px]" style={{ color: isFail ? '#fca5a5' : '#e8e8f0' }}>
          {event.title}
        </div>
        {event.detail && (
          <div className="text-[10px] mt-0.5 truncate" style={{ color: '#9090b0' }} title={event.detail}>
            {event.detail}
          </div>
        )}
        <div className="text-[9px] mt-0.5" style={{ color: '#55556a' }}>
          {new Date(event.at).toLocaleString()}
        </div>
      </div>
    </div>
  )
}

function UsageBar({ label, usage, cap }: { label: string; usage: PlanWindowUsage; cap: number }) {
  const sessionPct = Math.min(100, usage.sessionSharePct)
  const windowPct  = Math.min(100, usage.windowSharePct)
  const overSessionCap = usage.sessionSharePct >= cap
  const overWindow = windowPct >= 90
  const barColor = overSessionCap || overWindow ? (windowPct >= 100 ? '#ef4444' : '#f59e0b') : '#a8a3ff'
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span style={{ color: '#9090b0' }}>{label}</span>
        <span style={{ color: '#55556a' }}>
          session {sessionPct.toFixed(0)}% / window {windowPct.toFixed(0)}% (cap {cap}%)
        </span>
      </div>
      <div className="relative h-1.5 rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <div className="absolute top-0 left-0 h-full" style={{ width: `${windowPct}%`, background: 'rgba(255,255,255,0.12)' }} />
        <div className="absolute top-0 left-0 h-full" style={{ width: `${sessionPct}%`, background: barColor }} />
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: BugHuntSessionRow['status'] }) {
  const cfg = {
    active:  { color: '#22c55e', label: 'Active' },
    paused:  { color: '#f59e0b', label: 'Paused' },
    stopped: { color: '#9090b0', label: 'Stopped' },
    done:    { color: '#a8a3ff', label: 'Done' },
  }[status]
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: `${cfg.color}22`, color: cfg.color, border: `1px solid ${cfg.color}44` }}>
      {cfg.label}
    </span>
  )
}

function FindingsList({ findings, sessionId, reload }: { findings: BugHuntFindingRow[]; sessionId: string; reload: () => Promise<void> }) {
  if (findings.length === 0) {
    return <div className="text-[11px] text-center py-4" style={{ color: '#55556a' }}>No findings yet. The agent emits them via bug-hunt-finding blocks during iterations.</div>
  }
  const groups: Array<{ label: string; status: BugHuntFindingRow['status']; rows: BugHuntFindingRow[] }> = ([
    { label: 'Open',           status: 'open'      as const, rows: findings.filter(f => f.status === 'open') },
    { label: 'PR opened',      status: 'pr-opened' as const, rows: findings.filter(f => f.status === 'pr-opened') },
    { label: 'Won’t fix', status: 'wont-fix' as const, rows: findings.filter(f => f.status === 'wont-fix') },
    { label: 'Merged',         status: 'merged'    as const, rows: findings.filter(f => f.status === 'merged') },
  ]).filter(g => g.rows.length > 0)

  async function markWontFix(id: string) {
    if (!confirm('Mark this finding as wont-fix?')) return
    await fetch(`/api/bug-hunt/${encodeURIComponent(sessionId)}/findings/${encodeURIComponent(id)}`, {
      method:  'PATCH',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ status: 'wont-fix' }),
    })
    await reload()
  }

  return (
    <div className="space-y-3">
      {groups.map(g => (
        <div key={g.status} className="space-y-1">
          <div className="text-[10px] uppercase tracking-[0.14em] px-1" style={{ color: '#55556a' }}>{g.label} · {g.rows.length}</div>
          {g.rows.map(f => <FindingRow key={f.id} f={f} onWontFix={() => markWontFix(f.id)} />)}
        </div>
      ))}
    </div>
  )
}

function FindingRow({ f, onWontFix }: { f: BugHuntFindingRow; onWontFix: () => void }) {
  const sevColor = f.severity === 'p0' ? '#ef4444' : f.severity === 'p1' ? '#f59e0b' : f.severity === 'p2' ? '#a8a3ff' : '#9090b0'
  return (
    <div className="group rounded p-2 flex items-start gap-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded shrink-0 mt-0.5" style={{ background: `${sevColor}22`, color: sevColor }}>{f.severity}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs" style={{ color: '#e8e8f0' }}>{f.title}</div>
        {f.source_path && <div className="text-[10px] font-mono mt-0.5 truncate" style={{ color: '#9090b0' }} title={f.source_path}>{f.source_path}</div>}
        {f.pr_url && (
          <a href={f.pr_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 text-[10px]" style={{ color: '#a8a3ff' }}>
            <ExternalLink size={9} /> {f.pr_url.replace(/.*\/pull\/(\d+).*/, 'PR #$1')}
          </a>
        )}
      </div>
      {f.status === 'open' && (
        <button onClick={onWontFix} title="Mark wont-fix" className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ color: '#9090b0', border: '1px solid rgba(255,255,255,0.08)' }}>
          Wont-fix
        </button>
      )}
    </div>
  )
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="rounded p-2 text-xs flex items-start gap-1.5" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}>
      <AlertCircle size={11} className="mt-0.5 shrink-0" />
      <span>{msg}</span>
    </div>
  )
}

// Re-exported for parent usage tracking (Views dropdown badge)
export const __CHECKMARK = CheckCircle2

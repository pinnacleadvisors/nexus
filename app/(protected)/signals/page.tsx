'use client'

/**
 * /signals — Platform-improvement inbox.
 * Capture an idea / link / error / question; a daily LLM council
 * (memory → architect → tester → judge) decides accepted | rejected | deferred.
 */

import { useEffect, useState } from 'react'
import {
  Inbox,
  Lightbulb,
  Link as LinkIcon,
  AlertTriangle,
  HelpCircle,
  Loader2,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  Play,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  Signal,
  SignalEvaluation,
  SignalKind,
  SignalStatus,
  SignalWithEvaluations,
} from '@/lib/signals/types'

// ── Visual mappings ─────────────────────────────────────────────────────────
const KINDS: { value: SignalKind; label: string; icon: LucideIcon; placeholder: string }[] = [
  { value: 'idea',     label: 'Idea',     icon: Lightbulb,      placeholder: 'A thought to improve the platform…' },
  { value: 'link',     label: 'Link',     icon: LinkIcon,       placeholder: 'Why is this URL interesting?' },
  { value: 'error',    label: 'Error',    icon: AlertTriangle,  placeholder: 'Paste the error or a description…' },
  { value: 'question', label: 'Question', icon: HelpCircle,     placeholder: 'What are you trying to figure out?' },
]

const STATUS_META: Record<SignalStatus, { label: string; color: string; bg: string }> = {
  new:         { label: 'New',         color: '#6c63ff', bg: '#6c63ff22' },
  triaging:    { label: 'Triaging',    color: '#f59e0b', bg: '#f59e0b22' },
  accepted:    { label: 'Accepted',    color: '#22c55e', bg: '#22c55e22' },
  rejected:    { label: 'Rejected',    color: '#ef4444', bg: '#ef444422' },
  deferred:    { label: 'Deferred',    color: '#9090b0', bg: '#9090b022' },
  implemented: { label: 'Implemented', color: '#06b6d4', bg: '#06b6d422' },
}

const FILTER_ORDER: (SignalStatus | 'all')[] = [
  'all', 'new', 'triaging', 'accepted', 'deferred', 'rejected', 'implemented',
]

// ── Page ─────────────────────────────────────────────────────────────────────
export default function SignalsPage() {
  const [kind, setKind]                 = useState<SignalKind>('idea')
  const [title, setTitle]               = useState('')
  const [body, setBody]                 = useState('')
  const [url, setUrl]                   = useState('')
  const [posting, setPosting]           = useState(false)
  const [error, setError]               = useState<string | null>(null)

  const [signals, setSignals]           = useState<Signal[]>([])
  const [loading, setLoading]           = useState(true)
  const [filter, setFilter]             = useState<SignalStatus | 'all'>('all')
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [detail, setDetail]             = useState<SignalWithEvaluations | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [reviewing, setReviewing]       = useState<string | null>(null)

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => { void refresh() }, [])

  async function refresh() {
    setLoading(true)
    try {
      const res = await fetch('/api/signals')
      if (res.ok) {
        const data = await res.json() as { signals: Signal[] }
        setSignals(data.signals ?? [])
      }
    } catch { /* non-fatal */ }
    finally { setLoading(false) }
  }

  // ── Capture ──────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!title.trim() || posting) return
    setPosting(true); setError(null)
    try {
      const res = await fetch('/api/signals', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind, title: title.trim(),
          body: body.trim() || undefined,
          url:  url.trim()  || undefined,
        }),
      })
      const data = await res.json() as { signal?: Signal; error?: string }
      if (!res.ok || !data.signal) {
        setError(data.error ?? `Failed (${res.status})`)
        return
      }
      setSignals(prev => [data.signal!, ...prev])
      setTitle(''); setBody(''); setUrl('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPosting(false)
    }
  }

  // ── Detail expand ────────────────────────────────────────────────────────
  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null); setDetail(null); return
    }
    setExpandedId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/signals?id=${id}`)
      if (res.ok) {
        const data = await res.json() as { signal: SignalWithEvaluations }
        setDetail(data.signal)
      }
    } catch { /* non-fatal */ }
    finally { setDetailLoading(false) }
  }

  // ── Manual council run ──────────────────────────────────────────────────
  async function runCouncil(id: string) {
    setReviewing(id)
    setError(null)
    try {
      const res = await fetch(`/api/cron/signal-review?id=${id}`, { method: 'POST' })
      const data = await res.json() as { ok: boolean; error?: string; results?: unknown[] }
      if (!res.ok) {
        setError(data.error ?? 'Council run failed')
        return
      }
      // Refresh both list + open detail
      await refresh()
      if (expandedId === id) {
        const r = await fetch(`/api/signals?id=${id}`)
        if (r.ok) {
          const d = await r.json() as { signal: SignalWithEvaluations }
          setDetail(d.signal)
        }
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setReviewing(null)
    }
  }

  // ── Manual status flip ──────────────────────────────────────────────────
  async function setStatus(id: string, status: SignalStatus) {
    try {
      const res = await fetch('/api/signals', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id, status }),
      })
      if (res.ok) {
        const data = await res.json() as { signal: Signal }
        setSignals(prev => prev.map(s => s.id === id ? data.signal : s))
        if (detail?.id === id) setDetail({ ...detail, ...data.signal })
      }
    } catch { /* non-fatal */ }
  }

  const filtered = filter === 'all'
    ? signals
    : signals.filter(s => s.status === filter)

  const counts: Record<SignalStatus | 'all', number> = {
    all: signals.length,
    new: 0, triaging: 0, accepted: 0, rejected: 0, deferred: 0, implemented: 0,
  }
  for (const s of signals) counts[s.status] += 1

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#050508' }}>
      {/* Header */}
      <div className="px-6 py-5 border-b shrink-0" style={{ borderColor: '#1a1a2e' }}>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center w-9 h-9 rounded-lg"
            style={{ backgroundColor: '#6c63ff22', border: '1px solid #6c63ff44' }}
          >
            <Inbox size={18} style={{ color: '#6c63ff' }} />
          </div>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: '#e8e8f0' }}>Signals</h1>
            <p className="text-xs" style={{ color: '#6c6c88' }}>
              Capture ideas, links, errors, questions — a daily LLM council triages them
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* ── Left: capture form ─────────────────────────────────────────── */}
        <div
          className="w-96 shrink-0 flex flex-col border-r overflow-y-auto"
          style={{ borderColor: '#1a1a2e', backgroundColor: '#0d0d14' }}
        >
          <div className="p-5 space-y-5">
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#6c6c88' }}>KIND</label>
              <div className="grid grid-cols-2 gap-2">
                {KINDS.map(k => {
                  const Icon = k.icon
                  const active = kind === k.value
                  return (
                    <button
                      key={k.value}
                      onClick={() => setKind(k.value)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-sm transition-colors"
                      style={active
                        ? { backgroundColor: '#1a1a2e', borderColor: '#6c63ff', color: '#e8e8f0' }
                        : { backgroundColor: 'transparent', borderColor: '#24243e', color: '#9090b0' }}
                    >
                      <Icon size={14} />
                      {k.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#6c6c88' }}>TITLE</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="One-line summary"
                maxLength={200}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ backgroundColor: '#12121e', border: '1px solid #24243e', color: '#e8e8f0' }}
                onFocus={e => { (e.target as HTMLInputElement).style.borderColor = '#6c63ff66' }}
                onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = '#24243e' }}
                disabled={posting}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#6c6c88' }}>DETAILS</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={KINDS.find(k => k.value === kind)?.placeholder}
                rows={6}
                maxLength={10_000}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
                style={{
                  backgroundColor: '#12121e', border: '1px solid #24243e', color: '#e8e8f0',
                  fontFamily: kind === 'error' ? 'monospace' : 'inherit',
                  fontSize:   kind === 'error' ? '0.75rem' : '0.875rem',
                }}
                onFocus={e => { (e.target as HTMLTextAreaElement).style.borderColor = '#6c63ff66' }}
                onBlur={e  => { (e.target as HTMLTextAreaElement).style.borderColor = '#24243e' }}
                disabled={posting}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#6c6c88' }}>
                URL <span className="opacity-60">(optional — Firecrawl scrape)</span>
              </label>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://…"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ backgroundColor: '#12121e', border: '1px solid #24243e', color: '#e8e8f0' }}
                onFocus={e => { (e.target as HTMLInputElement).style.borderColor = '#6c63ff66' }}
                onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = '#24243e' }}
                disabled={posting}
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={!title.trim() || posting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50"
              style={{ backgroundColor: '#6c63ff', color: '#fff' }}
            >
              {posting
                ? <><Loader2 size={14} className="animate-spin" />Saving…</>
                : <><Send size={14} />Capture signal</>}
            </button>

            {error && (
              <div className="rounded-lg px-3 py-2 text-xs flex items-center gap-2"
                style={{ backgroundColor: '#1a0d0d', border: '1px solid #ef444444', color: '#c08080' }}>
                <AlertTriangle size={12} />{error}
              </div>
            )}

            <div className="rounded-lg p-3 text-xs space-y-1" style={{ backgroundColor: '#12121e', color: '#6c6c88' }}>
              <div className="font-medium" style={{ color: '#9090b0' }}>How the council works</div>
              <p>Each new signal runs through 4 LLM passes — Memory check → Architect → Tester → Judge. The Judge writes a verdict ({`accepted | rejected | deferred`}). Accepted signals get promoted to the roadmap.</p>
            </div>
          </div>
        </div>

        {/* ── Right: list ────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Filter pills */}
          <div className="px-6 py-3 flex items-center justify-between gap-3 border-b shrink-0" style={{ borderColor: '#1a1a2e' }}>
            <div className="flex flex-wrap gap-2">
              {FILTER_ORDER.map(f => {
                const active = filter === f
                const meta = f === 'all' ? null : STATUS_META[f]
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                    style={active && meta
                      ? { backgroundColor: meta.bg, color: meta.color, border: `1px solid ${meta.color}44` }
                      : active
                      ? { backgroundColor: '#6c63ff22', color: '#6c63ff', border: '1px solid #6c63ff44' }
                      : { backgroundColor: '#12121e', color: '#6c6c88', border: '1px solid #24243e' }}
                  >
                    {f === 'all' ? 'All' : STATUS_META[f].label}
                    <span className="ml-1.5 opacity-70">{counts[f]}</span>
                  </button>
                )
              })}
            </div>
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors disabled:opacity-50"
              style={{ color: '#9090b0', border: '1px solid #24243e', backgroundColor: 'transparent' }}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading && signals.length === 0 ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: '#6c6c88' }}>
                <Loader2 size={14} className="animate-spin" />
                Loading signals…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center text-center gap-2 py-20">
                <Inbox size={32} style={{ color: '#24243e' }} />
                <p className="text-sm" style={{ color: '#6c6c88' }}>
                  {filter === 'all' ? 'No signals yet — capture your first one on the left' : `No signals in "${STATUS_META[filter as SignalStatus].label}"`}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(s => {
                  const meta   = STATUS_META[s.status]
                  const KindIcon = (KINDS.find(k => k.value === s.kind)?.icon ?? Lightbulb)
                  const expanded = expandedId === s.id
                  return (
                    <div
                      key={s.id}
                      className="rounded-xl border overflow-hidden"
                      style={{ borderColor: '#24243e', backgroundColor: '#0d0d14' }}
                    >
                      {/* Row */}
                      <button
                        onClick={() => toggleExpand(s.id)}
                        className="w-full flex items-start gap-3 px-4 py-3 text-left"
                      >
                        <div className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 mt-0.5"
                          style={{ backgroundColor: '#1a1a2e', color: '#9090b0' }}>
                          <KindIcon size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>{s.title}</p>
                            <span
                              className="px-2 py-0.5 rounded text-xs font-medium shrink-0"
                              style={{ backgroundColor: meta.bg, color: meta.color }}
                            >{meta.label}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: '#6c6c88' }}>
                            <span className="flex items-center gap-1">
                              <Clock size={11} />{new Date(s.createdAt).toLocaleString()}
                            </span>
                            {s.url && (
                              <span className="flex items-center gap-1 truncate max-w-xs">
                                <LinkIcon size={11} />
                                <span className="truncate">{s.url}</span>
                              </span>
                            )}
                          </div>
                          {s.decidedReason && !expanded && (
                            <p className="text-xs mt-1 line-clamp-2" style={{ color: '#9090b0' }}>{s.decidedReason}</p>
                          )}
                        </div>
                        <div className="shrink-0 mt-1" style={{ color: '#55556a' }}>
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </div>
                      </button>

                      {/* Expanded detail */}
                      {expanded && (
                        <div className="px-4 pb-4 border-t" style={{ borderColor: '#1a1a2e' }}>
                          {detailLoading ? (
                            <div className="py-3 space-y-2" aria-busy="true" aria-label="Loading evaluations">
                              <div className="h-3 w-1/3 rounded animate-pulse" style={{ backgroundColor: '#1a1a2e' }} />
                              <div className="h-3 w-3/4 rounded animate-pulse" style={{ backgroundColor: '#1a1a2e' }} />
                              <div className="h-3 w-2/3 rounded animate-pulse" style={{ backgroundColor: '#1a1a2e' }} />
                              <div className="h-3 w-4/5 rounded animate-pulse" style={{ backgroundColor: '#1a1a2e' }} />
                            </div>
                          ) : detail && detail.id === s.id ? (
                            <DetailPanel
                              signal={detail}
                              reviewing={reviewing === s.id}
                              onRunCouncil={() => runCouncil(s.id)}
                              onSetStatus={(status) => setStatus(s.id, status)}
                            />
                          ) : null}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Detail panel ─────────────────────────────────────────────────────────────
function DetailPanel({
  signal,
  reviewing,
  onRunCouncil,
  onSetStatus,
}: {
  signal:        SignalWithEvaluations
  reviewing:     boolean
  onRunCouncil:  () => void
  onSetStatus:   (status: SignalStatus) => void
}) {
  const ROLE_LABEL: Record<SignalEvaluation['role'], string> = {
    scout:     'Scout (Firecrawl)',
    memory:    'Memory check',
    architect: 'Architect',
    tester:    'Tester',
    judge:     'Judge',
  }

  const canRunCouncil = signal.status === 'new' || signal.status === 'triaging'
  const canMarkImplemented = signal.status === 'accepted'

  return (
    <div className="pt-4 space-y-4">
      {signal.body && (
        <div>
          <div className="text-xs font-medium mb-1" style={{ color: '#6c6c88' }}>BODY</div>
          <p className="text-sm whitespace-pre-wrap" style={{ color: '#c0c0d8' }}>{signal.body}</p>
        </div>
      )}

      {signal.url && (
        <a
          href={signal.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs"
          style={{ color: '#6c63ff' }}
        >
          <ExternalLink size={11} />
          {signal.url}
        </a>
      )}

      {/* Council actions */}
      <div className="flex flex-wrap gap-2">
        {canRunCouncil && (
          <button
            onClick={onRunCouncil}
            disabled={reviewing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity disabled:opacity-60"
            style={{ backgroundColor: '#6c63ff', color: '#fff' }}
          >
            {reviewing
              ? <><Loader2 size={12} className="animate-spin" />Running council…</>
              : <><Play size={12} />Run council now</>}
          </button>
        )}
        {canMarkImplemented && (
          <button
            onClick={() => onSetStatus('implemented')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ backgroundColor: '#06b6d422', color: '#06b6d4', border: '1px solid #06b6d444' }}
          >
            <CheckCircle2 size={12} />Mark implemented
          </button>
        )}
        <button
          onClick={() => onSetStatus('rejected')}
          disabled={signal.status === 'rejected'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
          style={{ backgroundColor: 'transparent', color: '#9090b0', border: '1px solid #24243e' }}
        >
          <XCircle size={12} />Reject
        </button>
        <button
          onClick={() => onSetStatus('deferred')}
          disabled={signal.status === 'deferred'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
          style={{ backgroundColor: 'transparent', color: '#9090b0', border: '1px solid #24243e' }}
        >
          <Clock size={12} />Defer
        </button>
      </div>

      {/* Decided reason */}
      {signal.decidedReason && (
        <div className="rounded-lg p-3 text-xs"
          style={{ backgroundColor: '#12121e', border: '1px solid #1a1a2e' }}>
          <div className="flex items-center gap-1.5 mb-1" style={{ color: '#6c6c88' }}>
            <Sparkles size={11} />Verdict reason
          </div>
          <p style={{ color: '#c0c0d8' }}>{signal.decidedReason}</p>
        </div>
      )}

      {/* Evaluations */}
      {signal.evaluations.length === 0 ? (
        <div className="text-xs" style={{ color: '#6c6c88' }}>
          No evaluations yet. The cron will pick this up on its next pass, or trigger manually above.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs font-medium" style={{ color: '#6c6c88' }}>COUNCIL TRAIL</div>
          {signal.evaluations.map(ev => (
            <div
              key={ev.id}
              className="rounded-lg p-3"
              style={{ backgroundColor: '#12121e', border: '1px solid #1a1a2e' }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium" style={{ color: '#9090b0' }}>
                  {ROLE_LABEL[ev.role]}
                </span>
                <div className="flex items-center gap-2">
                  {ev.verdict && (
                    <span className="px-1.5 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: STATUS_META[ev.verdict as SignalStatus]?.bg ?? '#9090b022',
                        color:           STATUS_META[ev.verdict as SignalStatus]?.color ?? '#9090b0',
                      }}>
                      {ev.verdict}
                    </span>
                  )}
                  <span className="text-xs" style={{ color: '#55556a' }}>
                    {new Date(ev.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              </div>
              <p className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: '#c0c0d8' }}>
                {ev.reasoning}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

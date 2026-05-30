'use client'

/**
 * FleetApprovalInbox — unified "where do I need to click?" inbox at the top
 * of /dashboard. Aggregates pending approval-requests across every chat
 * scope the operator owns (platform + every business), so the CEO doesn't
 * have to walk each chat surface separately.
 *
 * Addresses 2026-05-16 audit Section 7 #2 + Section 8 #11.
 *
 * Reads /api/approvals/fleet — one fetch on mount + a manual Refresh button.
 * No polling (approvals are rare events; polling would burn budget for no
 * gain). After approving / replying in a chat, the operator can click
 * Refresh to re-pull state.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, AlertCircle, ChevronRight, Loader2, Inbox, RefreshCw, Check } from 'lucide-react'

type ApprovalKind =
  | 'chat-emitted'
  | 'operator-task'
  | 'cron-alert'
  | 'stalled-run'
  | 'budget-incident'
  | 'chat-turn'

const SYSTEM_ALERT_KINDS = new Set<ApprovalKind>(['cron-alert', 'stalled-run', 'budget-incident', 'chat-turn'])

interface FleetPendingItem {
  scope:         string  // 'admin' OR 'business:<slug>'
  scope_label:   string  // 'Platform' OR business display name
  kind:          ApprovalKind  // origin discriminator
  session_id:    string
  session_title: string
  message_id:    string
  created_at:    string
  approval:      {
    title:       string
    approval_id: string
    items:       Array<{ id: string; label: string; approved_by_default?: boolean }>
  }
}

const KIND_LABEL: Record<ApprovalKind, string> = {
  'chat-emitted':    'chat',
  'operator-task':   'task',
  'cron-alert':      'cron',
  'stalled-run':     'stalled',
  'budget-incident': 'budget',
  'chat-turn':       'chat',
}
const KIND_STYLE: Record<ApprovalKind, { bg: string; color: string; border: string }> = {
  'chat-emitted':    { bg: 'rgba(34,211,238,0.12)',  color: '#67e8f9', border: '1px solid rgba(34,211,238,0.25)'  },
  'operator-task':   { bg: 'rgba(168,85,247,0.12)',  color: '#c4b5fd', border: '1px solid rgba(168,85,247,0.25)'  },
  // System alerts share an amber-to-rose palette so they're visually
  // distinct from approval cards (which the operator must DECIDE on).
  // Alerts are informational — they auto-clear when the source recovers.
  'cron-alert':      { bg: 'rgba(245,158,11,0.12)',  color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)'  },
  'stalled-run':     { bg: 'rgba(249,115,22,0.12)',  color: '#fdba74', border: '1px solid rgba(249,115,22,0.25)'  },
  'budget-incident': { bg: 'rgba(244,63,94,0.12)',   color: '#fda4af', border: '1px solid rgba(244,63,94,0.25)'   },
  'chat-turn':       { bg: 'rgba(244,63,94,0.12)',   color: '#fda4af', border: '1px solid rgba(244,63,94,0.25)'   },
}
const KIND_TITLE: Record<ApprovalKind, string> = {
  'chat-emitted':    'Approval emitted as a chat block — resolve by replying APPROVAL [id]: ... or click ✓',
  'operator-task':   'Approval row in the approvals Postgres table — decided via the approval-card form',
  'cron-alert':      'A cron job is failing. Check /cron-health for details. Auto-clears when the cron returns to green.',
  'stalled-run':     'A run has been in "running" status for > 4 hours. Cancel from the relevant business page if it hung.',
  'budget-incident': 'Cost-guard kill switch fired in the last 7 days. Inspect /api/health/deep for the spend trail.',
  'chat-turn':       'A chat turn crashed or never reached the gateway in the last 7 days. Reopen the chat to retry.',
}

interface ApiOk  { ok: true;  pending: FleetPendingItem[] }
interface ApiErr { ok: false; error: string }

/** Where clicking a pending item lands the operator — platform vs business chat. */
function landingPathFor(scope: string, sessionId: string, approvalId: string): string {
  const base = scope === 'admin' || scope === 'platform'
    ? '/manage-platform'
    : `/businesses/${encodeURIComponent(scope.slice('business:'.length))}/chat`
  return `${base}?session=${encodeURIComponent(sessionId)}#approval-${encodeURIComponent(approvalId)}`
}

export default function FleetApprovalInbox() {
  const [pending, setPending]   = useState<FleetPendingItem[] | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Tracks the approval_ids currently being dismissed so the operator can't
  // double-click + the button shows a spinner.
  const [resolving, setResolving] = useState<Set<string>>(() => new Set())

  const reload = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/approvals/fleet', {
        cache:  'no-store',
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error(`approvals/fleet HTTP ${res.status}`)
      const j = (await res.json()) as ApiOk | ApiErr
      if (!j.ok) { setError(j.error); return }
      setPending(j.pending)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load approvals')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  /**
   * Mark a single approval resolved without leaving the inbox. POSTs to
   * /api/approvals/resolve which writes an APPROVAL [id]: user message
   * into the source chat. The next reload sees the reply via isResolved
   * and the row drops out of the pending list. Optimistically removes
   * the row from local state so the UI feels instant.
   */
  const resolveOne = useCallback(async (item: FleetPendingItem) => {
    const id = item.approval.approval_id
    if (resolving.has(id)) return
    setResolving(prev => new Set(prev).add(id))
    // Optimistic removal — restore on failure.
    const prev = pending
    setPending(p => (p ?? []).filter(x => x.approval.approval_id !== id))
    try {
      const res = await fetch('/api/approvals/resolve', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          session_id:  item.session_id,
          approval_id: id,
        }),
        cache:  'no-store',
        signal: AbortSignal.timeout(15_000),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!j.ok) {
        // Rollback optimistic removal.
        setPending(prev)
        setError(`Could not mark resolved: ${j.error ?? 'unknown'}`)
      }
    } catch (e) {
      setPending(prev)
      setError(e instanceof Error ? e.message : 'failed to mark resolved')
    } finally {
      setResolving(curr => {
        const next = new Set(curr)
        next.delete(id)
        return next
      })
    }
  }, [pending, resolving])

  // Silent on hard error — the dashboard has other panels and a fleet
  // inbox that fails shouldn't blank the page.
  if (error && pending === null) return null

  if (pending === null) {
    return (
      <div
        className="rounded-xl p-3 flex items-center gap-2 text-xs"
        style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#9090b0' }}
        aria-busy="true"
        aria-label="Loading fleet approval inbox"
      >
        <Loader2 size={12} className="animate-spin" /> Loading approvals…
      </div>
    )
  }

  if (pending.length === 0) {
    return (
      <div
        className="rounded-xl p-3 flex items-center gap-2.5 text-xs"
        style={{
          background:           'linear-gradient(135deg, rgba(34,197,94,0.05), rgba(255,255,255,0.02))',
          backdropFilter:       'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border:               '1px solid rgba(34,197,94,0.15)',
          color:                '#9090b0',
        }}
      >
        <CheckCircle2 size={13} style={{ color: '#4ade80' }} />
        <span>No pending approvals across the fleet.</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void reload()}
          disabled={refreshing}
          className="inline-flex items-center transition-colors disabled:opacity-50"
          style={{ color: '#55556a' }}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>
    )
  }

  // Group by scope for compact display.
  const byScope = new Map<string, FleetPendingItem[]>()
  for (const p of pending) {
    const arr = byScope.get(p.scope) ?? []
    arr.push(p)
    byScope.set(p.scope, arr)
  }

  return (
    <div
      className="rounded-xl p-3"
      style={{
        background:           'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(255,255,255,0.02))',
        backdropFilter:       'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border:               '1px solid rgba(245,158,11,0.20)',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.04) inset',
      }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <Inbox size={13} style={{ color: '#f59e0b' }} />
        <span className="text-xs uppercase tracking-wide font-medium" style={{ color: '#e8e8f0' }}>
          Approvals waiting
        </span>
        <span
          className="px-1.5 py-0.5 text-[10px] font-mono rounded-full"
          style={{
            background: 'rgba(245,158,11,0.18)',
            border:     '1px solid rgba(245,158,11,0.30)',
            color:      '#fbbf24',
          }}
        >
          {pending.length}
        </span>
        <span className="text-[10px]" style={{ color: '#55556a' }}>
          across {byScope.size} scope{byScope.size === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void reload()}
          className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors"
          style={{
            color:      '#9090b0',
            background: 'rgba(255,255,255,0.03)',
            border:     '1px solid rgba(255,255,255,0.08)',
          }}
          title="Re-pull pending approvals"
          disabled={refreshing}
        >
          <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="space-y-1.5">
        {pending.slice(0, 8).map(p => {
          const isResolving = resolving.has(p.approval.approval_id)
          return (
            <div
              key={`${p.scope}-${p.session_id}-${p.approval.approval_id}`}
              className="relative rounded-lg p-2.5 transition-colors"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
            >
              <Link
                href={landingPathFor(p.scope, p.session_id, p.approval.approval_id)}
                className="block"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle size={11} style={{ color: '#f59e0b' }} className="mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0 pr-7">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded shrink-0"
                        style={{
                          background: p.scope === 'admin'
                            ? 'rgba(108,99,255,0.12)'
                            : 'rgba(34,197,94,0.10)',
                          color: p.scope === 'admin' ? '#a8a3ff' : '#4ade80',
                          border: p.scope === 'admin'
                            ? '1px solid rgba(108,99,255,0.25)'
                            : '1px solid rgba(34,197,94,0.22)',
                        }}
                        title={`scope: ${p.scope}`}
                      >
                        {p.scope_label}
                      </span>
                      <span
                        className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded shrink-0"
                        style={KIND_STYLE[p.kind]}
                        title={KIND_TITLE[p.kind]}
                      >
                        {KIND_LABEL[p.kind]}
                      </span>
                      <span className="text-xs font-medium truncate" style={{ color: '#e8e8f0' }}>
                        {p.approval.title}
                      </span>
                    </div>
                    <div className="text-[10px] mt-0.5 truncate" style={{ color: '#9090b0' }}>
                      {SYSTEM_ALERT_KINDS.has(p.kind)
                        ? <>info-only · auto-clears</>
                        : <>{p.approval.items.length} item{p.approval.items.length === 1 ? '' : 's'}</>}
                      {' · in '}
                      <span className="font-medium">{p.session_title}</span>
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: '#55556a' }}>
                      {new Date(p.created_at).toLocaleString()}
                    </div>
                  </div>
                  <ChevronRight size={11} style={{ color: '#55556a' }} className="mt-0.5 shrink-0" />
                </div>
              </Link>
              {/*
                Mark-resolved button — absolutely positioned so the parent
                Link covers the rest of the row, but a click on the check
                doesn't propagate. Sits in the gap right of the chevron.
              */}
              {!SYSTEM_ALERT_KINDS.has(p.kind) && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); void resolveOne(p) }}
                  disabled={isResolving}
                  className="absolute right-2 top-2 inline-flex items-center justify-center rounded-md p-1 transition-colors disabled:opacity-50"
                  style={{
                    color:      '#9090b0',
                    background: 'rgba(255,255,255,0.04)',
                    border:     '1px solid rgba(255,255,255,0.08)',
                  }}
                  title="Mark resolved — writes an APPROVAL [id]: reply into the source chat so this clears from the inbox. Use when you already shipped the fix out of band."
                  aria-label="Mark approval resolved"
                >
                  {isResolving
                    ? <Loader2 size={10} className="animate-spin" />
                    : <Check size={10} />}
                </button>
              )}
            </div>
          )
        })}
        {pending.length > 8 && (
          <div className="text-[10px] text-center pt-1" style={{ color: '#55556a' }}>
            …and {pending.length - 8} more — open each chat to clear them.
          </div>
        )}
      </div>
    </div>
  )
}

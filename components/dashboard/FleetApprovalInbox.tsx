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
import { CheckCircle2, AlertCircle, ChevronRight, Loader2, Inbox, RefreshCw } from 'lucide-react'

interface FleetPendingItem {
  scope:         string  // 'admin' OR 'business:<slug>'
  scope_label:   string  // 'Platform' OR business display name
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
        {pending.slice(0, 8).map(p => (
          <Link
            key={`${p.scope}-${p.session_id}-${p.approval.approval_id}`}
            href={landingPathFor(p.scope, p.session_id, p.approval.approval_id)}
            className="block rounded-lg p-2.5 transition-colors"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
          >
            <div className="flex items-start gap-2">
              <AlertCircle size={11} style={{ color: '#f59e0b' }} className="mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
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
                  <span className="text-xs font-medium truncate" style={{ color: '#e8e8f0' }}>
                    {p.approval.title}
                  </span>
                </div>
                <div className="text-[10px] mt-0.5 truncate" style={{ color: '#9090b0' }}>
                  {p.approval.items.length} item{p.approval.items.length === 1 ? '' : 's'}
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
        ))}
        {pending.length > 8 && (
          <div className="text-[10px] text-center pt-1" style={{ color: '#55556a' }}>
            …and {pending.length - 8} more — open each chat to clear them.
          </div>
        )}
      </div>
    </div>
  )
}

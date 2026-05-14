'use client'

/**
 * ApprovalsView — pending approval-requests across every chat session in
 * this scope, derived from chat_messages.metadata.approval_requests.
 *
 * Each row links the operator back to the chat that surfaced the
 * approval — clicking opens the session and scrolls to the approval card.
 * Resolution detection is server-side (looks for `APPROVAL [<id>]:` later
 * in the same session).
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, AlertCircle, ChevronRight } from 'lucide-react'
import type { ApprovalRequest } from '@/lib/chat/approval'

interface PendingItem {
  session_id:    string
  session_title: string
  message_id:    string
  created_at:    string
  approval:      ApprovalRequest
}

interface Props {
  scope: string
  /** Where clicking a row should take the operator (one of two surfaces). */
  sessionsBasePath: string
  onCountChange?: (count: number) => void
}

export default function ApprovalsView({ scope, sessionsBasePath, onCountChange }: Props) {
  const [pending, setPending] = useState<PendingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/views/approvals?scope=${encodeURIComponent(scope)}`, { cache: 'no-store' })
      if (!res.ok) { setErr(`HTTP ${res.status}`); return }
      const j = (await res.json()) as { ok: true; pending: PendingItem[] } | { ok: false; error: string }
      if (!j.ok) { setErr(j.error); return }
      setPending(j.pending)
      setErr(null)
      onCountChange?.(j.pending.length)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load')
    } finally { setLoading(false) }
  }, [scope, onCountChange])

  useEffect(() => { void reload() }, [reload])

  return (
    <div className="px-3 py-3 space-y-2">
      {loading && pending.length === 0 && (
        <div className="flex items-center gap-2 text-xs py-6 justify-center" style={{ color: '#9090b0' }}>
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      )}

      {err && (
        <div className="text-xs rounded p-2" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}>{err}</div>
      )}

      {!loading && !err && pending.length === 0 && (
        <div className="text-[11px] text-center py-6" style={{ color: '#55556a' }}>
          No pending approvals. Approval cards appear here automatically when the copilot proposes a destructive action.
        </div>
      )}

      {pending.map(p => (
        <Link
          key={`${p.session_id}-${p.approval.approval_id}`}
          href={`${sessionsBasePath}?session=${encodeURIComponent(p.session_id)}#approval-${encodeURIComponent(p.approval.approval_id)}`}
          className="block rounded-lg p-2.5 transition-colors"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
        >
          <div className="flex items-start gap-2">
            <AlertCircle size={12} style={{ color: '#f59e0b' }} className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate" style={{ color: '#e8e8f0' }}>{p.approval.title}</div>
              <div className="text-[10px] mt-0.5 truncate" style={{ color: '#9090b0' }}>
                {p.approval.items.length} item{p.approval.items.length === 1 ? '' : 's'} · in <span className="font-medium">{p.session_title}</span>
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: '#55556a' }}>{new Date(p.created_at).toLocaleString()}</div>
            </div>
            <ChevronRight size={12} style={{ color: '#55556a' }} className="mt-0.5 shrink-0" />
          </div>
        </Link>
      ))}
    </div>
  )
}

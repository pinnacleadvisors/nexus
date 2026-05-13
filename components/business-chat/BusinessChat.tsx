'use client'

/**
 * BusinessChat — /businesses/[slug]/chat body (Phase 5a, MVP).
 *
 * Single rolling chat per business — no sidebar yet (multi-session for
 * per-business is a follow-up; the chat_sessions schema already supports
 * `scope='business:<slug>'`, just no UI to manage multiple).
 *
 * Reuses the platform chat's primitives:
 *   - ApprovalCard for inline approval gates
 *   - Approval reply protocol via lib/chat/approval
 *   - Job enqueue + poll loop
 *
 * Differences from PlatformChat (Phase 5b/full-parity will close these):
 *   - No SessionSidebar (single rolling chat per business)
 *   - No multi-chat / delete UI
 *   - Hits /api/businesses/<slug>/chat instead of /api/platform-chat
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, Send, AlertTriangle, X as XIcon, Briefcase } from 'lucide-react'
import ApprovalCard from '@/components/platform-chat/ApprovalCard'
import { buildApprovalReply, type ApprovalRequest } from '@/lib/chat/approval'

interface Message {
  role:                  'user' | 'assistant'
  content:               string
  durationMs?:           number
  approval_requests?:    ApprovalRequest[]
  approval_resolutions?: Record<string, { approvedItemIds: string[]; deniedItemIds: string[] }>
}

interface EnqueueResp { ok: true; jobId: string; sessionId: string }
interface ErrResp     { ok: false; error: string; code: string }
interface PollResp    { ok: true; status: 'pending' | 'running' | 'done' | 'error'; text?: string; approval_requests?: ApprovalRequest[]; jobError?: string; durationMs?: number }
interface MsgRow      { id: string; role: 'user'|'assistant'|'system'; content: string; metadata?: { approval_requests?: ApprovalRequest[]; durationMs?: number } }

const POLL_INTERVAL_MS = 2_500
const POLL_TIMEOUT_MS  = 5 * 60_000

interface Props {
  slug: string
  name: string
}

export default function BusinessChat({ slug, name }: Props) {
  const [messages, setMessages]     = useState<Message[]>([])
  const [input,    setInput]        = useState('')
  const [busy,     setBusy]         = useState(false)
  const [error,    setError]        = useState<string | null>(null)
  const [sessionId, setSessionId]   = useState<string | null>(null)
  const cancelRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])

  // On mount, fetch the most-recent business-scope session for this slug
  // and its history. The first send() also auto-resolves a session if none
  // exists yet, so this is a "warm-start if there's anything to warm" step.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/platform-chat/sessions', { cache: 'no-store' })
        if (!res.ok) return
        const j = await res.json() as { ok: true; sessions: Array<{ id: string; scope?: string; agent_slug?: string; last_message_at?: string; title?: string }> } | { ok: false }
        if (!j.ok || cancelled) return
        // platform-chat/sessions returns scope='platform' only. We need a
        // business-scope listing. Since we don't yet have a per-business
        // sessions endpoint, query the platform endpoint and skip — the
        // enqueue route will resolve/create on first send. Net result: a
        // brand-new tab starts fresh, history hydrates after first turn.
        // Follow-up: add GET /api/businesses/[slug]/chat/sessions for full
        // history hydration on mount.
      } catch { /* swallow */ }
    })()
    return () => { cancelled = true }
  }, [slug])

  // Once we have a sessionId (post-first-turn), hydrate history.
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/platform-chat/sessions/${sessionId}/messages`, { cache: 'no-store' })
        if (!res.ok) return
        const j = await res.json() as { ok: true; messages: MsgRow[] } | { ok: false }
        if (!j.ok || cancelled) return
        setMessages(j.messages.map(m => ({
          role:              m.role === 'system' ? 'assistant' : m.role,
          content:           m.content,
          durationMs:        m.metadata?.durationMs,
          approval_requests: m.metadata?.approval_requests,
        })))
      } catch { /* swallow */ }
    })()
    return () => { cancelled = true }
  }, [sessionId])

  function handleCancel() { if (busy) cancelRef.current = true }

  function handleApproval(approval: ApprovalRequest, approvedItemIds: string[]) {
    const reply = buildApprovalReply(approval.approval_id, approvedItemIds, approval.items.map(it => it.id))
    setMessages(prev => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        const m = next[i]
        if (m.approval_requests?.some(r => r.approval_id === approval.approval_id)) {
          next[i] = {
            ...m,
            approval_resolutions: {
              ...(m.approval_resolutions ?? {}),
              [approval.approval_id]: {
                approvedItemIds,
                deniedItemIds: approval.items.map(it => it.id).filter(id => !approvedItemIds.includes(id)),
              },
            },
          }
          break
        }
      }
      return next
    })
    setInput(reply)
    setTimeout(() => { void send(reply) }, 30)
  }

  async function send(forcedText?: string) {
    const text = (forcedText ?? input).trim()
    if (!text || busy) return
    setError(null)
    cancelRef.current = false
    const nextMessages: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setInput('')
    setBusy(true)
    try {
      const enqRes = await fetch(`/api/businesses/${encodeURIComponent(slug)}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, sessionId }),
      })
      if (enqRes.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
        return
      }
      const enq = (await enqRes.json()) as EnqueueResp | ErrResp
      if (!enq.ok) { setError(enq.error); return }
      if (!sessionId) setSessionId(enq.sessionId)
      const final = await pollUntilDone(enq.jobId, enq.sessionId)
      if (final.cancelled) {
        setMessages(prev => [...prev, { role: 'assistant', content: '_Run cancelled by operator._' }])
        return
      }
      setMessages(prev => [...prev, { role: 'assistant', content: final.text, durationMs: final.durationMs, approval_requests: final.approval_requests }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error')
    } finally {
      setBusy(false)
    }
  }

  async function pollUntilDone(jobId: string, sid: string): Promise<{ text: string; durationMs: number; approval_requests?: ApprovalRequest[]; cancelled?: boolean }> {
    const start = Date.now()
    const qs = `jobId=${encodeURIComponent(jobId)}&sessionId=${encodeURIComponent(sid)}`
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      if (cancelRef.current) return { text: '', durationMs: Date.now() - start, cancelled: true }
      const res = await fetch(`/api/businesses/${encodeURIComponent(slug)}/chat/poll?${qs}`, { cache: 'no-store' })
      if (res.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
        throw new Error('session expired')
      }
      const j = (await res.json()) as PollResp | ErrResp
      if (!j.ok) throw new Error(j.error)
      if (j.status === 'done') return { text: (j.text ?? '').trim() || '(empty response)', durationMs: j.durationMs ?? (Date.now() - start), approval_requests: j.approval_requests }
      if (j.status === 'error') throw new Error(j.jobError ?? 'gateway error')
    }
    throw new Error(`timed out (>${Math.round(POLL_TIMEOUT_MS / 60_000)} min)`)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] min-h-[500px]">
      <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-2 text-sm">
          <Briefcase size={14} style={{ color: '#a8a3ff' }} />
          <span style={{ color: '#e8e8f0' }}>{name}</span>
          <span style={{ color: '#55556a' }}>—</span>
          <span style={{ color: '#9090b0' }}>scoped to this business, uses per-business + Shared connections</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-sm text-center py-12" style={{ color: '#9090b0' }}>
            Ask this business&apos;s copilot anything — investigate revenue, propose changes, debug a workflow. Approval-gated actions show inline buttons.
          </div>
        )}
        {messages.map((m, i) => {
          const isUser = m.role === 'user'
          return (
            <div key={i} className={isUser ? 'flex justify-end' : 'flex justify-start'}>
              <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm" style={{
                background: isUser
                  ? 'linear-gradient(135deg, rgba(108,99,255,0.25), rgba(108,99,255,0.10))'
                  : 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                border: isUser ? '1px solid rgba(108,99,255,0.30)' : '1px solid rgba(255,255,255,0.08)',
                color: '#e8e8f0',
              }}>
                {m.content && <div className="whitespace-pre-wrap">{m.content}</div>}
                {!isUser && m.approval_requests?.map(req => (
                  <ApprovalCard
                    key={req.approval_id}
                    request={req}
                    resolution={m.approval_resolutions?.[req.approval_id] ?? null}
                    disabled={busy}
                    onSubmit={ids => handleApproval(req, ids)}
                  />
                ))}
                {m.durationMs !== undefined && (
                  <div className="mt-2 text-[10px]" style={{ color: '#55556a' }}>{(m.durationMs / 1000).toFixed(1)}s</div>
                )}
              </div>
            </div>
          )
        })}
        {busy && (
          <div className="flex items-center gap-2 text-sm" style={{ color: '#9090b0' }}>
            <Loader2 size={14} className="animate-spin" />
            <span>Working…</span>
            <button onClick={handleCancel} className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}>
              <XIcon size={10} /> Cancel
            </button>
          </div>
        )}
        {error && (
          <div className="rounded-lg p-3 flex items-start gap-2" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}>
            <AlertTriangle size={14} className="mt-0.5" />
            <div className="flex-1 text-sm">
              <div className="font-semibold mb-1">Turn failed</div>
              <div className="font-mono text-xs whitespace-pre-wrap">{error}</div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-4" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="flex gap-2 rounded-xl p-3" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))', border: '1px solid rgba(255,255,255,0.10)' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={messages.length === 0 ? `Ask the ${name} copilot anything…` : 'Reply… (Enter to send)'}
            rows={Math.min(8, Math.max(2, input.split('\n').length))}
            disabled={busy}
            className="flex-1 resize-none bg-transparent focus:outline-none text-sm font-mono"
            style={{ color: '#e8e8f0' }}
          />
          <button onClick={() => void send()} disabled={busy || !input.trim()} className="self-end px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-semibold disabled:opacity-40" style={{ background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))', border: '1px solid rgba(108,99,255,0.30)', color: '#e8e8f0' }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            <span>{busy ? 'Working…' : 'Send'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

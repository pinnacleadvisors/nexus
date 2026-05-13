'use client'

/**
 * PlatformChat — /manage-platform Console tab body.
 *
 * Phase 1 — chat shell + async dispatch (#145, #155)
 * Phase 3 — approval cards via the approval-request sentinel (this PR)
 * Phase 4 — persistence + multi-chat + delete via chat_sessions (this PR)
 *
 * Phase 2 (SSE streaming + tool-call cards) and Phase 5+ are deferred.
 * See task_plan-chat.md for the full plan.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Send, Sparkles, AlertTriangle, Terminal as TerminalIcon, Copy, Check, X as XIcon } from 'lucide-react'
import ApprovalCard from './ApprovalCard'
import SessionSidebar, { type SessionSummary } from './SessionSidebar'
import { buildApprovalReply, type ApprovalRequest } from '@/lib/chat/approval'

interface Message {
  role:       'user' | 'assistant'
  content:    string
  /** Wall-clock ms the turn took (assistant messages only). */
  durationMs?: number
  /** Approval requests extracted from the assistant text (Phase 3). */
  approval_requests?: ApprovalRequest[]
  /** Resolution state per approval_id, populated when the operator clicks
   *  Approve/Deny. Kept client-side so the card collapses but stays visible. */
  approval_resolutions?: Record<string, { approvedItemIds: string[]; deniedItemIds: string[] }>
}

interface EnqueueOk   { ok: true;  jobId: string; sessionId: string; sessionTag: string }
interface EnqueueFail { ok: false; error: string; code: string }
type EnqueueResponse = EnqueueOk | EnqueueFail

interface PollOk     { ok: true;  status: 'pending' | 'running' | 'done' | 'error'; text?: string; partialText?: string; approval_requests?: ApprovalRequest[]; jobError?: string; durationMs?: number; startedAt?: number; finishedAt?: number }
interface PollFail   { ok: false; error: string; code: string }
type PollResponse = PollOk | PollFail

interface SessionsResp { ok: true; sessions: SessionSummary[] }
interface MessagesResp { ok: true; session: SessionSummary; messages: Array<{ id: string; role: 'user'|'assistant'|'system'; content: string; metadata: { approval_requests?: ApprovalRequest[]; durationMs?: number } }> }

const POLL_INTERVAL_MS = 2_500
const POLL_TIMEOUT_MS  = 5 * 60_000   // 5-min cap. Opus + tool-call workflows rarely exceed this.

const PLACEHOLDER = [
  '"Show me the last 3 Vercel deploy failures and what broke"',
  '"Check the Slack channel #ops for anything I missed today"',
  '"Why is /api/gateway-status sometimes returning 503?"',
  '"Run tsc --noEmit and tell me what fails — delegate to codex if needed"',
  '"Add a new MCP entry for Beehiiv to lib/businesses/mcp-manifest.ts — propose the change first"',
].join('\n')

export default function PlatformChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input,    setInput]    = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Phase 6 — Cancel button. cancelRef.current is set to true when the
  // operator clicks Cancel on a running job; the poll loop checks it on
  // each iteration and bails out. The server-side gateway job continues
  // to completion (wasted spend but bounded) — proper server-side cancel
  // is a follow-up that needs a gateway-side DELETE /api/jobs/:id endpoint.
  const cancelRef = useRef(false)
  // Phase 2a — partial text accumulated by the running job, polled on each
  // tick and rendered as a tentative assistant bubble while busy. Cleared
  // when the final message lands (or the turn is cancelled).
  const [partial, setPartial] = useState<string>('')

  // Phase 4 — session state. activeSessionId is null until either the
  // operator creates/picks one explicitly, OR the first send() auto-creates
  // one (the server returns the new sessionId in the enqueue response).
  const [sessions,        setSessions]        = useState<SessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Auto-scroll to bottom whenever new content arrives.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  // Load session list on mount + after each delete/create.
  const reloadSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const res = await fetch('/api/platform-chat/sessions', { cache: 'no-store' })
      if (res.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
        return
      }
      const j = (await res.json()) as SessionsResp | { ok: false; error: string }
      if (j.ok) setSessions(j.sessions)
    } catch { /* swallow — sidebar shows empty state */ }
    finally { setSessionsLoading(false) }
  }, [])
  useEffect(() => { void reloadSessions() }, [reloadSessions])

  // Load message history when the operator switches sessions.
  useEffect(() => {
    if (!activeSessionId) { setMessages([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/platform-chat/sessions/${activeSessionId}/messages`, { cache: 'no-store' })
        if (!res.ok) return
        const j = (await res.json()) as MessagesResp | { ok: false }
        if (!j.ok || cancelled) return
        setMessages(j.messages.map(m => ({
          role:                 m.role === 'system' ? 'assistant' : m.role,
          content:              m.content,
          durationMs:           m.metadata?.durationMs,
          approval_requests:    m.metadata?.approval_requests,
        })))
        setError(null)
      } catch { /* swallow */ }
    })()
    return () => { cancelled = true }
  }, [activeSessionId])

  async function handleNewChat() {
    setActiveSessionId(null)
    setMessages([])
    setError(null)
  }

  async function handleDeleteSession(sessionId: string) {
    try {
      const res = await fetch(`/api/platform-chat/sessions/${sessionId}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) {
        setError('Failed to delete chat — please retry.')
        return
      }
      if (sessionId === activeSessionId) {
        setActiveSessionId(null)
        setMessages([])
      }
      await reloadSessions()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed')
    }
  }

  function handleApproval(approval: ApprovalRequest, approvedItemIds: string[]) {
    const reply = buildApprovalReply(approval.approval_id, approvedItemIds, approval.items.map(it => it.id))
    // Mark resolution on the last message that contains this approval_id so
    // the card collapses to read-only state instead of duplicating.
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
    // Auto-send so the agent sees the response without the operator clicking Send.
    setTimeout(() => { void send(reply) }, 30)
  }

  function handleCancel() {
    if (!busy) return
    cancelRef.current = true
    // The poll loop notices on its next tick (max 2.5s) and bails out.
  }

  async function send(forcedText?: string) {
    const text = (forcedText ?? input).trim()
    if (!text || busy) return
    setError(null)
    cancelRef.current = false   // reset flag for the new turn
    setPartial('')               // clear stale partial text from a prior run
    const nextMessages: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setInput('')
    setBusy(true)

    try {
      // Step 1 — enqueue. The route auto-creates a session when sessionId
      // is null and returns its id; subsequent turns include it so the
      // user + assistant messages persist into the same conversation.
      const enqRes = await fetch('/api/platform-chat', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ messages: nextMessages, sessionId: activeSessionId }),
      })
      if (enqRes.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
        return
      }
      const enq = (await enqRes.json()) as EnqueueResponse
      if (!enq.ok) {
        setError(enq.error)
        return
      }
      // Bind the session id (may have been auto-created on this turn).
      if (!activeSessionId) setActiveSessionId(enq.sessionId)

      // Step 2 — poll until done. Each poll is <500ms; the loop runs until
      // the gateway reports status='done' or 'error', or we hit the 5-min
      // cap, OR the operator clicks Cancel.
      const finalResult = await pollUntilDone(enq.jobId, enq.sessionId)
      if (finalResult.cancelled) {
        setMessages(prev => [...prev, {
          role:    'assistant',
          content: '_Run cancelled by operator. The gateway job continues server-side and will finish silently — its cost still applies (server-side cancel is a follow-up)._',
        }])
        void reloadSessions()
        return
      }
      setMessages(prev => [...prev, {
        role:               'assistant',
        content:            finalResult.text,
        durationMs:         finalResult.durationMs,
        approval_requests:  finalResult.approval_requests,
      }])
      setPartial('')   // final landed, clear tentative bubble
      // Refresh sidebar (title may have been auto-derived from first message,
      // and last_message_at definitely changed).
      void reloadSessions()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error — check your connection and try again')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Poll /api/platform-chat/poll until the gateway job completes. The
   * sessionId is included in the query so the poll route persists the
   * assistant reply into chat_messages with the parsed approval_requests
   * already in metadata — page reloads recover the same UI state.
   */
  async function pollUntilDone(
    jobId: string,
    sessionId: string,
  ): Promise<{ text: string; durationMs: number; approval_requests?: ApprovalRequest[]; cancelled?: boolean }> {
    const start = Date.now()
    const qs = `jobId=${encodeURIComponent(jobId)}&sessionId=${encodeURIComponent(sessionId)}`
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      if (cancelRef.current) {
        return { text: '', durationMs: Date.now() - start, cancelled: true }
      }
      const res = await fetch(`/api/platform-chat/poll?${qs}`, { cache: 'no-store' })
      if (res.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
        throw new Error('session expired during poll')
      }
      const j = (await res.json()) as PollResponse
      if (!j.ok) throw new Error(j.error)
      if (j.status === 'done') {
        return {
          text:               (j.text ?? '').trim() || '(the gateway returned an empty assistant message — usually means the agent finished without writing a final reply)',
          durationMs:         j.durationMs ?? (Date.now() - start),
          approval_requests:  j.approval_requests,
        }
      }
      if (j.status === 'error') {
        throw new Error(j.jobError ?? 'gateway reported an unspecified job error')
      }
      // status === 'pending' | 'running' — Phase 2a pushes the running
      // partial text into UI state so the chat shows progressive output.
      if (j.partialText) setPartial(j.partialText)
    }
    throw new Error(`timed out waiting for response (>${Math.round(POLL_TIMEOUT_MS / 60_000)} min). The agent may still be running on the gateway — check Coolify logs for the claude-gateway service.`)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex h-[calc(100vh-200px)] min-h-[500px]">
      {/* Phase 4 — session sidebar (left rail) */}
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        loading={sessionsLoading}
        onSelect={setActiveSessionId}
        onNew={handleNewChat}
        onDelete={handleDeleteSession}
      />

      {/* Chat column (right of sidebar) */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header strip — explains scope so operator never confuses with per-business chat */}
        <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-2 text-sm">
            <Sparkles size={14} style={{ color: '#a8a3ff' }} />
            <span style={{ color: '#e8e8f0' }}>Platform copilot</span>
            <span style={{ color: '#55556a' }}>—</span>
            <span style={{ color: '#9090b0' }}>
              scoped to Nexus itself, uses admin-scope connections (Vercel, GitHub, Slack, Stripe, …) via the hard-isolation MCP
            </span>
          </div>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {messages.length === 0 && <EmptyState />}
          {messages.map((m, i) => (
            <MessageBubble
              key={i}
              message={m}
              onApprove={handleApproval}
              busy={busy}
            />
          ))}
          {/* Phase 2a — tentative assistant bubble showing partial text
              accumulated by the running job. Updates on each 2.5s poll;
              replaced by the final MessageBubble once status='done'. */}
          {busy && partial && (
            <div className="flex justify-start">
              <div
                className="max-w-[85%] rounded-2xl px-4 py-3 text-sm"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
                  border:     '1px dashed rgba(168,163,255,0.30)',
                  color:      '#c8c8d8',
                }}
              >
                <div className="text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: '#a8a3ff' }}>
                  Streaming
                </div>
                <div className="whitespace-pre-wrap">{partial}</div>
              </div>
            </div>
          )}
          {busy && <ThinkingIndicator onCancel={handleCancel} />}
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
          <div ref={bottomRef} />
        </div>

      {/* Input */}
      <div className="border-t p-4" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div
          className="flex gap-2 rounded-xl p-3"
          style={{
            background:           'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
            border:               '1px solid rgba(255,255,255,0.10)',
            backdropFilter:       'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={messages.length === 0 ? 'Ask the platform copilot anything — Enter to send, Shift+Enter for newline' : 'Reply… (Enter to send)'}
            rows={Math.min(8, Math.max(2, input.split('\n').length))}
            disabled={busy}
            className="flex-1 resize-none bg-transparent focus:outline-none text-sm font-mono"
            style={{ color: '#e8e8f0' }}
          />
          <button
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="self-end px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))',
              border:     '1px solid rgba(108,99,255,0.30)',
              color:      '#e8e8f0',
            }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            <span>{busy ? 'Working…' : 'Send'}</span>
          </button>
        </div>
        <div className="mt-2 text-[11px] flex items-center gap-2" style={{ color: '#55556a' }}>
          <TerminalIcon size={11} />
          <span>Async polling + persistent sessions + approval cards. SSE streaming + inline tool-call cards are still deferred (Phase 2 — see task_plan-chat.md).</span>
        </div>
      </div>
      </div>{/* close chat column */}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
      <Sparkles size={32} style={{ color: '#a8a3ff' }} className="mx-auto" />
      <h2 className="text-lg font-semibold" style={{ color: '#e8e8f0' }}>What can I help with on the Nexus platform?</h2>
      <p className="text-sm" style={{ color: '#9090b0' }}>
        I have read access to your shared-scope connected accounts and can correlate logs across them.
        For execution-heavy debugging I can delegate to the codex gateway. I'll always propose a plan
        and ask for approval before making changes.
      </p>
      <pre
        className="text-xs text-left p-3 rounded-lg overflow-x-auto"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border:     '1px solid rgba(255,255,255,0.08)',
          color:      '#9090b0',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        }}
      >
        Try:{'\n'}{PLACEHOLDER}
      </pre>
    </div>
  )
}

function ThinkingIndicator({ onCancel }: { onCancel?: () => void }) {
  // Tick an elapsed-seconds counter so the operator sees the chat hasn't
  // frozen during long agent runs (Opus + MCP tool calls easily hit 30-90s).
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: '#9090b0' }}>
      <Loader2 size={14} className="animate-spin" />
      <span>Claude is working — checking platforms, reading code, maybe delegating to codex… ({elapsed}s)</span>
      {onCancel && (
        <button
          onClick={onCancel}
          title="Cancel — stop polling. The gateway job continues server-side but its result is ignored."
          className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
          style={{
            background: 'rgba(239,68,68,0.10)',
            border:     '1px solid rgba(239,68,68,0.30)',
            color:      '#fca5a5',
          }}
        >
          <XIcon size={10} /> Cancel
        </button>
      )}
    </div>
  )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      className="rounded-lg p-3 flex items-start gap-2"
      style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1 text-sm">
        <div className="font-semibold mb-1">Turn failed</div>
        <div className="font-mono text-xs whitespace-pre-wrap">{message}</div>
      </div>
      <button onClick={onDismiss} className="text-xs underline opacity-80 hover:opacity-100">Dismiss</button>
    </div>
  )
}

function MessageBubble({
  message, onApprove, busy,
}: {
  message:   Message
  onApprove: (request: ApprovalRequest, approvedItemIds: string[]) => void
  busy:      boolean
}) {
  const isUser = message.role === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={isUser ? 'max-w-[85%] rounded-2xl px-4 py-3 text-sm' : 'max-w-[85%] rounded-2xl px-4 py-3 text-sm'}
        style={{
          background: isUser
            ? 'linear-gradient(135deg, rgba(108,99,255,0.25), rgba(108,99,255,0.10))'
            : 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
          border: isUser ? '1px solid rgba(108,99,255,0.30)' : '1px solid rgba(255,255,255,0.08)',
          color:  '#e8e8f0',
        }}
      >
        {message.content && <RenderedMarkdown text={message.content} />}
        {/* Phase 3 — render any approval-request blocks the agent emitted as
            inline cards. Each card carries its own approval_id; on click we
            auto-send the canonical APPROVAL [<id>]: ... reply. */}
        {!isUser && message.approval_requests?.map(req => (
          <ApprovalCard
            key={req.approval_id}
            request={req}
            resolution={message.approval_resolutions?.[req.approval_id] ?? null}
            disabled={busy}
            onSubmit={ids => onApprove(req, ids)}
          />
        ))}
        {message.durationMs !== undefined && (
          <div className="mt-2 text-[10px]" style={{ color: '#55556a' }}>
            {(message.durationMs / 1000).toFixed(1)}s
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Very lightweight markdown render — preserves newlines, extracts fenced
 * code blocks for monospace styling. Avoids pulling a full markdown lib
 * in the MVP. Phase 2 swaps for react-markdown when tool-call cards land.
 */
function RenderedMarkdown({ text }: { text: string }) {
  const blocks = splitFencedCode(text)
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => b.kind === 'code'
        ? <CodeBlock key={i} code={b.body} lang={b.lang} />
        : <p key={i} className="whitespace-pre-wrap">{b.body}</p>,
      )}
    </div>
  )
}

function splitFencedCode(text: string): Array<{ kind: 'text' | 'code'; body: string; lang?: string }> {
  const re = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
  const out: Array<{ kind: 'text' | 'code'; body: string; lang?: string }> = []
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', body: text.slice(last, m.index) })
    out.push({ kind: 'code', body: m[2], lang: m[1] || undefined })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', body: text.slice(last) })
  return out.length > 0 ? out : [{ kind: 'text', body: text }]
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  async function onCopy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  return (
    <div className="relative rounded-lg overflow-hidden" style={{ background: 'rgba(0,0,0,0.40)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px]" style={{ color: '#9090b0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="font-mono uppercase tracking-wider">{lang || 'text'}</span>
        <button onClick={onCopy} className="flex items-center gap-1 hover:opacity-100 opacity-70">
          {copied ? <Check size={10} /> : <Copy size={10} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs font-mono" style={{ color: '#e8e8f0' }}>{code}</pre>
    </div>
  )
}

// Keep imported for Phase 2 use — Tool call card dropdown / Codex delegation card

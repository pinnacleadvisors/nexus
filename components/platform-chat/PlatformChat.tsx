'use client'

/**
 * PlatformChat — /manage-platform Console tab body.
 *
 * Phase 1 MVP — multi-turn chat with the shared claude-gateway, scoped to
 * the Nexus platform itself (operator's shared-scope connected accounts +
 * recent platform state baked into the system prompt).
 *
 * Replaces the legacy form-based dev console. Same role (Nexus builds
 * Nexus) but the interaction is conversational instead of "fill form →
 * generate plan → approve → dispatch". Phase 2 adds SSE streaming + tool
 * call cards. Phase 3 adds approval gates. Phase 4 adds persistence.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, Send, Sparkles, AlertTriangle, Terminal as TerminalIcon, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'

interface Message {
  role:       'user' | 'assistant'
  content:    string
  /** Wall-clock ms the turn took (assistant messages only). */
  durationMs?: number
}

interface EnqueueOk   { ok: true;  jobId: string;  sessionTag: string }
interface EnqueueFail { ok: false; error: string; code: string }
type EnqueueResponse = EnqueueOk | EnqueueFail

interface PollOk     { ok: true;  status: 'pending' | 'running' | 'done' | 'error'; text?: string; jobError?: string; durationMs?: number; startedAt?: number; finishedAt?: number }
interface PollFail   { ok: false; error: string; code: string }
type PollResponse = PollOk | PollFail

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

  // Auto-scroll to bottom whenever new content arrives.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setError(null)
    const nextMessages: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setInput('')
    setBusy(true)

    try {
      // Step 1 — enqueue. Returns a jobId immediately; the long-running
      // generation happens server-side on the gateway. This is the async
      // job protocol added on the gateway in lib/claw/gateway-jobs.ts.
      const enqRes = await fetch('/api/platform-chat', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ messages: nextMessages }),
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

      // Step 2 — poll until done. Each poll is <500ms; the loop runs until
      // the gateway reports status='done' or 'error', or we hit the 5-min cap.
      const finalText = await pollUntilDone(enq.jobId)
      setMessages(prev => [...prev, { role: 'assistant', content: finalText.text, durationMs: finalText.durationMs }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error — check your connection and try again')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Poll /api/platform-chat/poll until the gateway job completes. Returns the
   * assistant text + total duration on success. Throws on timeout or job-level
   * error so the caller's catch surfaces it via the red error banner.
   */
  async function pollUntilDone(jobId: string): Promise<{ text: string; durationMs: number }> {
    const start = Date.now()
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      const res = await fetch(`/api/platform-chat/poll?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' })
      if (res.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
        throw new Error('session expired during poll')
      }
      const j = (await res.json()) as PollResponse
      if (!j.ok) throw new Error(j.error)
      if (j.status === 'done') {
        return { text: (j.text ?? '').trim() || '(the gateway returned an empty assistant message — usually means the agent finished without writing a final reply)', durationMs: j.durationMs ?? (Date.now() - start) }
      }
      if (j.status === 'error') {
        throw new Error(j.jobError ?? 'gateway reported an unspecified job error')
      }
      // status === 'pending' | 'running' — keep polling
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
    <div className="flex flex-col h-[calc(100vh-200px)] min-h-[500px]">
      {/* Header strip — explains scope so operator never confuses with per-business chat */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="flex items-center gap-2 text-sm">
          <Sparkles size={14} style={{ color: '#a8a3ff' }} />
          <span style={{ color: '#e8e8f0' }}>Platform copilot</span>
          <span style={{ color: '#55556a' }}>—</span>
          <span style={{ color: '#9090b0' }}>
            scoped to Nexus itself, uses your shared-scope connected accounts (Vercel, GitHub, Slack, Stripe, YouTube, …)
          </span>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && <EmptyState />}
        {messages.map((m, i) => <MessageBubble key={i} message={m} />)}
        {busy && <ThinkingIndicator />}
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
          <span>Phase 1 MVP — sync responses, no streaming yet. Phase 2 adds inline tool-call cards + codex delegation panels.</span>
        </div>
      </div>
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

function ThinkingIndicator() {
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

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className="max-w-[85%] rounded-2xl px-4 py-3 text-sm"
        style={{
          background: isUser
            ? 'linear-gradient(135deg, rgba(108,99,255,0.25), rgba(108,99,255,0.10))'
            : 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
          border: isUser ? '1px solid rgba(108,99,255,0.30)' : '1px solid rgba(255,255,255,0.08)',
          color:  '#e8e8f0',
        }}
      >
        <RenderedMarkdown text={message.content} />
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
export { ChevronDown, ChevronRight }

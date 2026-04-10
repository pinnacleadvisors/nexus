'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Cpu, CheckCircle2, XCircle, Loader2, ExternalLink,
  GitBranch, Mail, MessageSquare, FileText, Unlink,
  Send, Bot, User, Code2, Gauge,
} from 'lucide-react'
import type { OAuthConnection } from '@/lib/types'
import { OAUTH_PROVIDERS } from '@/lib/oauth-providers'

// ── Tab nav ───────────────────────────────────────────────────────────────────
const TABS = [
  { label: 'Configure', href: '/tools/claw' },
  { label: 'Status',    href: '/tools/claw/status' },
  { label: 'Skills',    href: '/tools/claw/skills' },
]

// ── Icon map for OAuth providers ──────────────────────────────────────────────
const PROVIDER_ICON: Record<string, React.ElementType> = {
  Mail, GitBranch, MessageSquare, FileText,
}

// ── Types ─────────────────────────────────────────────────────────────────────
type TestStatus = 'idle' | 'loading' | 'success' | 'error'
type ChatMessage = { role: 'user' | 'assistant'; content: string }
type CapData = { cap: number; used: number; remaining: number; resetAt: string }

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ClawConfigPage() {
  const [gatewayUrl, setGatewayUrl]   = useState('')
  const [hookToken, setHookToken]     = useState('')
  const [configured, setConfigured]   = useState(false)
  const [savedUrl, setSavedUrl]       = useState('')   // shown in UI (token never returned)
  const [saving, setSaving]           = useState(false)
  const [testStatus, setTestStatus]   = useState<TestStatus>('idle')
  const [testError, setTestError]     = useState('')
  const [connections, setConnections] = useState<OAuthConnection[]>([])
  const [oauthMsg, setOauthMsg]       = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [capData, setCapData]         = useState<CapData | null>(null)

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatPrompt, setChatPrompt]     = useState('')
  const [chatLoading, setChatLoading]   = useState(false)
  const [chatError, setChatError]       = useState('')
  const chatBottomRef                   = useRef<HTMLDivElement>(null)

  // Code-task dispatch state
  const [codeTask,       setCodeTask]       = useState('')
  const [codeRepo,       setCodeRepo]       = useState('')
  const [codeDispatch,   setCodeDispatch]   = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [codeDispatchErr, setCodeDispatchErr] = useState('')

  // Load config status from server (never receives the token)
  const loadConfig = useCallback(async () => {
    const res = await fetch('/api/claw/config')
    const data = await res.json()
    setConfigured(data.configured)
    if (data.configured) setSavedUrl(data.gatewayUrl)
  }, [])

  // Load OAuth connection status
  const loadConnections = useCallback(async () => {
    const res = await fetch('/api/oauth/status')
    const data = await res.json()
    setConnections(data.connections ?? [])
  }, [])

  // Parse OAuth redirect messages from URL
  const loadCap = useCallback(async () => {
    try {
      const res = await fetch('/api/claw')
      if (res.ok) setCapData(await res.json() as CapData)
    } catch {}
  }, [])

  useEffect(() => {
    loadConfig()
    loadConnections()
    loadCap()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConfig, loadConnections, loadCap])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('oauth_connected')
    const error     = params.get('oauth_error')
    if (connected) {
      setOauthMsg({ type: 'success', text: `Successfully connected ${connected}` })
      window.history.replaceState({}, '', window.location.pathname)
      loadConnections()
    } else if (error) {
      setOauthMsg({ type: 'error', text: decodeURIComponent(error) })
      window.history.replaceState({}, '', window.location.pathname)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSave() {
    if (!gatewayUrl.trim() || !hookToken.trim()) return
    setSaving(true)
    const res = await fetch('/api/claw/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gatewayUrl: gatewayUrl.trim(), hookToken: hookToken.trim() }),
    })
    setSaving(false)
    if (res.ok) {
      setConfigured(true)
      setSavedUrl(gatewayUrl.trim())
      setGatewayUrl('')
      setHookToken('')   // clear from state — token is now server-side only
      setTestStatus('idle')
    }
  }

  async function handleDisconnect() {
    await fetch('/api/claw/config', { method: 'DELETE' })
    setConfigured(false)
    setSavedUrl('')
    setGatewayUrl('')
    setHookToken('')
    setTestStatus('idle')
  }

  async function handleTest() {
    setTestStatus('loading')
    setTestError('')
    const res = await fetch('/api/claw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'wake',
        payload: { text: 'Nexus connection test — please reply "pong".', mode: 'now' },
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setTestStatus('success')
    } else {
      setTestStatus('error')
      setTestError(data.error ?? `HTTP ${res.status}`)
    }
  }

  async function handleOAuthDisconnect(providerId: string) {
    await fetch(`/api/oauth/disconnect?provider=${providerId}`, { method: 'DELETE' })
    setConnections(prev => prev.filter(c => c.provider !== providerId))
  }

  async function handleCodeDispatch(e: React.FormEvent) {
    e.preventDefault()
    const task = codeTask.trim()
    if (!task || codeDispatch === 'loading') return
    setCodeDispatch('loading')
    setCodeDispatchErr('')
    try {
      const res = await fetch('/api/claw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'code',
          payload: {
            task,
            repo:      codeRepo.trim() || undefined,
            wakeMode:  'now',
            toolchain: 'claude-code-cli',
          },
        }),
      })
      const data = await res.json() as { ok?: boolean; error?: string; remaining?: number }
      if (res.ok) {
        setCodeDispatch('ok')
        setCodeTask('')
        setCodeRepo('')
        if (data.remaining !== undefined) {
          setCapData(prev => prev ? { ...prev, remaining: data.remaining!, used: prev.cap - data.remaining! } : prev)
        }
        setTimeout(() => setCodeDispatch('idle'), 4000)
      } else {
        setCodeDispatch('err')
        setCodeDispatchErr(data.error ?? `HTTP ${res.status}`)
        setTimeout(() => setCodeDispatch('idle'), 5000)
      }
    } catch {
      setCodeDispatch('err')
      setCodeDispatchErr('Network error')
      setTimeout(() => setCodeDispatch('idle'), 5000)
    }
  }

  // Auto-scroll chat to latest message
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  async function handleChat(e: React.FormEvent) {
    e.preventDefault()
    const text = chatPrompt.trim()
    if (!text || chatLoading) return

    setChatPrompt('')
    setChatError('')
    setChatMessages(prev => [...prev, { role: 'user', content: text }])
    setChatLoading(true)

    try {
      const res = await fetch('/api/claw/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      })
      const data = await res.json()

      if (!res.ok) {
        setChatError(data.error ?? `Error ${res.status}`)
        if (res.status === 401) window.location.href = '/tools/claw'
      } else {
        // Normalise: content may be in data.content (REST) or data.message
        const reply: string =
          data.content ?? data.message ?? data.response ?? JSON.stringify(data)
        setChatMessages(prev => [...prev, { role: 'assistant', content: reply }])
      }
    } catch {
      setChatError('Network error — could not reach the proxy.')
    } finally {
      setChatLoading(false)
    }
  }

  const isConnected = (id: string) => connections.some(c => c.provider === id)
  const canSave = gatewayUrl.trim() && hookToken.trim()

  return (
    <div className="p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      {/* Back nav */}
      <Link
        href="/tools"
        className="inline-flex items-center gap-1.5 text-xs mb-6 no-underline transition-colors"
        style={{ color: '#9090b0' }}
        onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#e8e8f0')}
        onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#9090b0')}
      >
        <ArrowLeft size={13} />
        Back to Tools
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: '#1a1a2e', border: '1px solid #24243e' }}
        >
          <Cpu size={20} style={{ color: '#6c63ff' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>
            OpenClaw (MyClaw)
          </h1>
          <p className="text-sm" style={{ color: '#9090b0' }}>
            Secure cloud-hosted AI agent with OAuth platform access.
          </p>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 my-5 p-1 rounded-xl" style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e' }}>
        {TABS.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex-1 text-center py-2 text-sm rounded-lg no-underline font-medium transition-all"
            style={
              tab.href === '/tools/claw'
                ? { backgroundColor: '#1a1a2e', color: '#e8e8f0' }
                : { color: '#55556a' }
            }
            onMouseEnter={e => {
              if (tab.href !== '/tools/claw')
                (e.currentTarget as HTMLAnchorElement).style.color = '#9090b0'
            }}
            onMouseLeave={e => {
              if (tab.href !== '/tools/claw')
                (e.currentTarget as HTMLAnchorElement).style.color = '#55556a'
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Connection + dispatch cap status row */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {configured && (
          <div
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
            style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}
          >
            <CheckCircle2 size={11} />
            Connected — {savedUrl}
          </div>
        )}
        {capData && (
          <div
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
            style={{
              backgroundColor: capData.remaining < 10 ? 'rgba(245,158,11,0.1)' : '#1a1a2e',
              border: `1px solid ${capData.remaining < 10 ? 'rgba(245,158,11,0.25)' : '#24243e'}`,
              color: capData.remaining < 10 ? '#f59e0b' : '#9090b0',
            }}
          >
            <Gauge size={11} />
            {capData.used}/{capData.cap} dispatches today
          </div>
        )}
      </div>

      {/* OAuth notification */}
      {oauthMsg && (
        <div
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg mb-4"
          style={{
            backgroundColor: oauthMsg.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${oauthMsg.type === 'success' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
            color: oauthMsg.type === 'success' ? '#22c55e' : '#ef4444',
          }}
        >
          {oauthMsg.type === 'success' ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
          {oauthMsg.text}
          <button
            onClick={() => setOauthMsg(null)}
            className="ml-auto"
            style={{ color: 'inherit', opacity: 0.6 }}
          >
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* ── Gateway config ───────────────────────────────────────────── */}
        <section
          className="rounded-xl p-5 space-y-4"
          style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} style={{ color: '#6c63ff' }} />
            <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
              Instance Configuration
            </h2>
          </div>

          <div
            className="text-xs px-3 py-2 rounded-lg"
            style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#9090b0' }}
          >
            Your hook token is stored in an HTTP-only server cookie — it never
            touches client-side JavaScript after you save.
          </div>

          {/* Gateway URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: '#9090b0' }}>Gateway URL</label>
            <input
              type="url"
              value={gatewayUrl}
              onChange={e => setGatewayUrl(e.target.value)}
              placeholder={configured ? savedUrl : 'https://your-instance.myclaw.ai'}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
              onFocus={e => ((e.target as HTMLInputElement).style.borderColor = '#6c63ff')}
              onBlur={e => ((e.target as HTMLInputElement).style.borderColor = '#24243e')}
            />
          </div>

          {/* Hook token */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: '#9090b0' }}>Hook Token</label>
            <input
              type="password"
              value={hookToken}
              onChange={e => setHookToken(e.target.value)}
              placeholder={configured ? '••••••••••••••••' : 'your-long-random-secret'}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
              onFocus={e => ((e.target as HTMLInputElement).style.borderColor = '#6c63ff')}
              onBlur={e => ((e.target as HTMLInputElement).style.borderColor = '#24243e')}
            />
            <p className="text-xs" style={{ color: '#55556a' }}>
              Set via <code style={{ backgroundColor: '#1a1a2e', color: '#9090b0', padding: '0 4px', borderRadius: 3, fontSize: 11 }}>hooks.token</code> in your OpenClaw config.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
              style={canSave && !saving
                ? { background: 'linear-gradient(135deg, #6c63ff, #4c45cc)', color: '#fff', cursor: 'pointer' }
                : { backgroundColor: '#1a1a2e', color: '#55556a', cursor: 'not-allowed' }}
            >
              {saving ? 'Saving…' : configured ? 'Update Configuration' : 'Save Configuration'}
            </button>
            {configured && (
              <button
                onClick={handleDisconnect}
                className="px-3 py-2 rounded-lg text-sm font-medium"
                style={{ backgroundColor: '#1a1a2e', color: '#ef4444', border: '1px solid #24243e', cursor: 'pointer' }}
              >
                Disconnect
              </button>
            )}
          </div>

          {/* Connection test */}
          {configured && (
            <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: '#9090b0' }}>Connection test</span>
                <button
                  onClick={handleTest}
                  disabled={testStatus === 'loading'}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg"
                  style={{ backgroundColor: '#1a1a2e', color: testStatus === 'loading' ? '#55556a' : '#6c63ff', border: '1px solid #24243e', cursor: testStatus === 'loading' ? 'default' : 'pointer' }}
                >
                  {testStatus === 'loading' && <Loader2 size={11} className="animate-spin" />}
                  {testStatus === 'loading' ? 'Testing…' : 'Run Test'}
                </button>
              </div>
              {testStatus === 'success' && (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: '#22c55e' }}>
                  <CheckCircle2 size={12} /> Wake event delivered — instance is reachable.
                </div>
              )}
              {testStatus === 'error' && (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: '#ef4444' }}>
                  <XCircle size={12} /> {testError || 'Connection failed.'}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── OAuth platform connections ────────────────────────────────── */}
        <section className="space-y-4">
          <div
            className="rounded-xl p-5"
            style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={14} style={{ color: '#6c63ff' }} />
              <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Platform Access (OAuth)</h2>
            </div>
            <p className="text-xs mb-4" style={{ color: '#9090b0' }}>
              Connect platforms so your OpenClaw agent can act on your behalf — no passwords stored.
              Tokens are held in HTTP-only cookies and forwarded securely when dispatching tasks.
            </p>

            <div className="space-y-2">
              {OAUTH_PROVIDERS.map(provider => {
                const connected = isConnected(provider.id)
                const Icon = PROVIDER_ICON[provider.icon] ?? Mail
                return (
                  <div
                    key={provider.id}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5"
                    style={{ backgroundColor: '#0d0d14', border: `1px solid ${connected ? 'rgba(34,197,94,0.2)' : '#1a1a2e'}` }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: '#1a1a2e', border: '1px solid #24243e' }}
                      >
                        <Icon size={14} style={{ color: connected ? '#22c55e' : '#55556a' }} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold" style={{ color: '#e8e8f0' }}>{provider.name}</p>
                        <p className="text-xs" style={{ color: '#55556a' }}>{provider.description}</p>
                      </div>
                    </div>

                    {connected ? (
                      <button
                        onClick={() => handleOAuthDisconnect(provider.id)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg"
                        style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}
                      >
                        <Unlink size={11} />
                        Disconnect
                      </button>
                    ) : (
                      <a
                        href={`/api/oauth/${provider.id}`}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg no-underline"
                        style={{ backgroundColor: '#1a1a2e', color: '#6c63ff', border: '1px solid #24243e' }}
                      >
                        Connect
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Resources */}
          <div
            className="rounded-xl p-4 flex flex-col gap-2"
            style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
          >
            <p className="text-xs font-semibold mb-1" style={{ color: '#e8e8f0' }}>Resources</p>
            {[
              { label: 'MyClaw.ai — managed hosting', url: 'https://myclaw.ai' },
              { label: 'OpenClaw on GitHub', url: 'https://github.com/openclaw/openclaw' },
              { label: 'Webhook docs', url: 'https://docs.openclaw.ai/automation/webhook' },
            ].map(link => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs no-underline"
                style={{ color: '#6c63ff' }}
              >
                <ExternalLink size={11} />
                {link.label}
              </a>
            ))}
          </div>
        </section>
      </div>

      {/* ── Chat with Agent ───────────────────────────────────────────────── */}
      <section
        className="rounded-xl mt-6 flex flex-col overflow-hidden"
        style={{ backgroundColor: '#12121e', border: '1px solid #24243e', minHeight: 360, maxHeight: 520 }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-5 py-3 shrink-0"
          style={{ borderBottom: '1px solid #24243e' }}
        >
          <Bot size={15} style={{ color: '#6c63ff' }} />
          <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
            Chat with Agent
          </h2>
          <span
            className="ml-auto text-xs px-2 py-0.5 rounded-full"
            style={{ backgroundColor: '#1a1a2e', color: '#9090b0', border: '1px solid #24243e' }}
          >
            POST /api/sessions/main/messages
          </span>
        </div>

        {/* Message thread */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{ scrollBehavior: 'smooth' }}>
          {chatMessages.length === 0 && (
            <p className="text-xs text-center pt-8" style={{ color: '#55556a' }}>
              Send a prompt to your OpenClaw agent — responses arrive directly via the Gateway REST API.
            </p>
          )}
          {chatMessages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ backgroundColor: 'rgba(108,99,255,0.15)', border: '1px solid rgba(108,99,255,0.3)' }}
                >
                  <Bot size={13} style={{ color: '#6c63ff' }} />
                </div>
              )}
              <div
                className="max-w-[75%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
                style={
                  msg.role === 'user'
                    ? { backgroundColor: '#1a1a2e', color: '#e8e8f0', border: '1px solid #2e2e4a' }
                    : { backgroundColor: 'rgba(108,99,255,0.08)', color: '#d0d0e8', border: '1px solid rgba(108,99,255,0.15)' }
                }
              >
                {msg.content}
              </div>
              {msg.role === 'user' && (
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ backgroundColor: '#1a1a2e', border: '1px solid #24243e' }}
                >
                  <User size={13} style={{ color: '#9090b0' }} />
                </div>
              )}
            </div>
          ))}
          {chatLoading && (
            <div className="flex gap-2.5 justify-start">
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{ backgroundColor: 'rgba(108,99,255,0.15)', border: '1px solid rgba(108,99,255,0.3)' }}
              >
                <Bot size={13} style={{ color: '#6c63ff' }} />
              </div>
              <div
                className="flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-sm"
                style={{ backgroundColor: 'rgba(108,99,255,0.08)', color: '#9090b0', border: '1px solid rgba(108,99,255,0.15)' }}
              >
                <Loader2 size={13} className="animate-spin" />
                Thinking…
              </div>
            </div>
          )}
          {chatError && (
            <div
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg"
              style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}
            >
              <XCircle size={12} />
              {chatError}
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={handleChat}
          className="flex gap-2 px-4 py-3 shrink-0"
          style={{ borderTop: '1px solid #24243e', backgroundColor: '#0d0d14' }}
        >
          <input
            type="text"
            value={chatPrompt}
            onChange={e => setChatPrompt(e.target.value)}
            placeholder={configured ? 'Ask your agent anything…' : 'Configure gateway above first'}
            disabled={chatLoading || !configured}
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              backgroundColor: '#12121e',
              border: '1px solid #24243e',
              color: '#e8e8f0',
              opacity: !configured ? 0.5 : 1,
            }}
            onFocus={e => { if (configured) (e.target as HTMLInputElement).style.borderColor = '#6c63ff' }}
            onBlur={e => ((e.target as HTMLInputElement).style.borderColor = '#24243e')}
          />
          <button
            type="submit"
            disabled={!chatPrompt.trim() || chatLoading || !configured}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={
              chatPrompt.trim() && !chatLoading && configured
                ? { background: 'linear-gradient(135deg, #6c63ff, #4c45cc)', color: '#fff', cursor: 'pointer' }
                : { backgroundColor: '#1a1a2e', color: '#55556a', border: '1px solid #24243e', cursor: 'not-allowed' }
            }
          >
            {chatLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {chatLoading ? 'Sending…' : 'Send'}
          </button>
        </form>
      </section>

      {/* ── Code Task Dispatch ────────────────────────────────────────────────── */}
      <section
        className="rounded-xl mt-6"
        style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
      >
        <div
          className="flex items-center gap-2 px-5 py-3.5"
          style={{ borderBottom: '1px solid #24243e' }}
        >
          <Code2 size={15} style={{ color: '#6c63ff' }} />
          <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
            Code Task (Claude Code CLI)
          </h2>
          <span
            className="ml-auto text-xs px-2 py-0.5 rounded-full"
            style={{ backgroundColor: '#1a1a2e', color: '#9090b0', border: '1px solid #24243e' }}
          >
            POST /hooks/code
          </span>
        </div>

        <form onSubmit={handleCodeDispatch} className="p-5 space-y-3">
          <p className="text-xs" style={{ color: '#9090b0' }}>
            Dispatch a code-generation task to your OpenClaw agent. It will use Claude Code CLI to
            write code, run tests, and open a pull request on the specified repository.
          </p>

          {/* Task description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: '#9090b0' }}>Task description</label>
            <textarea
              value={codeTask}
              onChange={e => setCodeTask(e.target.value)}
              placeholder="e.g. Add a contact form to the landing page with email validation and Resend integration"
              rows={3}
              disabled={!configured || codeDispatch === 'loading'}
              className="w-full rounded-lg px-3 py-2.5 text-sm resize-none outline-none"
              style={{
                backgroundColor: '#0d0d14',
                border: '1px solid #24243e',
                color: '#e8e8f0',
                opacity: !configured ? 0.5 : 1,
              }}
              onFocus={e => { if (configured) (e.currentTarget as HTMLTextAreaElement).style.borderColor = '#6c63ff' }}
              onBlur={e => ((e.currentTarget as HTMLTextAreaElement).style.borderColor = '#24243e')}
            />
          </div>

          {/* Repo URL (optional) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: '#9090b0' }}>
              Repository URL <span style={{ color: '#55556a' }}>(optional)</span>
            </label>
            <input
              type="url"
              value={codeRepo}
              onChange={e => setCodeRepo(e.target.value)}
              placeholder="https://github.com/org/repo"
              disabled={!configured || codeDispatch === 'loading'}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: '#0d0d14',
                border: '1px solid #24243e',
                color: '#e8e8f0',
                opacity: !configured ? 0.5 : 1,
              }}
              onFocus={e => { if (configured) (e.currentTarget as HTMLInputElement).style.borderColor = '#6c63ff' }}
              onBlur={e => ((e.currentTarget as HTMLInputElement).style.borderColor = '#24243e')}
            />
          </div>

          {/* Status / submit */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={!codeTask.trim() || !configured || codeDispatch === 'loading'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
              style={
                codeTask.trim() && configured && codeDispatch !== 'loading'
                  ? { background: 'linear-gradient(135deg, #6c63ff, #4c45cc)', color: '#fff', cursor: 'pointer' }
                  : { backgroundColor: '#1a1a2e', color: '#55556a', border: '1px solid #24243e', cursor: 'not-allowed' }
              }
            >
              {codeDispatch === 'loading'
                ? <><Loader2 size={14} className="animate-spin" /> Dispatching…</>
                : <><Code2 size={14} /> Dispatch Code Task</>
              }
            </button>

            {codeDispatch === 'ok' && (
              <span className="flex items-center gap-1.5 text-xs" style={{ color: '#22c55e' }}>
                <CheckCircle2 size={13} /> Task dispatched to Claude Code CLI
              </span>
            )}
            {codeDispatch === 'err' && (
              <span className="flex items-center gap-1.5 text-xs" style={{ color: '#ef4444' }}>
                <XCircle size={13} /> {codeDispatchErr || 'Dispatch failed'}
              </span>
            )}
            {!configured && (
              <span className="text-xs" style={{ color: '#55556a' }}>Configure gateway first</span>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}

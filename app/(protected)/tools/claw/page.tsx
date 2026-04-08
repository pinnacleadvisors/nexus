'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Cpu, CheckCircle2, XCircle, Loader2, ExternalLink,
  GitBranch, Mail, MessageSquare, FileText, ShieldCheck, Unlink,
} from 'lucide-react'
import type { OAuthConnection } from '@/lib/types'
import { OAUTH_PROVIDERS } from '@/lib/oauth-providers'

// ── Icon map for OAuth providers ──────────────────────────────────────────────
const PROVIDER_ICON: Record<string, React.ElementType> = {
  Mail, GitBranch, MessageSquare, FileText,
}

// ── Helpers ───────────────────────────────────────────────────────────────────
type TestStatus = 'idle' | 'loading' | 'success' | 'error'

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
  useEffect(() => {
    loadConfig()
    loadConnections()

    const params = new URLSearchParams(window.location.search)
    const connected = params.get('oauth_connected')
    const error = params.get('oauth_error')
    if (connected) {
      setOauthMsg({ type: 'success', text: `Successfully connected ${connected}` })
      window.history.replaceState({}, '', window.location.pathname)
      loadConnections()
    } else if (error) {
      setOauthMsg({ type: 'error', text: decodeURIComponent(error) })
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [loadConfig, loadConnections])

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

      {/* Status badge */}
      {configured && (
        <div
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full mb-6"
          style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}
        >
          <CheckCircle2 size={11} />
          Connected — {savedUrl}
        </div>
      )}

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
            <ShieldCheck size={14} style={{ color: '#6c63ff' }} />
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
              <ShieldCheck size={14} style={{ color: '#6c63ff' }} />
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
    </div>
  )
}

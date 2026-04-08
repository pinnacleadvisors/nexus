'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Cpu, CheckCircle2, XCircle, Loader2, ExternalLink } from 'lucide-react'
import type { ClawConfig } from '@/lib/types'

const STORAGE_KEY = 'nexus_claw_config'

function loadConfig(): ClawConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ClawConfig) : null
  } catch {
    return null
  }
}

function saveConfig(cfg: ClawConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
}

function clearConfig() {
  localStorage.removeItem(STORAGE_KEY)
}

type TestStatus = 'idle' | 'loading' | 'success' | 'error'

export default function ClawConfigPage() {
  const [gatewayUrl, setGatewayUrl] = useState('')
  const [hookToken, setHookToken] = useState('')
  const [saved, setSaved] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testError, setTestError] = useState('')

  useEffect(() => {
    const cfg = loadConfig()
    if (cfg) {
      setGatewayUrl(cfg.gatewayUrl)
      setHookToken(cfg.hookToken)
      setSaved(true)
    }
  }, [])

  function handleSave() {
    const cfg: ClawConfig = {
      gatewayUrl: gatewayUrl.trim(),
      hookToken: hookToken.trim(),
    }
    saveConfig(cfg)
    setSaved(true)
    setTestStatus('idle')
  }

  function handleDisconnect() {
    clearConfig()
    setGatewayUrl('')
    setHookToken('')
    setSaved(false)
    setTestStatus('idle')
  }

  async function handleTest() {
    if (!gatewayUrl.trim() || !hookToken.trim()) return
    setTestStatus('loading')
    setTestError('')
    try {
      const res = await fetch('/api/claw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'wake',
          gatewayUrl: gatewayUrl.trim(),
          hookToken: hookToken.trim(),
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
    } catch (err) {
      setTestStatus('error')
      setTestError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

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
            Connect your cloud-hosted OpenClaw instance to automate project execution.
          </p>
        </div>
      </div>

      {/* Status badge */}
      {saved && (
        <div
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full mb-6"
          style={{
            backgroundColor: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.25)',
            color: '#22c55e',
          }}
        >
          <CheckCircle2 size={11} />
          Connected
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* ── Config form ───────────────────────────────────────────────── */}
        <section
          className="rounded-xl p-5 space-y-4"
          style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
            Instance Configuration
          </h2>

          {/* Gateway URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: '#9090b0' }}>
              Gateway URL
            </label>
            <input
              type="url"
              value={gatewayUrl}
              onChange={e => { setGatewayUrl(e.target.value); setSaved(false) }}
              placeholder="https://your-instance.myclaw.ai"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors"
              style={{
                backgroundColor: '#0d0d14',
                border: '1px solid #24243e',
                color: '#e8e8f0',
              }}
              onFocus={e => ((e.target as HTMLInputElement).style.borderColor = '#6c63ff')}
              onBlur={e => ((e.target as HTMLInputElement).style.borderColor = '#24243e')}
            />
            <p className="text-xs" style={{ color: '#55556a' }}>
              The public URL of your MyClaw.ai instance gateway.
            </p>
          </div>

          {/* Hook token */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: '#9090b0' }}>
              Hook Token
            </label>
            <input
              type="password"
              value={hookToken}
              onChange={e => { setHookToken(e.target.value); setSaved(false) }}
              placeholder="your-long-random-secret"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors"
              style={{
                backgroundColor: '#0d0d14',
                border: '1px solid #24243e',
                color: '#e8e8f0',
              }}
              onFocus={e => ((e.target as HTMLInputElement).style.borderColor = '#6c63ff')}
              onBlur={e => ((e.target as HTMLInputElement).style.borderColor = '#24243e')}
            />
            <p className="text-xs" style={{ color: '#55556a' }}>
              Set in your OpenClaw config under{' '}
              <code
                className="rounded px-1 py-0.5"
                style={{ backgroundColor: '#1a1a2e', color: '#9090b0', fontSize: '11px' }}
              >
                hooks.token
              </code>
              .
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
              style={
                canSave
                  ? { background: 'linear-gradient(135deg, #6c63ff, #4c45cc)', color: '#fff', cursor: 'pointer' }
                  : { backgroundColor: '#1a1a2e', color: '#55556a', cursor: 'not-allowed' }
              }
            >
              {saved ? 'Saved' : 'Save Configuration'}
            </button>
            {saved && (
              <button
                onClick={handleDisconnect}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ backgroundColor: '#1a1a2e', color: '#ef4444', border: '1px solid #24243e', cursor: 'pointer' }}
              >
                Disconnect
              </button>
            )}
          </div>

          {/* Test connection */}
          {saved && (
            <div
              className="rounded-lg p-3 space-y-2"
              style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: '#9090b0' }}>
                  Connection test
                </span>
                <button
                  onClick={handleTest}
                  disabled={testStatus === 'loading'}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-colors"
                  style={{
                    backgroundColor: '#1a1a2e',
                    color: testStatus === 'loading' ? '#55556a' : '#6c63ff',
                    border: '1px solid #24243e',
                    cursor: testStatus === 'loading' ? 'default' : 'pointer',
                  }}
                >
                  {testStatus === 'loading' ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : null}
                  {testStatus === 'loading' ? 'Testing…' : 'Run Test'}
                </button>
              </div>

              {testStatus === 'success' && (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: '#22c55e' }}>
                  <CheckCircle2 size={12} />
                  Wake event delivered — your OpenClaw instance is reachable.
                </div>
              )}
              {testStatus === 'error' && (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: '#ef4444' }}>
                  <XCircle size={12} />
                  {testError || 'Connection failed. Check gateway URL and token.'}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── How it works ──────────────────────────────────────────────── */}
        <section className="space-y-4">
          <div
            className="rounded-xl p-5"
            style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
          >
            <h2 className="text-sm font-semibold mb-3" style={{ color: '#e8e8f0' }}>
              How it works
            </h2>
            <ol className="space-y-3">
              {[
                {
                  step: '1',
                  title: 'Set up MyClaw.ai',
                  body: 'Deploy a cloud OpenClaw instance on MyClaw.ai. Enable webhooks in your config and copy the gateway URL and hook token.',
                },
                {
                  step: '2',
                  title: 'Connect here',
                  body: 'Paste your gateway URL and hook token above. Nexus stores them locally and proxies all requests through /api/claw.',
                },
                {
                  step: '3',
                  title: 'Dispatch milestones',
                  body: 'In the Forge, once your AI consultant generates project milestones, click "Dispatch to OpenClaw". Each milestone is sent as a task to your agent.',
                },
                {
                  step: '4',
                  title: 'Agent executes',
                  body: 'Your OpenClaw instance picks up each task, uses its skills (email, calendar, research, CRM…) and delivers results back via your chosen messaging channel.',
                },
              ].map(item => (
                <li key={item.step} className="flex gap-3">
                  <span
                    className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                    style={{ backgroundColor: '#1a1a2e', color: '#6c63ff', border: '1px solid #24243e' }}
                  >
                    {item.step}
                  </span>
                  <div>
                    <p className="text-xs font-semibold mb-0.5" style={{ color: '#e8e8f0' }}>
                      {item.title}
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: '#9090b0' }}>
                      {item.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* External links */}
          <div
            className="rounded-xl p-4 flex flex-col gap-2"
            style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
          >
            <p className="text-xs font-semibold mb-1" style={{ color: '#e8e8f0' }}>
              Resources
            </p>
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
                className="flex items-center gap-1.5 text-xs no-underline transition-colors"
                style={{ color: '#6c63ff' }}
                onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#8b84ff')}
                onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#6c63ff')}
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

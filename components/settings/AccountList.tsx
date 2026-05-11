'use client'

/**
 * AccountList — Settings → Accounts page body.
 *
 * Lists active Composio connections + grouped "Connect [platform]" cards by
 * category. Connecting opens a new tab to the Composio-hosted OAuth URL;
 * disconnecting calls DELETE /api/connected-accounts/:id.
 *
 * The provider catalog comes from lib/oauth/providers.ts — adding a row there
 * automatically lights up a card here.
 */

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useClerk } from '@clerk/nextjs'
import { CheckCircle2, Loader2, Plug, Power, AlertCircle, X, KeyRound, ExternalLink } from 'lucide-react'
import { OAUTH_PROVIDERS, type OAuthCategory, type OAuthProvider } from '@/lib/oauth/providers'

interface ConnectedAccount {
  id:           string
  platform:     string
  businessSlug: string | null
  status:       'active' | 'revoked' | 'error'
  createdAt:    string
  lastUsedAt:   string | null
}

const CATEGORY_LABEL: Record<OAuthCategory, string> = {
  social:        'Social media',
  email:         'Email',
  productivity:  'Productivity',
  communication: 'Communication',
  storage:       'Storage',
  developer:     'Developer',
  analytics:     'Analytics',
  crm:           'CRM',
  commerce:      'Commerce',
  design:        'Design',
}

export default function AccountList({ businessSlug }: { businessSlug?: string | null }) {
  const params        = useSearchParams()
  const router        = useRouter()
  const clerk         = useClerk()
  const justConnected = params?.get('connected')
  const errorParam    = params?.get('error')

  // ── OAuth-callback resilience ────────────────────────────────────────────
  // Composio OAuth flows can take several minutes (user signs into Slack,
  // approves Composio, etc.) — long enough for the Clerk session to expire
  // because the Nexus tab navigated away and the SDK couldn't refresh in
  // the background. On return we land here with ?connected= or ?error=,
  // and any in-flight client polls 401 against the stale session.
  //
  // Three guard layers:
  //   1. Bump the session inactivity window right before navigating away
  //      (in connect()) so we leave with as much runway as Clerk allows.
  //   2. On mount with an OAuth-callback marker, do one router.refresh()
  //      to re-trigger server-side render — that runs Clerk's middleware
  //      which handshakes-then-renders, refreshing client cookies.
  //   3. If load() sees a 401, the session is genuinely gone (long flow,
  //      revoked, etc.) — redirect to /sign-in with returnUrl so the user
  //      lands back here after re-auth, instead of leaving them stuck on
  //      a broken page with mysterious 401s in console.
  useEffect(() => {
    const hasCallbackMarker = Boolean(justConnected || errorParam)
    const refreshKey        = 'post-oauth-refresh'
    if (hasCallbackMarker && !sessionStorage.getItem(refreshKey)) {
      sessionStorage.setItem(refreshKey, '1')
      router.refresh()
    } else if (!hasCallbackMarker) {
      sessionStorage.removeItem(refreshKey)
    }
  }, [justConnected, errorParam, router])

  const [accounts, setAccounts]     = useState<ConnectedAccount[]>([])
  const [loading,  setLoading]      = useState(true)
  const [busy,     setBusy]         = useState<string | null>(null)
  const [err,      setErr]          = useState<string | null>(errorParam || null)
  // Per-provider state for the apiKeySetup paste form (controlled inputs +
  // success flash). Keyed by provider.id so multiple panes don't clash.
  const [apiKeyInput,   setApiKeyInput]   = useState<Record<string, string>>({})
  const [apiKeySaved,   setApiKeySaved]   = useState<Record<string, boolean>>({})

  async function load() {
    setLoading(true)
    try {
      const url = businessSlug ? `/api/connected-accounts?businessSlug=${businessSlug}` : '/api/connected-accounts'
      const res = await fetch(url)
      // Session died mid-flow (typical after a long OAuth wait on dev Clerk
      // keys). Send the user through /sign-in with a returnUrl so they land
      // back here with a fresh session, rather than staring at 401 console
      // errors that don't surface in the UI.
      if (res.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
        return
      }
      if (!res.ok) throw new Error(`load failed: ${res.status}`)
      const json = (await res.json()) as { accounts: ConnectedAccount[] }
      setAccounts(json.accounts)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load accounts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [businessSlug])

  async function connect(provider: OAuthProvider) {
    setBusy(provider.id); setErr(null)
    try {
      // Bump the session's last-active time before navigating away to
      // Composio. Inactivity timeout resets from this touch, so the
      // session has the full Clerk-dashboard-configured window to survive
      // the multi-minute OAuth flow even though the SDK won't run during
      // the redirect chain. No-op when the SDK isn't loaded yet.
      try { await clerk.session?.touch() } catch { /* swallow — best effort */ }

      const res = await fetch('/api/connected-accounts/init', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ platform: provider.id, businessSlug }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(json.error || `init failed: ${res.status}`)
      }
      const json = (await res.json()) as { redirectUrl: string }
      window.location.href = json.redirectUrl
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to start OAuth')
      setBusy(null)
    }
  }

  async function saveApiKey(provider: OAuthProvider) {
    const value = (apiKeyInput[provider.id] ?? '').trim()
    if (!value) {
      setErr(`Paste a ${provider.name} API key first.`)
      return
    }
    setBusy(provider.id); setErr(null)
    try {
      const res = await fetch('/api/connected-accounts/api-key', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ platform: provider.id, businessSlug, apiKey: value }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(json.error || `save failed: ${res.status}`)
      }
      setApiKeyInput(prev => ({ ...prev, [provider.id]: '' }))
      setApiKeySaved(prev => ({ ...prev, [provider.id]: true }))
      await load()
      // Auto-clear the success flash after 3s.
      setTimeout(() => setApiKeySaved(prev => ({ ...prev, [provider.id]: false })), 3000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to save API key')
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(id: string, platform: string) {
    if (!confirm(`Disconnect ${platform}?`)) return
    setBusy(id); setErr(null)
    try {
      const res = await fetch(`/api/connected-accounts/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(json.error || `disconnect failed: ${res.status}`)
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'disconnect failed')
    } finally {
      setBusy(null)
    }
  }

  const connectedByPlatform = new Map(accounts.map(a => [a.platform, a]))
  const groupedProviders: Record<OAuthCategory, OAuthProvider[]> = {} as never
  for (const p of OAUTH_PROVIDERS) {
    (groupedProviders[p.category] ??= []).push(p)
  }

  return (
    <div className="space-y-6">
      {justConnected && (
        <Banner kind="ok" onDismiss={() => { /* clear param */ history.replaceState({}, '', '/settings/accounts') }}>
          Connected {justConnected} successfully.
        </Banner>
      )}
      {err && (
        <Banner kind="error" onDismiss={() => setErr(null)}>{err}</Banner>
      )}

      {loading ? (
        <div
          className="flex items-center gap-2 text-sm px-4 py-3"
          style={{
            color:                '#9090b0',
            background:           'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
            backdropFilter:       'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border:               '1px solid rgba(255,255,255,0.06)',
            borderRadius:         '14px',
          }}
        >
          <Loader2 size={14} className="animate-spin" /> Loading connections…
        </div>
      ) : (
        <>
          {accounts.length > 0 && (
            <Section title="Connected">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {accounts.map(a => {
                  const provider = OAUTH_PROVIDERS.find(p => p.id === a.platform)
                  return (
                    <div
                      key={a.id}
                      className="group p-3.5 flex items-center justify-between transition-all"
                      style={{
                        background:           'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
                        backdropFilter:       'blur(28px) saturate(180%)',
                        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
                        border:               '1px solid rgba(255,255,255,0.10)',
                        borderRadius:         '16px',
                        boxShadow:
                          '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -24px rgba(0,0,0,0.5)',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.boxShadow =
                          '0 1px 0 0 rgba(255,255,255,0.08) inset, 0 24px 48px -24px rgba(108,99,255,0.18)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.boxShadow =
                          '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -24px rgba(0,0,0,0.5)'
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{
                            background: 'linear-gradient(135deg, rgba(34,197,94,0.22), rgba(34,197,94,0.04))',
                            border:     '1px solid rgba(34,197,94,0.20)',
                            boxShadow:  '0 1px 0 0 rgba(255,255,255,0.06) inset',
                          }}
                        >
                          <CheckCircle2 size={16} style={{ color: '#4ade80' }} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>
                              {provider?.name ?? a.platform}
                            </span>
                            <StatusPill kind={a.status === 'active' ? 'connected' : a.status === 'error' ? 'offline' : 'pending'} />
                          </div>
                          <div className="text-[11px] mt-0.5 flex items-center gap-1.5 min-w-0" style={{ color: '#9090b0' }}>
                            <span className="font-mono truncate" style={{ color: '#a8a3ff' }}>
                              {a.businessSlug ?? 'shared'}
                            </span>
                            <span style={{ color: '#55556a' }}>·</span>
                            <span className="truncate">{new Date(a.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void disconnect(a.id, provider?.name ?? a.platform)}
                        disabled={busy === a.id}
                        className="text-[11px] flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
                        style={{
                          color:      '#e8e8f0',
                          background: 'rgba(255,255,255,0.04)',
                          border:     '1px solid rgba(255,255,255,0.08)',
                        }}
                        onMouseEnter={e => {
                          if (busy !== a.id) {
                            e.currentTarget.style.background = 'rgba(239,68,68,0.10)'
                            e.currentTarget.style.borderColor = 'rgba(239,68,68,0.30)'
                          }
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
                        }}
                      >
                        {busy === a.id ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                        Disconnect
                      </button>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {(Object.entries(groupedProviders) as Array<[OAuthCategory, OAuthProvider[]]>).map(([category, providers]) => (
            <Section key={category} title={CATEGORY_LABEL[category]}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {providers.map(p => {
                  const connected = connectedByPlatform.has(p.id)
                  // apiKeySetup providers render a paste form instead of the
                  // OAuth Connect button. They're not brokered through Composio
                  // so the existing init/callback flow doesn't apply.
                  if (p.apiKeySetup) {
                    return (
                      <ApiKeyCard
                        key={p.id}
                        provider={p}
                        connected={connected}
                        busy={busy === p.id}
                        saved={!!apiKeySaved[p.id]}
                        value={apiKeyInput[p.id] ?? ''}
                        onChange={v => setApiKeyInput(prev => ({ ...prev, [p.id]: v }))}
                        onSave={() => void saveApiKey(p)}
                      />
                    )
                  }
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => void connect(p)}
                      disabled={busy === p.id || connected}
                      className="group p-3.5 flex items-center gap-3 transition-all disabled:opacity-60 text-left"
                      style={{
                        background:           connected
                          ? 'linear-gradient(135deg, rgba(34,197,94,0.05), rgba(255,255,255,0.02))'
                          : 'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
                        backdropFilter:       'blur(28px) saturate(180%)',
                        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
                        border:               '1px solid rgba(255,255,255,0.10)',
                        borderRadius:         '16px',
                        boxShadow:
                          '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -24px rgba(0,0,0,0.5)',
                      }}
                      onMouseEnter={e => {
                        if (busy !== p.id && !connected) {
                          e.currentTarget.style.boxShadow =
                            '0 1px 0 0 rgba(255,255,255,0.08) inset, 0 24px 48px -24px rgba(108,99,255,0.22)'
                          e.currentTarget.style.transform = 'translateY(-1px)'
                        }
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.boxShadow =
                          '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -24px rgba(0,0,0,0.5)'
                        e.currentTarget.style.transform = 'translateY(0)'
                      }}
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{
                          background: connected
                            ? 'linear-gradient(135deg, rgba(34,197,94,0.22), rgba(34,197,94,0.04))'
                            : 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))',
                          border: connected
                            ? '1px solid rgba(34,197,94,0.20)'
                            : '1px solid rgba(108,99,255,0.20)',
                          boxShadow: '0 1px 0 0 rgba(255,255,255,0.06) inset',
                        }}
                      >
                        {busy === p.id
                          ? <Loader2 size={16} className="animate-spin" style={{ color: '#9090b0' }} />
                          : connected
                            ? <CheckCircle2 size={16} style={{ color: '#4ade80' }} />
                            : <Plug size={16} style={{ color: '#a8a3ff' }} />}
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>{p.name}</span>
                          {connected && <StatusPill kind="connected" />}
                        </div>
                        <div className="text-[11px] mt-0.5 truncate" style={{ color: '#9090b0' }}>
                          {connected
                            ? <span className="font-mono uppercase tracking-wider" style={{ color: '#6a6a86' }}>composio · oauth</span>
                            : <>via Composio <span style={{ color: '#55556a' }}>·</span> <span className="font-mono" style={{ color: '#a8a3ff' }}>{p.actions.length}</span> actions</>}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </Section>
          ))}
        </>
      )}
    </div>
  )
}

function ApiKeyCard({
  provider, connected, busy, saved, value, onChange, onSave,
}: {
  provider:  OAuthProvider
  connected: boolean
  busy:      boolean
  saved:     boolean
  value:     string
  onChange:  (v: string) => void
  onSave:    () => void
}) {
  const setup = provider.apiKeySetup ?? {}
  return (
    <div
      className="p-3.5 flex flex-col gap-2.5"
      style={{
        background:           connected
          ? 'linear-gradient(135deg, rgba(34,197,94,0.05), rgba(255,255,255,0.02))'
          : 'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
        backdropFilter:       'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border:               '1px solid rgba(255,255,255,0.10)',
        borderRadius:         '16px',
        boxShadow:
          '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -24px rgba(0,0,0,0.5)',
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: connected
              ? 'linear-gradient(135deg, rgba(34,197,94,0.22), rgba(34,197,94,0.04))'
              : 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))',
            border: connected
              ? '1px solid rgba(34,197,94,0.20)'
              : '1px solid rgba(108,99,255,0.20)',
            boxShadow: '0 1px 0 0 rgba(255,255,255,0.06) inset',
          }}
        >
          {busy
            ? <Loader2 size={16} className="animate-spin" style={{ color: '#9090b0' }} />
            : connected
              ? <CheckCircle2 size={16} style={{ color: '#4ade80' }} />
              : <KeyRound size={16} style={{ color: '#a8a3ff' }} />}
        </div>
        <div className="min-w-0 text-left flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>{provider.name}</span>
            <StatusPill kind={connected ? 'connected' : 'manual'} />
          </div>
          <div className="text-[11px] mt-0.5 truncate" style={{ color: '#9090b0' }}>
            {connected ? 'Key encrypted · paste to rotate' : <span className="font-mono uppercase tracking-wider" style={{ color: '#6a6a86' }}>direct · api key</span>}
          </div>
        </div>
      </div>
      {setup.instructions && (
        <p className="text-[11px] leading-snug" style={{ color: '#9090b0' }}>{setup.instructions}</p>
      )}
      <div className="flex items-stretch gap-2">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSave() } }}
          placeholder={`paste ${provider.name.toLowerCase()} key`}
          className="flex-1 rounded-lg px-2.5 py-1.5 text-xs font-mono transition-colors"
          style={{
            background:  'rgba(5,5,16,0.55)',
            border:      '1px solid rgba(255,255,255,0.08)',
            color:       '#e8e8f0',
            outline:     'none',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(108,99,255,0.40)' }}
          onBlur={e =>  { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
          disabled={busy}
        />
        <button
          type="button"
          onClick={onSave}
          disabled={busy || value.trim().length === 0}
          className="text-[11px] px-3 rounded-lg transition-all disabled:opacity-50 font-medium"
          style={{
            background: saved
              ? 'linear-gradient(135deg, rgba(34,197,94,0.22), rgba(34,197,94,0.06))'
              : 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.10))',
            color:      '#e8e8f0',
            border:     saved ? '1px solid rgba(34,197,94,0.30)' : '1px solid rgba(108,99,255,0.30)',
            boxShadow:  '0 1px 0 0 rgba(255,255,255,0.06) inset',
          }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : saved ? 'Saved' : 'Save'}
        </button>
      </div>
      {setup.credentialsUrl && (
        <a
          href={setup.credentialsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px]"
          style={{ color: '#a8a3ff' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#c4c0ff' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#a8a3ff' }}
        >
          Where to get this <ExternalLink size={10} />
        </a>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[10px] font-mono uppercase tracking-[0.18em] mb-2.5 flex items-center gap-2" style={{ color: '#9090b0' }}>
        <span style={{ color: '#a8a3ff' }}>{'//'}</span>
        <span>{title}</span>
        <span className="flex-1 h-px" style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.08), transparent)' }} />
      </h2>
      {children}
    </div>
  )
}

type PillKind = 'connected' | 'pending' | 'manual' | 'offline'

function StatusPill({ kind }: { kind: PillKind }) {
  const map: Record<PillKind, { label: string; dot: string; glow: string; text: string; bg: string; border: string }> = {
    connected: {
      label:  'CONNECTED',
      dot:    '#4ade80',
      glow:   '0 0 8px rgba(74,222,128,0.6)',
      text:   '#4ade80',
      bg:     'rgba(34,197,94,0.10)',
      border: 'rgba(34,197,94,0.20)',
    },
    pending: {
      label:  'PENDING',
      dot:    '#fbbf24',
      glow:   '0 0 8px rgba(251,191,36,0.5)',
      text:   '#fbbf24',
      bg:     'rgba(251,191,36,0.08)',
      border: 'rgba(251,191,36,0.20)',
    },
    manual: {
      label:  'MANUAL',
      dot:    '#a8a3ff',
      glow:   '0 0 8px rgba(168,163,255,0.5)',
      text:   '#a8a3ff',
      bg:     'rgba(108,99,255,0.10)',
      border: 'rgba(108,99,255,0.22)',
    },
    offline: {
      label:  'OFFLINE',
      dot:    '#ef4444',
      glow:   '0 0 8px rgba(239,68,68,0.5)',
      text:   '#f87171',
      bg:     'rgba(239,68,68,0.08)',
      border: 'rgba(239,68,68,0.22)',
    },
  }
  const s = map[kind]
  return (
    <span
      className="inline-flex items-center gap-1.5 px-1.5 py-0.5 text-[9px] font-mono tracking-[0.12em] shrink-0"
      style={{
        background:   s.bg,
        border:       `1px solid ${s.border}`,
        borderRadius: '999px',
        color:        s.text,
      }}
    >
      <span
        className="w-1 h-1 rounded-full"
        style={{ background: s.dot, boxShadow: s.glow }}
      />
      {s.label}
    </span>
  )
}

function Banner({ kind, children, onDismiss }: { kind: 'ok' | 'error'; children: React.ReactNode; onDismiss: () => void }) {
  const okColor    = '#4ade80'
  const errColor   = '#f87171'
  return (
    <div
      className="px-3.5 py-2.5 flex items-start gap-2.5 text-sm"
      style={{
        background:           kind === 'ok'
          ? 'linear-gradient(135deg, rgba(34,197,94,0.10), rgba(34,197,94,0.02))'
          : 'linear-gradient(135deg, rgba(239,68,68,0.10), rgba(239,68,68,0.02))',
        backdropFilter:       'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border:               kind === 'ok' ? '1px solid rgba(34,197,94,0.22)' : '1px solid rgba(239,68,68,0.22)',
        borderRadius:         '14px',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 16px 32px -16px rgba(0,0,0,0.4)',
        color:                '#e8e8f0',
      }}
    >
      {kind === 'ok' ? <CheckCircle2 size={16} style={{ color: okColor }} /> : <AlertCircle size={16} style={{ color: errColor }} />}
      <div className="flex-1">{children}</div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="rounded-md p-0.5 transition-colors"
        style={{ color: '#9090b0' }}
        onMouseEnter={e => { e.currentTarget.style.color = '#e8e8f0'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
        onMouseLeave={e => { e.currentTarget.style.color = '#9090b0'; e.currentTarget.style.background = 'transparent' }}
      ><X size={14} /></button>
    </div>
  )
}

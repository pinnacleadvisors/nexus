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
import { ADMIN_SCOPE } from '@/lib/claw/business-client'

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

  // Filter providers by the current scope's policy.
  //   - Admin scope: 'dual' + 'admin-only' (platform-management tokens)
  //   - Shared scope (null): 'dual' + 'shared-only' (shared business resources)
  //   - Per-business scope: 'per-business' (the per-audience platforms; Vercel/
  //     GitHub/etc. are reached via the Shared fallback chain, not here)
  // Defaults to 'per-business' when scopePolicy is unset (safest).
  const currentScope: 'admin' | 'shared' | 'business' =
    businessSlug === ADMIN_SCOPE ? 'admin'
    : businessSlug             ? 'business'
                               : 'shared'

  const visibleProviders = OAUTH_PROVIDERS.filter(p => {
    const policy = p.scopePolicy ?? 'per-business'
    if (currentScope === 'admin')    return policy === 'dual' || policy === 'admin-only'
    if (currentScope === 'shared')   return policy === 'dual' || policy === 'shared-only'
    /* business */                   return policy === 'per-business'
  })

  const connectedByPlatform = new Map(accounts.map(a => [a.platform, a]))
  const groupedProviders: Record<OAuthCategory, OAuthProvider[]> = {} as never
  for (const p of visibleProviders) {
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
          {/* The top "Connected" duplicate-list was retired by the audit
              (2026-05-16). Connection state, scope, and Disconnect now live
              in the per-category platform tile itself — one place per
              logical platform. The badge below summarises the count so the
              operator still sees a glanceable "X platforms connected" at
              the top of the page. */}
          <ConnectedSummary count={accounts.length} scope={currentScope} />

          {(Object.entries(groupedProviders) as Array<[OAuthCategory, OAuthProvider[]]>).map(([category, providers]) => (
            <Section key={category} title={CATEGORY_LABEL[category]}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {providers.map(p => {
                  const account = connectedByPlatform.get(p.id)
                  // apiKeySetup providers render a paste form / rotate widget
                  // instead of the OAuth Connect button — not Composio-brokered.
                  if (p.apiKeySetup) {
                    return (
                      <ApiKeyCard
                        key={p.id}
                        provider={p}
                        account={account}
                        busy={busy === p.id}
                        saved={!!apiKeySaved[p.id]}
                        value={apiKeyInput[p.id] ?? ''}
                        onChange={v => setApiKeyInput(prev => ({ ...prev, [p.id]: v }))}
                        onSave={() => void saveApiKey(p)}
                        onDisconnect={() => account && void disconnect(account.id, p.name)}
                      />
                    )
                  }
                  return (
                    <OAuthTile
                      key={p.id}
                      provider={p}
                      account={account}
                      busy={busy === p.id}
                      onConnect={() => void connect(p)}
                      onDisconnect={() => account && void disconnect(account.id, p.name)}
                    />
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
  provider, account, busy, saved, value, onChange, onSave, onDisconnect,
}: {
  provider:     OAuthProvider
  account?:     ConnectedAccount
  busy:         boolean
  saved:        boolean
  value:        string
  onChange:     (v: string) => void
  onSave:       () => void
  onDisconnect: () => void
}) {
  const setup     = provider.apiKeySetup ?? {}
  const connected = !!account
  // When already connected, the paste form is gated behind a "Rotate" toggle.
  // Showing it unconditionally caused the audit's "Vercel shows CONNECTED +
  // paste form simultaneously" finding (2026-05-16 p2.5).
  const [showRotate, setShowRotate] = useState(!connected)

  // If connection state flips (e.g. successful save → load returns the
  // freshly-saved account row → `account` becomes defined), collapse the
  // form back to its tidy state.
  useEffect(() => {
    setShowRotate(!connected)
  }, [connected])

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
          <div className="text-[11px] mt-0.5 flex items-center gap-1.5 min-w-0" style={{ color: '#9090b0' }}>
            {account ? (
              <>
                <span className="font-mono truncate" style={{ color: '#a8a3ff' }}>
                  {account.businessSlug ?? 'shared'}
                </span>
                <span style={{ color: '#55556a' }}>·</span>
                <span className="truncate">{new Date(account.createdAt).toLocaleDateString()}</span>
              </>
            ) : (
              <span className="font-mono uppercase tracking-wider" style={{ color: '#6a6a86' }}>direct · api key</span>
            )}
          </div>
        </div>
        {connected && !showRotate && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowRotate(true)}
              className="text-[11px] px-2 py-1 rounded-md transition-colors"
              style={{
                color:      '#e8e8f0',
                background: 'rgba(255,255,255,0.04)',
                border:     '1px solid rgba(255,255,255,0.08)',
              }}
              title="Paste a new key to rotate"
            >
              Rotate
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              disabled={busy}
              className="text-[11px] flex items-center px-1.5 py-1 rounded-md transition-colors disabled:opacity-50"
              style={{
                color:      '#e8e8f0',
                background: 'rgba(255,255,255,0.04)',
                border:     '1px solid rgba(255,255,255,0.08)',
              }}
              onMouseEnter={e => {
                if (!busy) {
                  e.currentTarget.style.background = 'rgba(239,68,68,0.10)'
                  e.currentTarget.style.borderColor = 'rgba(239,68,68,0.30)'
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
              }}
              title="Disconnect"
              aria-label="Disconnect"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
            </button>
          </div>
        )}
      </div>
      {/* Paste form: only when not connected, or when explicitly rotating. */}
      {showRotate && (
        <>
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
              placeholder={`paste ${connected ? 'new ' : ''}${provider.name.toLowerCase()} key`}
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
              {busy ? <Loader2 size={12} className="animate-spin" /> : saved ? 'Saved' : connected ? 'Rotate' : 'Save'}
            </button>
            {connected && (
              <button
                type="button"
                onClick={() => setShowRotate(false)}
                className="text-[11px] px-2 rounded-lg transition-colors"
                style={{
                  color:      '#9090b0',
                  background: 'rgba(255,255,255,0.03)',
                  border:     '1px solid rgba(255,255,255,0.08)',
                }}
                title="Cancel"
              >
                Cancel
              </button>
            )}
          </div>
          {setup.credentialsUrl && !connected && (
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
        </>
      )}
    </div>
  )
}

/**
 * Single tile rendering one logical OAuth platform. Was previously rendered
 * in TWO places (top "Connected" list + the per-category section), which the
 * audit (2026-05-16 p2.6) flagged as confusing 3-way duplication. Now lives
 * here, the per-category section is its only home, and connection state +
 * scope + date + Disconnect all live on the same tile.
 */
function OAuthTile({ provider, account, busy, onConnect, onDisconnect }: {
  provider:     OAuthProvider
  account?:     ConnectedAccount
  busy:         boolean
  onConnect:    () => void
  onDisconnect: () => void
}) {
  const connected = !!account
  return (
    <div
      className="group p-3.5 flex items-center gap-3 transition-all"
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
        cursor: connected ? 'default' : 'pointer',
      }}
      onClick={() => { if (!connected && !busy) onConnect() }}
      onMouseEnter={e => {
        if (busy || connected) return
        e.currentTarget.style.boxShadow =
          '0 1px 0 0 rgba(255,255,255,0.08) inset, 0 24px 48px -24px rgba(108,99,255,0.22)'
        e.currentTarget.style.transform = 'translateY(-1px)'
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
        {busy
          ? <Loader2 size={16} className="animate-spin" style={{ color: '#9090b0' }} />
          : connected
            ? <CheckCircle2 size={16} style={{ color: '#4ade80' }} />
            : <Plug size={16} style={{ color: '#a8a3ff' }} />}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>{provider.name}</span>
          {connected && <StatusPill kind="connected" />}
        </div>
        <div className="text-[11px] mt-0.5 flex items-center gap-1.5 min-w-0" style={{ color: '#9090b0' }}>
          {account ? (
            <>
              <span className="font-mono truncate" style={{ color: '#a8a3ff' }} title="Connection scope">
                {account.businessSlug ?? 'shared'}
              </span>
              <span style={{ color: '#55556a' }}>·</span>
              <span className="truncate" title="Connected on">
                {new Date(account.createdAt).toLocaleDateString()}
              </span>
            </>
          ) : (
            <>via Composio <span style={{ color: '#55556a' }}>·</span> <span className="font-mono" style={{ color: '#a8a3ff' }}>{provider.actions.length}</span> actions</>
          )}
        </div>
      </div>
      {connected && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onDisconnect() }}
          disabled={busy}
          className="shrink-0 text-[11px] flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
          style={{
            color:      '#e8e8f0',
            background: 'rgba(255,255,255,0.04)',
            border:     '1px solid rgba(255,255,255,0.08)',
          }}
          onMouseEnter={e => {
            if (busy) return
            e.currentTarget.style.background = 'rgba(239,68,68,0.10)'
            e.currentTarget.style.borderColor = 'rgba(239,68,68,0.30)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
          }}
          title="Disconnect"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
          Disconnect
        </button>
      )}
    </div>
  )
}

/**
 * One-line summary chip showing "N platforms connected in {scope}" at the
 * top of the page. Replaces the audit-flagged top "Connected" duplicate list
 * with a glanceable count.
 */
function ConnectedSummary({ count, scope }: { count: number; scope: 'admin' | 'shared' | 'business' }) {
  if (count === 0) {
    return (
      <div
        className="px-3.5 py-2.5 flex items-center gap-2 text-[11px]"
        style={{
          background:           'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
          backdropFilter:       'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border:               '1px solid rgba(255,255,255,0.06)',
          borderRadius:         '14px',
          color:                '#9090b0',
        }}
      >
        <Plug size={12} style={{ color: '#9090b0' }} />
        <span>Nothing connected here yet — pick a platform below to start.</span>
      </div>
    )
  }
  const scopeLabel = scope === 'admin' ? 'admin scope' : scope === 'business' ? 'this business' : 'shared scope'
  return (
    <div
      className="px-3.5 py-2.5 flex items-center gap-2.5 text-[12px]"
      style={{
        background:           'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(255,255,255,0.02))',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border:               '1px solid rgba(34,197,94,0.18)',
        borderRadius:         '14px',
        color:                '#e8e8f0',
      }}
    >
      <CheckCircle2 size={13} style={{ color: '#4ade80' }} />
      <span>
        <span className="font-medium">{count}</span>
        <span style={{ color: '#9090b0' }}> {count === 1 ? 'platform' : 'platforms'} connected in </span>
        <span className="font-mono" style={{ color: '#a8a3ff' }}>{scopeLabel}</span>
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[10px] font-mono uppercase tracking-[0.18em] mb-2.5 flex items-center gap-2" style={{ color: '#9090b0' }}>
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

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
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Loader2, Plug, Power, AlertCircle, X } from 'lucide-react'
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
  const params = useSearchParams()
  const justConnected = params?.get('connected')
  const errorParam    = params?.get('error')

  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [loading,  setLoading]  = useState(true)
  const [busy,     setBusy]     = useState<string | null>(null)
  const [err,      setErr]      = useState<string | null>(errorParam || null)

  async function load() {
    setLoading(true)
    try {
      const url = businessSlug ? `/api/connected-accounts?businessSlug=${businessSlug}` : '/api/connected-accounts'
      const res = await fetch(url)
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
        <div className="flex items-center gap-2 text-sm" style={{ color: '#9090b0' }}>
          <Loader2 size={14} className="animate-spin" /> Loading connections…
        </div>
      ) : (
        <>
          {accounts.length > 0 && (
            <Section title="Connected accounts">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {accounts.map(a => {
                  const provider = OAUTH_PROVIDERS.find(p => p.id === a.platform)
                  return (
                    <div key={a.id} className="rounded-lg border p-3 flex items-center justify-between" style={{ borderColor: '#24243e', background: '#0c0c18' }}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: '#16162a' }}>
                          <CheckCircle2 size={16} style={{ color: '#22c55e' }} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>
                            {provider?.name ?? a.platform}
                          </div>
                          <div className="text-xs" style={{ color: '#9090b0' }}>
                            {a.businessSlug ? `Business: ${a.businessSlug}` : 'User default'} · connected {new Date(a.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void disconnect(a.id, provider?.name ?? a.platform)}
                        disabled={busy === a.id}
                        className="text-xs flex items-center gap-1 px-2 py-1 rounded transition-colors"
                        style={{ color: '#9090b0', border: '1px solid #24243e' }}
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
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => void connect(p)}
                      disabled={busy === p.id || connected}
                      className="rounded-lg border p-3 flex items-center gap-3 transition-colors disabled:opacity-60 hover:bg-[#0f0f1f]"
                      style={{ borderColor: '#24243e', background: '#0c0c18' }}
                    >
                      <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: '#16162a' }}>
                        {busy === p.id
                          ? <Loader2 size={16} className="animate-spin" style={{ color: '#9090b0' }} />
                          : connected
                            ? <CheckCircle2 size={16} style={{ color: '#22c55e' }} />
                            : <Plug size={16} style={{ color: '#6c63ff' }} />}
                      </div>
                      <div className="min-w-0 text-left">
                        <div className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>{p.name}</div>
                        <div className="text-xs" style={{ color: '#9090b0' }}>
                          {connected ? 'Connected' : `Connect via Composio · ${p.actions.length} actions`}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs uppercase tracking-wider mb-2" style={{ color: '#9090b0' }}>{title}</h2>
      {children}
    </div>
  )
}

function Banner({ kind, children, onDismiss }: { kind: 'ok' | 'error'; children: React.ReactNode; onDismiss: () => void }) {
  const okColor    = '#22c55e'
  const errColor   = '#ef4444'
  return (
    <div className="rounded-md border px-3 py-2 flex items-start gap-2 text-sm" style={{
      borderColor: kind === 'ok' ? okColor : errColor,
      color:       '#e8e8f0',
      background:  kind === 'ok' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
    }}>
      {kind === 'ok' ? <CheckCircle2 size={16} style={{ color: okColor }} /> : <AlertCircle size={16} style={{ color: errColor }} />}
      <div className="flex-1">{children}</div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss"><X size={14} /></button>
    </div>
  )
}

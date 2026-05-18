'use client'

/**
 * AiProviderList — body for Settings → AI Providers tab.
 *
 * Renders one AiProviderCard per AI provider in lib/ai/providers.ts. Resolves
 * connection state from:
 *   - /api/gateway-status  → subscription mode (Claude Code gateway, Codex gateway)
 *   - /api/connected-accounts → API key mode (encrypted_api_key rows)
 *
 * Mirrors the design conventions of AccountList.tsx so /settings?tab=ai and
 * /settings/accounts feel like one product.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, AlertCircle, CheckCircle2, Server, Zap, X } from 'lucide-react'
import { AI_PROVIDERS } from '@/lib/ai/providers'
import { MODEL_CATALOG } from '@/lib/models/catalog'
import AiProviderCard, { type AiProviderConnection } from './AiProviderCard'

interface ConnectedAccount {
  id:           string
  platform:     string
  businessSlug: string | null
  status:       'active' | 'revoked' | 'error'
  createdAt:    string
  lastUsedAt:   string | null
}

interface GatewayStatus {
  provider:       'gateway' | 'openclaw' | 'api' | 'none'
  gatewayUrl?:    string
  gatewayHealthy: boolean
  loggedIn?:      boolean
  queueDepth?:    number
}

export default function AiProviderList({ businessSlug }: { businessSlug?: string | null }) {
  const params      = useSearchParams()
  const errorParam  = params?.get('error') ?? null
  const [accounts, setAccounts]   = useState<ConnectedAccount[]>([])
  const [gateway,  setGateway]    = useState<GatewayStatus | null>(null)
  const [loading,  setLoading]    = useState(true)
  const [err,      setErr]        = useState<string | null>(errorParam)

  async function load() {
    setLoading(true)
    try {
      const url = businessSlug ? `/api/connected-accounts?businessSlug=${businessSlug}` : '/api/connected-accounts'
      const [accRes, gwRes] = await Promise.all([
        fetch(url),
        fetch('/api/gateway-status'),
      ])
      if (accRes.status === 401) {
        window.location.href = '/sign-in?returnUrl=' + encodeURIComponent(window.location.pathname + window.location.search)
        return
      }
      if (accRes.ok) {
        const json = (await accRes.json()) as { accounts: ConnectedAccount[] }
        setAccounts(json.accounts)
      }
      if (gwRes.ok) {
        const json = (await gwRes.json()) as GatewayStatus
        setGateway(json)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load AI providers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [businessSlug])

  async function saveApiKey(platform: string, apiKey: string) {
    const res = await fetch('/api/connected-accounts/api-key', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ platform, businessSlug, apiKey }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(j.error ?? `save failed: ${res.status}`)
    }
    await load()
  }

  async function revokeApiKey(platform: string) {
    const res = await fetch('/api/connected-accounts/api-key', {
      method:  'DELETE',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ platform, businessSlug }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(j.error ?? `disconnect failed: ${res.status}`)
    }
    await load()
  }

  const byPlatform = useMemo(() => new Map(accounts.map(a => [a.platform, a])), [accounts])

  return (
    <div className="space-y-4">
      <ProviderChainBanner gateway={gateway} accounts={accounts} />

      {err && (
        <div className="flex items-start gap-2.5 px-3.5 py-2.5 text-sm"
          style={{
            background:           'linear-gradient(135deg, rgba(239,68,68,0.10), rgba(239,68,68,0.02))',
            backdropFilter:       'blur(28px) saturate(180%)',
            WebkitBackdropFilter: 'blur(28px) saturate(180%)',
            border:               '1px solid rgba(239,68,68,0.22)',
            borderRadius:         '14px',
            color:                '#e8e8f0',
          }}>
          <AlertCircle size={16} style={{ color: '#f87171' }} />
          <div className="flex-1">{err}</div>
          <button type="button" onClick={() => setErr(null)} aria-label="Dismiss" className="p-0.5">
            <X size={14} style={{ color: '#9090b0' }} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm px-4 py-3"
          style={{
            color:                '#9090b0',
            background:           'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
            backdropFilter:       'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border:               '1px solid rgba(255,255,255,0.06)',
            borderRadius:         '14px',
          }}>
          <Loader2 size={14} className="animate-spin" /> Loading AI providers…
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {AI_PROVIDERS.map(p => {
            const acc = byPlatform.get(p.id)
            const connection: AiProviderConnection = {
              subscription: deriveSubscriptionState(p.id, gateway),
              apiKey: acc ? {
                id:           acc.id,
                createdAt:    acc.createdAt,
                businessSlug: acc.businessSlug,
              } : null,
            }
            const models = MODEL_CATALOG.filter(m => m.provider === p.id)
            return (
              <AiProviderCard
                key={p.id}
                provider={p}
                connection={connection}
                models={models}
                onSaveApiKey={(k: string) => saveApiKey(p.id, k)}
                onRevokeApiKey={() => revokeApiKey(p.id)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function deriveSubscriptionState(providerId: string, gateway: GatewayStatus | null): AiProviderConnection['subscription'] {
  if (!gateway) return null
  if (providerId === 'anthropic') {
    if (gateway.provider === 'gateway' && gateway.gatewayHealthy) {
      return { active: true, detail: gateway.loggedIn === false ? 'Gateway up, not logged in' : `Plan-billed · queue ${gateway.queueDepth ?? 0}` }
    }
    if (gateway.provider === 'openclaw') {
      return { active: true, detail: 'OpenClaw gateway (legacy)' }
    }
    if (gateway.provider === 'gateway' && !gateway.gatewayHealthy) {
      return { active: false, detail: 'Gateway unhealthy' }
    }
    return null
  }
  if (providerId === 'openai') {
    // We don't have a dedicated codex-gateway health endpoint yet — surface
    // "configured" when the env-var pair is present (reflected in env scope).
    const hasCodex = Boolean(process.env.NEXT_PUBLIC_CODEX_GATEWAY_CONFIGURED)
    return hasCodex ? { active: true, detail: 'Codex gateway configured' } : null
  }
  return null
}

function ProviderChainBanner({ gateway, accounts }: { gateway: GatewayStatus | null; accounts: ConnectedAccount[] }) {
  const subOn = gateway?.provider === 'gateway' && gateway.gatewayHealthy
  const apiOn = accounts.some(a => a.platform === 'anthropic' || a.platform === 'openai') || gateway?.provider === 'api'
  return (
    <div className="relative p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3"
      style={{
        background:           'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
        backdropFilter:       'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border:               '1px solid rgba(255,255,255,0.10)',
        borderRadius:         '18px',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -24px rgba(0,0,0,0.5)',
      }}>
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-md flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))', border: '1px solid rgba(108,99,255,0.20)' }}>
          <Zap size={13} style={{ color: '#a8a3ff' }} />
        </div>
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#9090b0' }}>Provider chain</p>
          <p className="text-xs" style={{ color: '#e8e8f0' }}>Resolution priority</p>
        </div>
      </div>
      <div className="flex-1 flex items-center gap-2 flex-wrap text-[11px]">
        <Step label="Subscription gateway" on={subOn}     hint={subOn ? gateway?.gatewayUrl : 'unconfigured'} />
        <Arrow />
        <Step label="API key fallback"     on={apiOn}     hint={apiOn ? 'available' : 'no keys saved'} />
        <Arrow />
        <Step label="Final error"          on={!subOn && !apiOn} hint="no provider" />
      </div>
    </div>
  )
}

function Step({ label, on, hint }: { label: string; on: boolean; hint?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
      style={{
        background: on ? 'rgba(34,197,94,0.10)' : 'rgba(255,255,255,0.04)',
        border:     on ? '1px solid rgba(34,197,94,0.22)' : '1px solid rgba(255,255,255,0.08)',
      }}>
      {on ? <CheckCircle2 size={11} style={{ color: '#4ade80' }} /> : <Server size={11} style={{ color: '#9090b0' }} />}
      <span style={{ color: on ? '#e8e8f0' : '#9090b0' }}>{label}</span>
      {hint && <span className="font-mono text-[10px]" style={{ color: '#55556a' }}>· {hint}</span>}
    </div>
  )
}

function Arrow() {
  return <span style={{ color: '#55556a' }}>→</span>
}

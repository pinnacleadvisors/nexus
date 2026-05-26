'use client'

/**
 * AiProviderCard — one card per AI provider on Settings → AI Providers.
 *
 * Two connection modes share the same liquid-glass body:
 *   - Subscription — gateway/CLI auth (Claude Code, Codex). No per-call cost.
 *   - API key      — encrypted paste form via /api/connected-accounts/api-key.
 *
 * The card auto-collapses into "compact" mode once the provider has at least
 * one active connection — clicking expands the inline tabs.
 *
 * Visual contract: matches OAuthTile / ApiKeyCard from AccountList.tsx so the
 * two pages feel like one product.
 */

import { useState } from 'react'
import { Sparkles, Bot, Cpu, Wand2, Zap, Power, AlertCircle } from 'lucide-react'
import type { AiProvider } from '@/lib/ai/providers'
import type { ModelDefinition } from '@/lib/models/types'
import {
  CardHeader, ModeTabs, SubscriptionBody, ApiKeyBody, CardFooter,
} from './AiProviderCardSections'
import ProviderPreferencesPanel from './ProviderPreferencesPanel'

// Lucide doesn't export a type-safe map, so we accept any of the small set the
// AI registry actually uses and fall back to Sparkles.
const ICON_MAP: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  Sparkles, Bot, Cpu, Wand2, Zap,
}

export interface AiProviderConnection {
  /** Truthy when the subscription gateway is configured + healthy. */
  subscription: { active: boolean; detail?: string } | null
  /** connected_accounts row id when an API key is saved. */
  apiKey: { id: string; createdAt: string; businessSlug: string | null } | null
}

export interface AiProviderCardProps {
  provider:    AiProvider
  connection:  AiProviderConnection
  /** Models in the catalog that come from this provider — count is shown as a chip. */
  models:      ModelDefinition[]
  /** When set, the API-key tab is the only one rendered. */
  hideSubscription?: boolean
  /** Operator has explicitly disabled this provider via the toggle.
   *  When true, the card renders a muted state + banner explaining the
   *  fallback behaviour. The provider stays connected (keys/gateway still
   *  configured) — only routing skips it. */
  disabled?: boolean
  /** Flip the disable state. Pass the NEXT desired state, not the current. */
  onToggleDisabled?: (next: boolean) => Promise<void>
  /** Called when the operator saves an API key. */
  onSaveApiKey:    (apiKey: string) => Promise<void>
  /** Called when the operator removes the API key. */
  onRevokeApiKey:  () => Promise<void>
  /** Optional initial active mode override. */
  initialMode?: 'subscription' | 'api'
}

export default function AiProviderCard(props: AiProviderCardProps) {
  const { provider, connection, models, hideSubscription, disabled, onToggleDisabled, onSaveApiKey, onRevokeApiKey, initialMode } = props
  const Icon = ICON_MAP[provider.icon] ?? Sparkles
  const subActive = !!connection.subscription?.active
  const apiActive = !!connection.apiKey
  const connected = subActive || apiActive
  const [busyToggle, setBusyToggle] = useState(false)

  async function handleToggleDisabled() {
    if (!onToggleDisabled || busyToggle) return
    setBusyToggle(true)
    try {
      await onToggleDisabled(!disabled)
    } finally {
      setBusyToggle(false)
    }
  }

  const canSub  = !hideSubscription && provider.modes.includes('subscription') && !!provider.subscription
  const canApi  = provider.modes.includes('api') && !!provider.api
  const [mode, setMode] = useState<'subscription' | 'api'>(
    initialMode
      ?? (canSub && (subActive || !apiActive) ? 'subscription' : 'api'),
  )

  const [apiKey, setApiKey] = useState('')
  const [busy,   setBusy]   = useState(false)
  const [err,    setErr]    = useState<string | null>(null)
  const [saved,  setSaved]  = useState(false)
  const [showRotate, setShowRotate] = useState(!apiActive)

  async function handleSave() {
    if (!apiKey.trim()) { setErr(`Paste a ${provider.name} key first.`); return }
    setBusy(true); setErr(null)
    try {
      await onSaveApiKey(apiKey.trim())
      setApiKey('')
      setSaved(true)
      setShowRotate(false)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke() {
    if (!confirm(`Disconnect ${provider.name} (API key)?`)) return
    setBusy(true); setErr(null)
    try {
      await onRevokeApiKey()
      setShowRotate(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'disconnect failed')
    } finally {
      setBusy(false)
    }
  }

  // When the operator disables a connected provider, mute the card. The
  // background flips to a muted neutral gradient (vs the green-tint used
  // for connected-and-enabled) and the inline banner explains the routing
  // consequence. The provider stays connected — only routing skips it.
  const cardBackground = disabled
    ? 'linear-gradient(135deg, rgba(120,120,140,0.05), rgba(255,255,255,0.01))'
    : connected
      ? 'linear-gradient(135deg, rgba(34,197,94,0.05), rgba(255,255,255,0.02))'
      : 'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))'

  return (
    <div
      className="p-4 flex flex-col gap-3"
      style={{
        background:           cardBackground,
        backdropFilter:       'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border:               '1px solid rgba(255,255,255,0.10)',
        borderRadius:         '16px',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -24px rgba(0,0,0,0.5)',
        opacity:              disabled ? 0.85 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <CardHeader
            provider={provider}
            Icon={Icon}
            connected={connected}
            subActive={subActive}
            apiActive={apiActive}
            modelCount={models.length}
          />
        </div>
        {onToggleDisabled && (
          <button
            type="button"
            onClick={() => void handleToggleDisabled()}
            disabled={busyToggle}
            title={disabled
              ? `Re-enable ${provider.name}. The recommender and chat-fallback will consider its models again.`
              : `Disable ${provider.name}. The recommender + chat-fallback skip this provider; falls back to the next available one. Configured keys / subscriptions are not removed — flip back on any time.`}
            className="shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-all"
            style={{
              background: disabled
                ? 'rgba(255,255,255,0.06)'
                : 'rgba(34,197,94,0.10)',
              color: disabled
                ? '#9090b0'
                : '#4ade80',
              border: disabled
                ? '1px solid rgba(255,255,255,0.14)'
                : '1px solid rgba(34,197,94,0.30)',
              opacity: busyToggle ? 0.5 : 1,
              cursor:  busyToggle ? 'wait' : 'pointer',
            }}
            aria-pressed={!disabled}
            aria-label={disabled ? `Re-enable ${provider.name}` : `Disable ${provider.name}`}
          >
            <Power size={10} />
            {disabled ? 'Off' : 'On'}
          </button>
        )}
      </div>

      {disabled && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-[11px]"
          style={{
            background:  'rgba(251,191,36,0.08)',
            border:      '1px solid rgba(251,191,36,0.20)',
            color:       '#fbbf24',
          }}>
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span style={{ color: '#fde68a' }}>
            Routing skips {provider.name}. The platform falls back to the next available provider (per the chain banner above). Click <strong>On</strong> to re-enable — no reconfiguration needed.
          </span>
        </div>
      )}

      {(canSub || canApi) && (
        <ModeTabs
          canSub={canSub}
          canApi={canApi}
          mode={mode}
          onChange={setMode}
          subActive={subActive}
          apiActive={apiActive}
        />
      )}

      {mode === 'subscription' && canSub && provider.subscription && (
        <SubscriptionBody
          provider={provider}
          active={subActive}
          detail={connection.subscription?.detail}
        />
      )}

      {mode === 'api' && canApi && provider.api && (
        <ApiKeyBody
          provider={provider}
          active={apiActive}
          showRotate={showRotate}
          apiKey={apiKey}
          busy={busy}
          saved={saved}
          err={err}
          onChange={setApiKey}
          onSave={() => void handleSave()}
          onRotate={() => setShowRotate(true)}
          onCancel={() => setShowRotate(false)}
          onRevoke={() => void handleRevoke()}
          connectionDetail={connection.apiKey}
        />
      )}

      {(provider.id === 'anthropic' || provider.id === 'openai') && (
        <ProviderPreferencesPanel
          providerId={provider.id}
          providerName={provider.name}
        />
      )}

      <CardFooter provider={provider} models={models} />
    </div>
  )
}


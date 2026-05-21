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
import { Sparkles, Bot, Cpu, Wand2, Zap } from 'lucide-react'
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
  /** Called when the operator saves an API key. */
  onSaveApiKey:    (apiKey: string) => Promise<void>
  /** Called when the operator removes the API key. */
  onRevokeApiKey:  () => Promise<void>
  /** Optional initial active mode override. */
  initialMode?: 'subscription' | 'api'
}

export default function AiProviderCard(props: AiProviderCardProps) {
  const { provider, connection, models, hideSubscription, onSaveApiKey, onRevokeApiKey, initialMode } = props
  const Icon = ICON_MAP[provider.icon] ?? Sparkles
  const subActive = !!connection.subscription?.active
  const apiActive = !!connection.apiKey
  const connected = subActive || apiActive

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

  return (
    <div
      className="p-4 flex flex-col gap-3"
      style={{
        background: connected
          ? 'linear-gradient(135deg, rgba(34,197,94,0.05), rgba(255,255,255,0.02))'
          : 'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
        backdropFilter:       'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border:               '1px solid rgba(255,255,255,0.10)',
        borderRadius:         '16px',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -24px rgba(0,0,0,0.5)',
      }}
    >
      <CardHeader
        provider={provider}
        Icon={Icon}
        connected={connected}
        subActive={subActive}
        apiActive={apiActive}
        modelCount={models.length}
      />

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


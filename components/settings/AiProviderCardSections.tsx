'use client'

/**
 * Render sections for AiProviderCard — split out so the parent stays under the
 * write-size cap. Same liquid-glass conventions as AccountList.tsx.
 */

import {
  CheckCircle2, Loader2, Power, ExternalLink, KeyRound, AlertCircle, Server,
} from 'lucide-react'
import type { AiProvider } from '@/lib/ai/providers'
import type { ModelDefinition } from '@/lib/models/types'
import type { AiProviderConnection } from './AiProviderCard'

// ── helpers ────────────────────────────────────────────────────────────────
function withAlpha(hex: string, a: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

function ChipPill({ kind }: { kind: 'sub' | 'api' | 'setup' }) {
  const styles = {
    sub:   { label: 'SUBSCRIPTION', bg: 'rgba(34,197,94,0.10)',  bd: 'rgba(34,197,94,0.22)',  fg: '#4ade80' },
    api:   { label: 'API KEY',      bg: 'rgba(34,197,94,0.10)',  bd: 'rgba(34,197,94,0.22)',  fg: '#4ade80' },
    setup: { label: 'NOT SET UP',   bg: 'rgba(108,99,255,0.10)', bd: 'rgba(108,99,255,0.22)', fg: '#a8a3ff' },
  }[kind]
  return (
    <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 text-[9px] font-mono tracking-[0.12em]"
      style={{ background: styles.bg, border: `1px solid ${styles.bd}`, borderRadius: '999px', color: styles.fg }}>
      <span className="w-1 h-1 rounded-full" style={{ background: styles.fg }} />
      {styles.label}
    </span>
  )
}

// ── CardHeader ─────────────────────────────────────────────────────────────
export function CardHeader({ provider, Icon, connected, subActive, apiActive, modelCount }: {
  provider: AiProvider
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>
  connected: boolean
  subActive: boolean
  apiActive: boolean
  modelCount: number
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        style={{
          background: connected
            ? `linear-gradient(135deg, ${withAlpha(provider.accent, 0.30)}, ${withAlpha(provider.accent, 0.06)})`
            : 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))',
          border: connected ? `1px solid ${withAlpha(provider.accent, 0.30)}` : '1px solid rgba(108,99,255,0.20)',
          boxShadow: '0 1px 0 0 rgba(255,255,255,0.06) inset',
        }}>
        <Icon size={18} style={{ color: connected ? provider.accent : '#a8a3ff' }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{provider.name}</span>
          {subActive && <ChipPill kind="sub" />}
          {apiActive && <ChipPill kind="api" />}
          {!connected && <ChipPill kind="setup" />}
        </div>
        <p className="text-[11px] mt-1 leading-snug" style={{ color: '#9090b0' }}>{provider.tagline}</p>
      </div>
      <div className="shrink-0 text-right text-[10px] font-mono uppercase tracking-wider" style={{ color: '#55556a' }}>
        <span style={{ color: '#a8a3ff' }}>{modelCount}</span>
        <br/>
        <span>{modelCount === 1 ? 'model' : 'models'}</span>
      </div>
    </div>
  )
}

// ── ModeTabs ──────────────────────────────────────────────────────────────
export function ModeTabs({ canSub, canApi, mode, onChange, subActive, apiActive }: {
  canSub: boolean; canApi: boolean
  mode: 'subscription' | 'api'
  onChange: (m: 'subscription' | 'api') => void
  subActive: boolean; apiActive: boolean
}) {
  if (!canSub || !canApi) return null
  const Tab = ({ active, hasDot, onClick, label }: { active: boolean; hasDot: boolean; onClick: () => void; label: string }) => (
    <button type="button" onClick={onClick}
      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium"
      style={{
        borderRadius: '8px',
        background:   active ? 'linear-gradient(135deg, rgba(108,99,255,0.25), rgba(108,99,255,0.06))' : 'transparent',
        border:       active ? '1px solid rgba(108,99,255,0.30)' : '1px solid transparent',
        color:        active ? '#e8e8f0' : '#9090b0',
      }}>
      <span>{label}</span>
      {hasDot && <span className="w-1 h-1 rounded-full" style={{ background: '#4ade80', boxShadow: '0 0 6px rgba(74,222,128,0.7)' }} />}
    </button>
  )
  return (
    <div className="flex gap-0.5 p-0.5"
      style={{ background: 'rgba(0,0,0,0.20)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px' }}>
      {/* eslint-disable-next-line react-hooks/static-components -- Tab is a small render-local presentational helper closing over this component's props */}
      <Tab active={mode === 'subscription'} hasDot={subActive} onClick={() => onChange('subscription')} label="Subscription" />
      {/* eslint-disable-next-line react-hooks/static-components -- Tab is a small render-local presentational helper closing over this component's props */}
      <Tab active={mode === 'api'}          hasDot={apiActive} onClick={() => onChange('api')}          label="API key" />
    </div>
  )
}

// ── SubscriptionBody / ApiKeyBody / CardFooter live in AiProviderCardBody.tsx
export { SubscriptionBody, ApiKeyBody, CardFooter } from './AiProviderCardBody'

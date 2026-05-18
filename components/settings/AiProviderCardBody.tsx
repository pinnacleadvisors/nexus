'use client'

/**
 * AiProviderCard body sections — subscription panel, API key panel, footer.
 * Split out from AiProviderCardSections.tsx to satisfy the 300-line/10 KB
 * write-size cap. Same liquid-glass conventions as AccountList.tsx.
 */

import {
  CheckCircle2, Loader2, Power, ExternalLink, KeyRound, AlertCircle, Server,
} from 'lucide-react'
import type { AiProvider } from '@/lib/ai/providers'
import type { ModelDefinition } from '@/lib/models/types'
import type { AiProviderConnection } from './AiProviderCard'

export function SubscriptionBody({ provider, active, detail }: {
  provider: AiProvider
  active:   boolean
  detail?:  string
}) {
  const sub = provider.subscription!
  return (
    <div className="flex flex-col gap-2.5 text-[12px]" style={{ color: '#c0c0d0' }}>
      <p className="leading-relaxed" style={{ color: '#9090b0' }}>{sub.instructions}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {sub.envVars.map(v => (
          <code key={v} className="px-1.5 py-0.5 rounded font-mono text-[10px]"
            style={{ background: 'rgba(108,99,255,0.10)', color: '#a8a3ff', border: '1px solid rgba(108,99,255,0.20)' }}>
            {v}
          </code>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="text-[11px] flex items-center gap-1.5" style={{ color: active ? '#4ade80' : '#9090b0' }}>
          {active ? <CheckCircle2 size={12} /> : <Server size={12} />}
          <span>{active ? (detail ?? 'Gateway healthy — plan-billed') : 'Not configured'}</span>
        </div>
        {sub.setupUrl && (
          <a href={sub.setupUrl} className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#a8a3ff' }}>
            Set up <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  )
}

export function ApiKeyBody(props: {
  provider:   AiProvider
  active:     boolean
  showRotate: boolean
  apiKey:     string
  busy:       boolean
  saved:      boolean
  err:        string | null
  onChange:   (v: string) => void
  onSave:     () => void
  onRotate:   () => void
  onCancel:   () => void
  onRevoke:   () => void
  connectionDetail: AiProviderConnection['apiKey']
}) {
  const { provider, active, showRotate, apiKey, busy, saved, err,
    onChange, onSave, onRotate, onCancel, onRevoke, connectionDetail } = props
  const api = provider.api!
  return (
    <div className="flex flex-col gap-2 text-[12px]" style={{ color: '#c0c0d0' }}>
      {api.instructions && <p className="leading-snug" style={{ color: '#9090b0' }}>{api.instructions}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <code className="px-1.5 py-0.5 rounded font-mono text-[10px]"
          style={{ background: 'rgba(108,99,255,0.10)', color: '#a8a3ff', border: '1px solid rgba(108,99,255,0.20)' }}>
          {api.envVar}
        </code>
      </div>
      {active && !showRotate && connectionDetail && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="text-[11px] flex items-center gap-1.5" style={{ color: '#4ade80' }}>
            <KeyRound size={12} />
            <span>
              Saved <span style={{ color: '#9090b0' }}>· {connectionDetail.businessSlug ?? 'shared'} · </span>
              <span style={{ color: '#9090b0' }}>{new Date(connectionDetail.createdAt).toLocaleDateString()}</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={onRotate} className="text-[11px] px-2 py-1 rounded-md"
              style={{ color: '#e8e8f0', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              Rotate
            </button>
            <button type="button" onClick={onRevoke} disabled={busy}
              className="text-[11px] flex items-center px-1.5 py-1 rounded-md disabled:opacity-50"
              style={{ color: '#e8e8f0', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
            </button>
          </div>
        </div>
      )}
      {showRotate && (
        <div className="flex items-stretch gap-2">
          <input
            type="password" autoComplete="off" spellCheck={false}
            value={apiKey}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSave() } }}
            placeholder={`paste ${active ? 'new ' : ''}${provider.name.toLowerCase()} key`}
            disabled={busy}
            className="flex-1 rounded-lg px-2.5 py-1.5 text-xs font-mono"
            style={{ background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0', outline: 'none' }}
          />
          <button type="button" onClick={onSave} disabled={busy || !apiKey.trim()}
            className="text-[11px] px-3 rounded-lg font-medium disabled:opacity-50"
            style={{
              background: saved
                ? 'linear-gradient(135deg, rgba(34,197,94,0.22), rgba(34,197,94,0.06))'
                : 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.10))',
              color:      '#e8e8f0',
              border:     saved ? '1px solid rgba(34,197,94,0.30)' : '1px solid rgba(108,99,255,0.30)',
            }}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : saved ? 'Saved' : active ? 'Rotate' : 'Save'}
          </button>
          {active && (
            <button type="button" onClick={onCancel} className="text-[11px] px-2 rounded-lg"
              style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              Cancel
            </button>
          )}
        </div>
      )}
      {api.credentialsUrl && !active && (
        <a href={api.credentialsUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px]" style={{ color: '#a8a3ff' }}>
          Where to get this <ExternalLink size={10} />
        </a>
      )}
      {err && (
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: '#f87171' }}>
          <AlertCircle size={11} /> <span>{err}</span>
        </div>
      )}
    </div>
  )
}

export function CardFooter({ provider, models }: { provider: AiProvider; models: ModelDefinition[] }) {
  return (
    <div className="pt-2 border-t flex items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-wider"
      style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="flex flex-wrap gap-1 min-w-0">
        {models.slice(0, 3).map(m => (
          <span key={m.id} className="px-1.5 py-0.5 rounded truncate"
            style={{ background: 'rgba(255,255,255,0.04)', color: '#9090b0', border: '1px solid rgba(255,255,255,0.06)', maxWidth: '160px' }}
            title={m.tagline}>
            {m.name}
          </span>
        ))}
        {models.length > 3 && <span style={{ color: '#55556a' }}>+ {models.length - 3} more</span>}
      </div>
      <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 shrink-0" style={{ color: '#a8a3ff' }}>
        Docs <ExternalLink size={9} />
      </a>
    </div>
  )
}

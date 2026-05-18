'use client'

/**
 * Header + banner subcomponents for AgentList. Split out to satisfy the
 * write-size discipline (300 lines / 10 KB cap). Same liquid-glass
 * aesthetic as the rest of /settings.
 */

import { AlertCircle, Lightbulb, Loader2, Sparkles, X } from 'lucide-react'

export function AgentdexHeader({ agentCount, skillsCount, providers, availableCount, busy, onRecommendAll }: {
  agentCount: number
  skillsCount: number
  providers: string[]
  availableCount: number
  busy: boolean
  onRecommendAll: () => void
}) {
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
          <Sparkles size={13} style={{ color: '#a8a3ff' }} />
        </div>
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wider" style={{ color: '#9090b0' }}>Agentdex</p>
          <p className="text-xs" style={{ color: '#e8e8f0' }}>
            {agentCount} {agentCount === 1 ? 'agent' : 'agents'} ·{' '}
            <span style={{ color: '#a8a3ff' }}>{skillsCount}</span> distinct skills ·{' '}
            <span style={{ color: '#a8a3ff' }}>{availableCount}</span> models across {providers.length}{' '}
            {providers.length === 1 ? 'provider' : 'providers'}
          </p>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onRecommendAll}
          disabled={busy || agentCount === 0 || providers.length === 0}
          className="text-[12px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
          style={{
            background:   'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.10))',
            border:       '1px solid rgba(108,99,255,0.30)',
            color:        '#e8e8f0',
            boxShadow:    '0 1px 0 0 rgba(255,255,255,0.06) inset',
          }}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Lightbulb size={12} />}
          Recommend models for all
        </button>
      </div>
    </div>
  )
}

export function AgentdexBanner({ kind, children, onDismiss }: {
  kind: 'error' | 'warn'
  children: React.ReactNode
  onDismiss?: () => void
}) {
  const c = kind === 'error'
    ? { bg: 'rgba(239,68,68,0.10)',  bd: 'rgba(239,68,68,0.22)',  fg: '#f87171' }
    : { bg: 'rgba(251,191,36,0.10)', bd: 'rgba(251,191,36,0.22)', fg: '#fbbf24' }
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-2.5 text-sm"
      style={{
        background:           `linear-gradient(135deg, ${c.bg}, rgba(255,255,255,0.02))`,
        backdropFilter:       'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border:               `1px solid ${c.bd}`,
        borderRadius:         '14px',
        color:                '#e8e8f0',
      }}>
      <AlertCircle size={16} style={{ color: c.fg }} />
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="p-0.5">
          <X size={14} style={{ color: '#9090b0' }} />
        </button>
      )}
    </div>
  )
}

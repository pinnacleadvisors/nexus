'use client'

/**
 * Shared presentational bits for the /settings/loops UI family.
 * Matches the existing settings aesthetic (dark glass, accent #6c63ff).
 */

import type { CSSProperties } from 'react'
import type { LoopStatus, LoopMode, LoopIterationOutcome } from '@/lib/loops/types'

export const ACCENT = '#6c63ff'
export const ACCENT_SOFT = '#a8a3ff'
export const FG = '#e8e8f0'
export const MUTED = '#9090b0'

export const panelStyle: CSSProperties = {
  background:           'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
  backdropFilter:       'blur(20px) saturate(160%)',
  WebkitBackdropFilter: 'blur(20px) saturate(160%)',
  border:               '1px solid rgba(255,255,255,0.08)',
  borderRadius:         '14px',
  boxShadow:            '0 1px 0 0 rgba(255,255,255,0.04) inset',
}

export const pageBgStyle: CSSProperties = {
  backgroundColor: '#050508',
  backgroundImage:
    'radial-gradient(1200px 600px at 10% -10%, rgba(108,99,255,0.10), transparent 60%), ' +
    'radial-gradient(900px 500px at 100% 100%, rgba(108,99,255,0.06), transparent 60%)',
}

const STATUS_COLORS: Record<LoopStatus, { fg: string; bg: string; border: string }> = {
  active: { fg: '#86efac', bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.30)' },
  paused: { fg: '#fcd34d', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.30)' },
  done:   { fg: ACCENT_SOFT, bg: 'rgba(108,99,255,0.14)', border: 'rgba(108,99,255,0.30)' },
  killed: { fg: '#fca5a5', bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.30)' },
}

export function StatusPill({ status }: { status: LoopStatus }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.done
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide"
      style={{ color: c.fg, background: c.bg, border: `1px solid ${c.border}` }}
    >
      {status}
    </span>
  )
}

export function ModeBadge({ mode }: { mode: LoopMode }) {
  const synth = mode === 'synthesize'
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{
        color: synth ? '#7dd3fc' : MUTED,
        background: synth ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${synth ? 'rgba(56,189,248,0.30)' : 'rgba(255,255,255,0.10)'}`,
      }}
    >
      {mode}
    </span>
  )
}

const OUTCOME_COLORS: Record<LoopIterationOutcome, string> = {
  running:   '#fcd34d',
  success:   '#86efac',
  partial:   '#7dd3fc',
  error:     '#fca5a5',
  cancelled: MUTED,
}

export function OutcomePill({ outcome }: { outcome: LoopIterationOutcome }) {
  const color = OUTCOME_COLORS[outcome] ?? MUTED
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {outcome}
    </span>
  )
}

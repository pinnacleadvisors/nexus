'use client'

import { type CSSProperties } from 'react'
import { Loader2, AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react'
import type { OrgAgent } from '@/lib/org/types'
import { LAYER_META, STATUS_META } from '@/lib/org/types'

interface Props {
  agent:    OrgAgent
  selected: boolean
  onSelect: (agent: OrgAgent) => void
  compact?: boolean
}

const STATUS_ICON: Record<string, React.ComponentType<{ size?: number; className?: string; style?: CSSProperties }>> = {
  running:    Loader2 as React.ComponentType<{ size?: number; className?: string; style?: CSSProperties }>,
  error:      AlertCircle as React.ComponentType<{ size?: number; className?: string; style?: CSSProperties }>,
  completed:  CheckCircle2 as React.ComponentType<{ size?: number; className?: string; style?: CSSProperties }>,
  idle:       Clock as React.ComponentType<{ size?: number; className?: string; style?: CSSProperties }>,
  terminated: XCircle as React.ComponentType<{ size?: number; className?: string; style?: CSSProperties }>,
}

export default function OrgNode({ agent, selected, onSelect, compact = false }: Props) {
  const layer  = LAYER_META[agent.layer]
  const status = STATUS_META[agent.status]
  const Icon   = STATUS_ICON[agent.status] ?? Clock

  if (compact) {
    return (
      <button
        onClick={() => onSelect(agent)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all"
        style={{
          backgroundColor: selected ? layer.bg : 'transparent',
          border: `1px solid ${selected ? layer.color : '#24243e'}`,
          color: '#e8e8f0',
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: status.color }}
        />
        <span className="truncate max-w-[100px]">{agent.name}</span>
      </button>
    )
  }

  return (
    <button
      onClick={() => onSelect(agent)}
      className="group relative flex flex-col gap-2 rounded-xl p-3 text-left transition-all min-w-[160px]"
      style={{
        backgroundColor: selected ? layer.bg : '#0d0d14',
        border: `1px solid ${selected ? layer.color : '#24243e'}`,
        boxShadow: selected ? `0 0 12px ${layer.color}30` : 'none',
      }}
    >
      {/* Header: layer badge + status icon */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-xs px-1.5 py-0.5 rounded font-medium"
          style={{ backgroundColor: layer.bg, color: layer.color, border: `1px solid ${layer.color}30` }}
        >
          {layer.shortLabel}
        </span>
        <Icon
          size={12}
          className={agent.status === 'running' ? 'animate-spin' : ''}
          style={{ color: status.color }}
        />
      </div>

      {/* Name */}
      <div>
        <p className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
          {agent.name}
        </p>
        <p className="text-xs truncate mt-0.5" style={{ color: '#55556a' }}>
          {agent.role}
        </p>
      </div>

      {/* Current task */}
      {agent.current_task && (
        <p
          className="text-xs leading-relaxed line-clamp-2"
          style={{ color: '#9090b0' }}
        >
          {agent.current_task}
        </p>
      )}

      {/* Footer stats */}
      <div
        className="flex items-center justify-between text-xs pt-1"
        style={{ borderTop: '1px solid #1a1a2e', color: '#55556a' }}
      >
        <span>{agent.tasks_completed} tasks</span>
        <span>{(agent.tokens_used / 1000).toFixed(1)}k tok</span>
      </div>

      {/* Error pulse ring */}
      {agent.status === 'error' && (
        <span
          className="absolute inset-0 rounded-xl animate-ping opacity-20 pointer-events-none"
          style={{ backgroundColor: '#f87171' }}
        />
      )}
    </button>
  )
}

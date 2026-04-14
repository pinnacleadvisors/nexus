'use client'

import { X, Cpu, Clock, DollarSign, CheckSquare, Loader2, AlertCircle, XCircle } from 'lucide-react'
import type { OrgAgent } from '@/lib/org/types'
import { LAYER_META, STATUS_META } from '@/lib/org/types'

interface Props {
  agent:   OrgAgent
  onClose: () => void
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5" style={{ borderBottom: '1px solid #1a1a2e' }}>
      <span className="text-xs shrink-0" style={{ color: '#55556a' }}>{label}</span>
      <span className="text-xs text-right" style={{ color: '#9090b0' }}>{value}</span>
    </div>
  )
}

export default function DrillDownPanel({ agent, onClose }: Props) {
  const layer  = LAYER_META[agent.layer]
  const status = STATUS_META[agent.status]

  const statusLabel = agent.status.charAt(0).toUpperCase() + agent.status.slice(1)
  const lastActive  = agent.last_active_at
    ? new Date(agent.last_active_at).toLocaleString()
    : 'Never'
  const createdAt = new Date(agent.created_at).toLocaleDateString()

  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: '#0d0d14', borderLeft: '1px solid #24243e' }}
    >
      {/* Header */}
      <div
        className="flex items-start justify-between gap-3 px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid #24243e' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-xs px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: layer.bg, color: layer.color }}
            >
              {layer.shortLabel} · {layer.label}
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ backgroundColor: status.bg, color: status.color }}
            >
              {statusLabel}
            </span>
          </div>
          <h3 className="text-sm font-bold mt-1.5" style={{ color: '#e8e8f0' }}>
            {agent.name}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: '#55556a' }}>
            {agent.role}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[#1a1a2e] transition-colors shrink-0"
          style={{ color: '#55556a' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

        {/* Current task */}
        {agent.current_task && (
          <div
            className="rounded-lg p-3"
            style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              {agent.status === 'running' ? (
                <Loader2 size={11} className="animate-spin" style={{ color: '#4ade80' }} />
              ) : agent.status === 'error' ? (
                <AlertCircle size={11} style={{ color: '#f87171' }} />
              ) : (
                <Clock size={11} style={{ color: '#55556a' }} />
              )}
              <span className="text-xs font-medium" style={{ color: '#9090b0' }}>
                Current Task
              </span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: '#e8e8f0' }}>
              {agent.current_task}
            </p>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { Icon: CheckSquare, label: 'Tasks done', value: agent.tasks_completed.toString(), color: '#818cf8' },
            { Icon: Cpu,         label: 'Tokens used', value: `${(agent.tokens_used / 1000).toFixed(1)}k`, color: '#22d3ee' },
            { Icon: DollarSign,  label: 'Cost (USD)',  value: `$${agent.cost_usd.toFixed(4)}`,  color: '#4ade80' },
            { Icon: Loader2,     label: 'Model',       value: agent.model.replace('claude-', '').replace('-4-6', '').replace('-4-5-20251001', ''), color: '#f59e0b' },
          ].map(({ Icon, label, value, color }) => (
            <div
              key={label}
              className="rounded-lg p-2.5"
              style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
            >
              <Icon size={12} style={{ color }} />
              <p className="text-xs mt-1 font-semibold" style={{ color: '#e8e8f0' }}>{value}</p>
              <p className="text-xs" style={{ color: '#55556a' }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Meta */}
        <div>
          <p className="text-xs font-medium mb-1" style={{ color: '#55556a' }}>Details</p>
          <MetaRow label="Layer"       value={`${layer.shortLabel} — ${layer.description}`} />
          <MetaRow label="Swarm"       value={agent.swarm_id ?? '—'} />
          <MetaRow label="Last active" value={lastActive} />
          <MetaRow label="Created"     value={createdAt} />
          {agent.parent_agent_id && (
            <MetaRow label="Spawned by" value={agent.parent_agent_id} />
          )}
        </div>

        {/* Recent actions */}
        {(agent.recent_actions?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: '#55556a' }}>
              Last {agent.recent_actions!.length} actions
            </p>
            <div className="space-y-1.5">
              {agent.recent_actions!.map(action => (
                <div
                  key={action.id}
                  className="flex items-start gap-2 rounded-lg px-2.5 py-2"
                  style={{ backgroundColor: '#12121e', border: '1px solid #1a1a2e' }}
                >
                  <span
                    className="shrink-0 mt-0.5 text-xs px-1.5 rounded font-mono"
                    style={{
                      backgroundColor: action.action === 'error' ? '#2e1a1a' : '#1a1a2e',
                      color: action.action === 'error' ? '#f87171' : '#818cf8',
                    }}
                  >
                    {action.action}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-snug" style={{ color: '#9090b0' }}>
                      {action.description ?? '—'}
                    </p>
                    {action.tokens_used > 0 && (
                      <p className="text-xs mt-0.5" style={{ color: '#55556a' }}>
                        {action.tokens_used} tokens
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Terminate button */}
        {(agent.status === 'running' || agent.status === 'idle') && agent.layer > 0 && (
          <button
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors mt-2"
            style={{ backgroundColor: '#2e1a1a', color: '#f87171', border: '1px solid #3e2a2a' }}
            onClick={() => {
              // In production: PATCH /api/agents/:id { status: 'terminated' }
              console.log('Terminate:', agent.id)
            }}
          >
            <XCircle size={12} />
            Terminate Agent
          </button>
        )}
      </div>
    </div>
  )
}

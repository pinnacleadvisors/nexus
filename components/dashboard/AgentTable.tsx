'use client'

import { formatDistanceToNow } from 'date-fns'
import type { AgentRow } from '@/lib/types'

const STATUS_STYLE: Record<AgentRow['status'], { dot: string; label: string; text: string }> = {
  active: { dot: '#22c55e', label: 'Active', text: '#22c55e' },
  idle:   { dot: '#f59e0b', label: 'Idle',   text: '#f59e0b' },
  error:  { dot: '#ef4444', label: 'Error',  text: '#ef4444' },
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

interface Props {
  agents: AgentRow[]
}

export default function AgentTable({ agents }: Props) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
    >
      <div className="px-4 py-3" style={{ borderBottom: '1px solid #24243e' }}>
        <h2 className="font-semibold" style={{ color: '#e8e8f0' }}>
          Agent Performance
        </h2>
      </div>

      {/* ── Desktop table ────────────────────────────────────────────────── */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid #1a1a2e' }}>
              {['Agent', 'Status', 'Tasks', 'Tokens', 'Cost', 'Errors', 'Last Active'].map(h => (
                <th
                  key={h}
                  className="text-left px-4 py-2.5 text-xs font-medium"
                  style={{ color: '#55556a' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((agent, i) => {
              const s = STATUS_STYLE[agent.status]
              return (
                <tr
                  key={agent.id}
                  style={{ borderBottom: i < agents.length - 1 ? '1px solid #1a1a2e' : 'none' }}
                  onMouseEnter={e =>
                    ((e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#1a1a2e')
                  }
                  onMouseLeave={e =>
                    ((e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent')
                  }
                >
                  <td className="px-4 py-3 font-medium" style={{ color: '#e8e8f0' }}>
                    {agent.name}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: s.dot }}
                      />
                      <span style={{ color: s.text }}>{s.label}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3" style={{ color: '#e8e8f0' }}>
                    {agent.tasksCompleted}
                  </td>
                  <td className="px-4 py-3" style={{ color: '#9090b0' }}>
                    {formatTokens(agent.tokensUsed)}
                  </td>
                  <td className="px-4 py-3" style={{ color: '#ef4444' }}>
                    ${agent.costUsd.toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    {(agent.errorCount ?? 0) > 0 ? (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: '#2e0d0d', color: '#ef4444', border: '1px solid #ef444433' }}
                      >
                        {agent.errorCount}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: '#55556a' }}>—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#55556a' }}>
                    {formatDistanceToNow(new Date(agent.lastActive), { addSuffix: true })}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile card list ─────────────────────────────────────────────── */}
      <div className="sm:hidden divide-y" style={{ borderColor: '#1a1a2e' }}>
        {agents.map(agent => {
          const s = STATUS_STYLE[agent.status]
          return (
            <div key={agent.id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm" style={{ color: '#e8e8f0' }}>
                  {agent.name}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.dot }} />
                  <span className="text-xs" style={{ color: s.text }}>{s.label}</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs" style={{ color: '#9090b0' }}>
                <span>{agent.tasksCompleted} tasks</span>
                <span>{formatTokens(agent.tokensUsed)} tokens</span>
                <span style={{ color: '#ef4444' }}>${agent.costUsd.toFixed(2)}</span>
                {(agent.errorCount ?? 0) > 0 && (
                  <span style={{ color: '#ef4444' }}>{agent.errorCount} err</span>
                )}
              </div>
              <p className="text-xs" style={{ color: '#55556a' }}>
                {formatDistanceToNow(new Date(agent.lastActive), { addSuffix: true })}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

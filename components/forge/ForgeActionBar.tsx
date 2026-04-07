'use client'

import { Zap, Minus, Plus, DollarSign } from 'lucide-react'

interface Props {
  agentCount: number
  setAgentCount: (n: number) => void
  onLaunch: () => void
  milestonesReady: boolean
  showGantt: boolean
}

export default function ForgeActionBar({
  agentCount,
  setAgentCount,
  onLaunch,
  milestonesReady,
  showGantt,
}: Props) {
  const estimatedCost = agentCount * 500

  return (
    <div
      className="shrink-0 flex items-center justify-between gap-4 px-4 py-3"
      style={{ borderTop: '1px solid #24243e', backgroundColor: '#0d0d14' }}
    >
      {/* Agent count */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium" style={{ color: '#9090b0' }}>
          Agents
        </span>
        <div
          className="flex items-center gap-2 rounded-lg px-2 py-1"
          style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
        >
          <button
            onClick={() => setAgentCount(Math.max(1, agentCount - 1))}
            className="w-5 h-5 flex items-center justify-center rounded transition-colors"
            style={{ color: '#9090b0' }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#e8e8f0')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#9090b0')}
          >
            <Minus size={12} />
          </button>
          <span className="w-5 text-center text-sm font-semibold" style={{ color: '#e8e8f0' }}>
            {agentCount}
          </span>
          <button
            onClick={() => setAgentCount(Math.min(10, agentCount + 1))}
            className="w-5 h-5 flex items-center justify-center rounded transition-colors"
            style={{ color: '#9090b0' }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#e8e8f0')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#9090b0')}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Budget estimate */}
      <div className="flex items-center gap-1.5">
        <DollarSign size={13} style={{ color: '#22c55e' }} />
        <span className="text-xs" style={{ color: '#9090b0' }}>
          Est. budget:
        </span>
        <span className="text-xs font-semibold" style={{ color: '#22c55e' }}>
          ~${estimatedCost.toLocaleString()} / mo
        </span>
      </div>

      {/* Launch / Gantt toggle */}
      <button
        onClick={onLaunch}
        disabled={!milestonesReady}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
        style={
          milestonesReady
            ? {
                background: showGantt
                  ? 'transparent'
                  : 'linear-gradient(135deg, #6c63ff, #4c45cc)',
                color: showGantt ? '#6c63ff' : '#fff',
                border: showGantt ? '1px solid #6c63ff' : 'none',
                cursor: 'pointer',
              }
            : {
                backgroundColor: '#1a1a2e',
                color: '#55556a',
                border: '1px solid #24243e',
                cursor: 'not-allowed',
              }
        }
      >
        <Zap size={14} />
        {showGantt ? 'Back to Timeline' : 'Launch Agents'}
      </button>
    </div>
  )
}

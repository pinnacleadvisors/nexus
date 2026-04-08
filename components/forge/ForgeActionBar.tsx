'use client'

import { useState } from 'react'
import { Zap, Minus, Plus, DollarSign, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import type { Milestone, ClawConfig } from '@/lib/types'

const STORAGE_KEY = 'nexus_claw_config'

function loadClawConfig(): ClawConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ClawConfig) : null
  } catch {
    return null
  }
}

type DispatchStatus = 'idle' | 'loading' | 'success' | 'error'

interface Props {
  agentCount: number
  setAgentCount: (n: number) => void
  onLaunch: () => void
  milestonesReady: boolean
  showGantt: boolean
  milestones?: Milestone[]
}

export default function ForgeActionBar({
  agentCount,
  setAgentCount,
  onLaunch,
  milestonesReady,
  showGantt,
  milestones = [],
}: Props) {
  const estimatedCost = agentCount * 500
  const [dispatchStatus, setDispatchStatus] = useState<DispatchStatus>('idle')

  async function handleDispatch() {
    const cfg = loadClawConfig()
    if (!cfg) {
      window.location.href = '/tools/claw'
      return
    }

    setDispatchStatus('loading')

    const milestoneList = milestones
      .map(m => `  • [Phase ${m.phase}] ${m.title}: ${m.description}${m.targetDate ? ` (target: ${m.targetDate})` : ''}`)
      .join('\n')

    const message = `You have been dispatched a new business project from Nexus.\n\nProject milestones:\n${milestoneList}\n\nPlease begin executing Phase 1 milestones. Use your available skills to complete each task autonomously and report progress when done.`

    try {
      const res = await fetch('/api/claw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'agent',
          gatewayUrl: cfg.gatewayUrl,
          hookToken: cfg.hookToken,
          payload: {
            message,
            name: 'Nexus Forge',
            wakeMode: 'now',
          },
        }),
      })

      if (res.ok) {
        setDispatchStatus('success')
        setTimeout(() => setDispatchStatus('idle'), 4000)
      } else {
        setDispatchStatus('error')
        setTimeout(() => setDispatchStatus('idle'), 4000)
      }
    } catch {
      setDispatchStatus('error')
      setTimeout(() => setDispatchStatus('idle'), 4000)
    }
  }

  const clawLabel = {
    idle: 'Dispatch to OpenClaw',
    loading: 'Dispatching…',
    success: 'Dispatched!',
    error: 'Dispatch failed',
  }[dispatchStatus]

  const clawIcon = {
    idle: null,
    loading: <Loader2 size={13} className="animate-spin" />,
    success: <CheckCircle2 size={13} />,
    error: <AlertCircle size={13} />,
  }[dispatchStatus]

  const clawColor = {
    idle: '#6c63ff',
    loading: '#55556a',
    success: '#22c55e',
    error: '#ef4444',
  }[dispatchStatus]

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

      {/* Right side buttons */}
      <div className="flex items-center gap-2">
        {/* Dispatch to OpenClaw */}
        <button
          onClick={handleDispatch}
          disabled={!milestonesReady || dispatchStatus === 'loading'}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
          style={
            milestonesReady && dispatchStatus !== 'loading'
              ? {
                  backgroundColor: '#1a1a2e',
                  color: clawColor,
                  border: `1px solid ${clawColor}33`,
                  cursor: 'pointer',
                }
              : {
                  backgroundColor: '#1a1a2e',
                  color: '#55556a',
                  border: '1px solid #24243e',
                  cursor: milestonesReady ? 'default' : 'not-allowed',
                }
          }
        >
          {clawIcon}
          {clawLabel}
        </button>

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
    </div>
  )
}

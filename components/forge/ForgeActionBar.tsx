'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Minus, Plus, DollarSign, Loader2, CheckCircle2, AlertCircle, FileDown, GitBranch } from 'lucide-react'
import type { Milestone, Run } from '@/lib/types'

type DispatchStatus = 'idle' | 'loading' | 'success' | 'error'
type BuildStatus    = 'idle' | 'loading' | 'success' | 'error'

// Per-phase dispatch result shown in tooltip
interface PhaseResult { phase: number; ok: boolean }

interface Props {
  agentCount: number
  setAgentCount: (n: number) => void
  onLaunch: () => void
  milestonesReady: boolean
  showGantt: boolean
  milestones?: Milestone[]
  projectName?: string
  projectId?: string
  /** Optional upstream idea reference (e.g. from /idea). Falls back to projectId. */
  ideaId?: string
  onExportPdf?: () => void
}

export default function ForgeActionBar({
  agentCount,
  setAgentCount,
  onLaunch,
  milestonesReady,
  showGantt,
  milestones = [],
  projectName = 'Nexus Project',
  projectId,
  ideaId,
  onExportPdf,
}: Props) {
  const router = useRouter()
  const estimatedCost = agentCount * 500
  const [dispatchStatus,  setDispatchStatus]  = useState<DispatchStatus>('idle')
  const [phaseResults,    setPhaseResults]    = useState<PhaseResult[]>([])
  const [multiAgent,      setMultiAgent]      = useState(false) // toggle single vs multi
  const [buildStatus,     setBuildStatus]     = useState<BuildStatus>('idle')
  const [buildError,      setBuildError]      = useState<string | null>(null)

  // Group milestones by phase
  function groupByPhase(ms: Milestone[]) {
    const map = new Map<number, Milestone[]>()
    for (const m of ms) {
      if (!map.has(m.phase)) map.set(m.phase, [])
      map.get(m.phase)!.push(m)
    }
    return [...map.entries()].map(([phase, items]) => ({ phase, milestones: items }))
  }

  async function handleDispatch() {
    setDispatchStatus('loading')
    setPhaseResults([])

    try {
      if (multiAgent && milestones.length > 0) {
        // ── Multi-agent: one session per phase ─────────────────────────────
        const phases = groupByPhase(milestones).map(p => ({
          phase:       p.phase,
          milestones:  p.milestones.map(m => ({ title: m.title, description: m.description, targetDate: m.targetDate })),
          projectName,
          projectId,
        }))

        const res = await fetch('/api/claw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'dispatch_phases', payload: { phases } }),
        })

        if (res.status === 401) { window.location.href = '/tools/claw'; return }

        if (res.ok) {
          const data = await res.json() as { phases?: Array<{ phase: number; ok: boolean }> }
          const results: PhaseResult[] = (data.phases ?? []).map(p => ({ phase: p.phase, ok: p.ok }))
          setPhaseResults(results)
          setDispatchStatus(results.every(r => r.ok) ? 'success' : 'error')
        } else {
          setDispatchStatus('error')
        }
      } else {
        // ── Single agent: all milestones in one message ────────────────────
        const milestoneList = milestones
          .map(m => `  • [Phase ${m.phase}] ${m.title}: ${m.description}${m.targetDate ? ` (target: ${m.targetDate})` : ''}`)
          .join('\n')

        const message = [
          `You have been dispatched a new business project from Nexus.`,
          `Project: ${projectName}`,
          ``,
          `Milestones:`,
          milestoneList,
          ``,
          `Begin executing Phase 1 milestones. Use your available skills autonomously and report progress when tasks are done.`,
        ].join('\n')

        const res = await fetch('/api/claw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'agent', payload: { message, name: 'Nexus Forge', wakeMode: 'now' } }),
        })

        if (res.status === 401) { window.location.href = '/tools/claw'; return }
        setDispatchStatus(res.ok ? 'success' : 'error')
      }

      setTimeout(() => { setDispatchStatus('idle'); setPhaseResults([]) }, 5000)
    } catch {
      setDispatchStatus('error')
      setTimeout(() => { setDispatchStatus('idle'); setPhaseResults([]) }, 5000)
    }
  }

  async function handleBuild() {
    setBuildStatus('loading')
    setBuildError(null)

    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ideaId:    ideaId ?? projectId,
          projectId: projectId,
        }),
      })

      if (res.status === 401) {
        window.location.href = '/'
        return
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setBuildError(body.error ?? `HTTP ${res.status}`)
        setBuildStatus('error')
        setTimeout(() => { setBuildStatus('idle'); setBuildError(null) }, 5000)
        return
      }

      const data = await res.json() as { run: Run }
      setBuildStatus('success')
      router.push(`/board?runId=${encodeURIComponent(data.run.id)}`)
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : 'Network error')
      setBuildStatus('error')
      setTimeout(() => { setBuildStatus('idle'); setBuildError(null) }, 5000)
    }
  }

  const uniquePhases = [...new Set(milestones.map(m => m.phase))].length

  const clawLabel = {
    idle:    multiAgent ? `Dispatch ${uniquePhases} Agents` : 'Dispatch to OpenClaw',
    loading: multiAgent ? 'Dispatching agents…' : 'Dispatching…',
    success: multiAgent ? 'Agents dispatched!' : 'Dispatched!',
    error:   'Dispatch failed',
  }[dispatchStatus]

  const clawIcon = {
    idle:    multiAgent ? <GitBranch size={13} /> : null,
    loading: <Loader2 size={13} className="animate-spin" />,
    success: <CheckCircle2 size={13} />,
    error:   <AlertCircle size={13} />,
  }[dispatchStatus]

  const clawColor = {
    idle:    '#6c63ff',
    loading: '#55556a',
    success: '#22c55e',
    error:   '#ef4444',
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
        {/* Export PDF */}
        {onExportPdf && (
          <button
            onClick={onExportPdf}
            disabled={!milestonesReady}
            title="Export business plan as PDF"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
            style={
              milestonesReady
                ? {
                    backgroundColor: '#1a1a2e',
                    color: '#9090b0',
                    border: '1px solid #24243e',
                    cursor: 'pointer',
                  }
                : {
                    backgroundColor: '#1a1a2e',
                    color: '#55556a',
                    border: '1px solid #24243e',
                    cursor: 'not-allowed',
                  }
            }
            onMouseEnter={e => {
              if (milestonesReady)
                (e.currentTarget as HTMLButtonElement).style.color = '#e8e8f0'
            }}
            onMouseLeave={e => {
              if (milestonesReady)
                (e.currentTarget as HTMLButtonElement).style.color = '#9090b0'
            }}
          >
            <FileDown size={13} />
            Export PDF
          </button>
        )}

        {/* Multi-agent toggle */}
        {milestonesReady && uniquePhases > 1 && (
          <button
            onClick={() => setMultiAgent(v => !v)}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg"
            style={
              multiAgent
                ? { backgroundColor: 'rgba(108,99,255,0.15)', color: '#6c63ff', border: '1px solid rgba(108,99,255,0.3)', cursor: 'pointer' }
                : { backgroundColor: '#12121e', color: '#55556a', border: '1px solid #24243e', cursor: 'pointer' }
            }
            title={multiAgent ? 'Switch to single-agent dispatch' : `Switch to multi-agent (${uniquePhases} phases)`}
          >
            <GitBranch size={11} />
            {multiAgent ? 'Multi' : 'Single'}
          </button>
        )}

        {/* Build this — create/resume a Run and navigate to the board */}
        <button
          onClick={handleBuild}
          disabled={!milestonesReady || buildStatus === 'loading'}
          title={
            buildError
              ? buildError
              : buildStatus === 'loading'
                ? 'Creating run…'
                : 'Create a Run for this idea and jump to the Board'
          }
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
          style={
            milestonesReady && buildStatus !== 'loading'
              ? { backgroundColor: '#1a1a2e', color: '#22c55e', border: '1px solid #22c55e33', cursor: 'pointer' }
              : { backgroundColor: '#1a1a2e', color: '#55556a', border: '1px solid #24243e', cursor: milestonesReady ? 'default' : 'not-allowed' }
          }
        >
          {buildStatus === 'loading'
            ? <Loader2 size={13} className="animate-spin" />
            : buildStatus === 'success'
              ? <CheckCircle2 size={13} />
              : buildStatus === 'error'
                ? <AlertCircle size={13} />
                : null}
          {buildStatus === 'loading' ? 'Building…'
            : buildStatus === 'success' ? 'Building!'
              : buildStatus === 'error' ? 'Build failed'
                : 'Build this'}
        </button>

        {/* Dispatch to OpenClaw */}
        <div className="relative">
          <button
            onClick={handleDispatch}
            disabled={!milestonesReady || dispatchStatus === 'loading'}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
            style={
              milestonesReady && dispatchStatus !== 'loading'
                ? { backgroundColor: '#1a1a2e', color: clawColor, border: `1px solid ${clawColor}33`, cursor: 'pointer' }
                : { backgroundColor: '#1a1a2e', color: '#55556a', border: '1px solid #24243e', cursor: milestonesReady ? 'default' : 'not-allowed' }
            }
          >
            {clawIcon}
            {clawLabel}
          </button>

          {/* Per-phase results tooltip */}
          {phaseResults.length > 0 && (
            <div
              className="absolute bottom-full mb-2 right-0 rounded-xl p-3 space-y-1.5 z-50 w-44"
              style={{ backgroundColor: '#12121e', border: '1px solid #24243e', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
            >
              <p className="text-xs font-semibold mb-2" style={{ color: '#9090b0' }}>Agent dispatch</p>
              {phaseResults.map(r => (
                <div key={r.phase} className="flex items-center justify-between text-xs">
                  <span style={{ color: '#9090b0' }}>Phase {r.phase}</span>
                  {r.ok
                    ? <span className="flex items-center gap-1" style={{ color: '#22c55e' }}><CheckCircle2 size={11} /> Sent</span>
                    : <span className="flex items-center gap-1" style={{ color: '#ef4444' }}><AlertCircle size={11} /> Failed</span>
                  }
                </div>
              ))}
            </div>
          )}
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
    </div>
  )
}

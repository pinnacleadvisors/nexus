'use client'

import { useState, useRef, useCallback } from 'react'
import {
  Network, Play, X, ChevronDown, ChevronRight,
  Loader2, Copy, Check, Crown, Users, Cpu,
  Activity, Brain, Zap, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ConsensusType, QueenType, SwarmEvent } from '@/lib/swarm/types'

// ── Types ──────────────────────────────────────────────────────────────────────
interface ParsedEvent {
  type:    string
  payload: Record<string, unknown>
  ts:      number
}

interface PhaseView {
  phase:  number
  title:  string
  tasks:  TaskView[]
  status: 'pending' | 'running' | 'completed' | 'failed'
}

interface TaskView {
  id:        string
  title:     string
  role:      string
  model:     string
  status:    'running' | 'approved' | 'rejected' | 'failed'
  tokens?:   number
  consensus?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────
const CONSENSUS_OPTIONS: Array<{ id: ConsensusType; label: string; desc: string }> = [
  { id: 'raft',   label: 'Raft',   desc: 'Simple majority — safe default' },
  { id: 'bft',    label: 'BFT',    desc: 'Strict 2/3 — for finance/legal' },
  { id: 'gossip', label: 'Gossip', desc: 'Fast accept — for content tasks' },
]

const QUEEN_OPTIONS: Array<{ id: QueenType; label: string; desc: string }> = [
  { id: 'strategic', label: 'Strategic', desc: 'Goal decomposition (recommended)' },
  { id: 'tactical',  label: 'Tactical',  desc: 'Rapid task assignment' },
  { id: 'adaptive',  label: 'Adaptive',  desc: 'Drift-resistant, self-correcting' },
]

const ROLE_COLORS: Record<string, string> = {
  researcher:        '#22d3ee',
  analyst:           '#60a5fa',
  strategist:        '#c084fc',
  coder:             '#4ade80',
  reviewer:          '#a3e635',
  tester:            '#86efac',
  architect:         '#818cf8',
  'security-auditor':'#f87171',
  marketer:          '#fb923c',
  copywriter:        '#fbbf24',
  'seo-specialist':  '#f9a8d4',
  'social-media':    '#c4b5fd',
  'email-specialist':'#fdba74',
  designer:          '#f472b6',
  'data-analyst':    '#67e8f9',
  'finance-analyst': '#fde047',
  'legal-advisor':   '#fca5a5',
  'customer-support':'#6ee7b7',
  devops:            '#5eead4',
  'product-manager': '#a5b4fc',
  'qa-engineer':     '#bbf7d0',
  'brand-strategist':'#ddd6fe',
}

// ── Event log row ─────────────────────────────────────────────────────────────
function EventRow({ event }: { event: ParsedEvent }) {
  const icons: Record<string, React.ReactNode> = {
    status:      <Activity size={12} />,
    plan:        <Brain size={12} />,
    phase_start: <Layers size={12} />,
    phase_end:   <Check size={12} />,
    task_start:  <Cpu size={12} />,
    task_end:    <Check size={12} />,
    consensus:   <Users size={12} />,
    drift:       <AlertTriangle size={12} />,
    error:       <AlertTriangle size={12} />,
    complete:    <Zap size={12} />,
  }

  const colors: Record<string, string> = {
    error:   '#f87171',
    drift:   '#fbbf24',
    complete:'#22c55e',
    consensus: event.payload.approved ? '#22c55e' : '#f87171',
  }

  const color = colors[event.type] ?? '#9090b0'

  const message = (() => {
    switch (event.type) {
      case 'status':     return String(event.payload.message ?? event.payload.status ?? 'status update')
      case 'plan':       return `Plan ready: ${event.payload.phaseCount} phases — ${event.payload.summary}`
      case 'phase_start':return `Phase ${event.payload.phase}: ${event.payload.title}`
      case 'phase_end':  return `Phase ${event.payload.phase} done — ${event.payload.approvedTasks}/${event.payload.totalTasks} tasks approved`
      case 'task_start': return `[${event.payload.role}] ${event.payload.title} (${event.payload.model})`
      case 'task_end':   return `Task ${event.payload.approved ? 'approved' : 'rejected'} — ${event.payload.tokensUsed ?? 0} tokens`
      case 'consensus':  return String(event.payload.summary ?? '')
      case 'drift':      return String(event.payload.message ?? 'Drift detected')
      case 'error':      return String(event.payload.message ?? 'Error')
      case 'complete':   return `Complete — ${event.payload.tasks} tasks, ${event.payload.totalTokens} tokens ($${event.payload.totalCostUsd})`
      default:           return JSON.stringify(event.payload).slice(0, 80)
    }
  })()

  return (
    <div className="flex items-start gap-2 py-1.5 border-b" style={{ borderColor: '#12121e' }}>
      <span style={{ color }} className="mt-0.5 shrink-0">{icons[event.type] ?? <Activity size={12} />}</span>
      <span className="text-xs font-mono leading-relaxed" style={{ color }}>
        [{new Date(event.ts).toLocaleTimeString()}] {message}
      </span>
    </div>
  )
}

function Layers({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <polygon points="12 2 2 7 12 12 22 7 12 2"/>
      <polyline points="2 17 12 22 22 17"/>
      <polyline points="2 12 12 17 22 12"/>
    </svg>
  )
}

// ── Phase card ────────────────────────────────────────────────────────────────
function PhaseCard({ phase }: { phase: PhaseView }) {
  const [expanded, setExpanded] = useState(true)
  const statusColors = { pending: '#55556a', running: '#6c63ff', completed: '#22c55e', failed: '#ef4444' }

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #24243e' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3"
        style={{ backgroundColor: '#0d0d14' }}
      >
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ backgroundColor: statusColors[phase.status] + '22', color: statusColors[phase.status] }}
        >
          {phase.phase}
        </div>
        <span className="text-sm font-semibold flex-1 text-left" style={{ color: '#e8e8f0' }}>
          {phase.title}
        </span>
        <span className="text-xs mr-2" style={{ color: statusColors[phase.status] }}>
          {phase.status}
        </span>
        {expanded ? <ChevronDown size={14} style={{ color: '#55556a' }} /> : <ChevronRight size={14} style={{ color: '#55556a' }} />}
      </button>

      {expanded && phase.tasks.length > 0 && (
        <div className="px-4 pb-3 space-y-2" style={{ backgroundColor: '#050508' }}>
          {phase.tasks.map(task => (
            <div
              key={task.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2"
              style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e' }}
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: ROLE_COLORS[task.role] ?? '#9090b0' }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: '#e8e8f0' }}>{task.title}</div>
                <div className="text-xs" style={{ color: '#55556a' }}>
                  {task.role} · {task.model?.split('-').slice(1, 3).join(' ')}
                  {task.tokens ? ` · ${task.tokens.toLocaleString()} tokens` : ''}
                </div>
              </div>
              {task.status === 'running' && <Loader2 size={12} className="animate-spin shrink-0" style={{ color: '#6c63ff' }} />}
              {task.status === 'approved' && <Check size={12} className="shrink-0" style={{ color: '#22c55e' }} />}
              {(task.status === 'rejected' || task.status === 'failed') && <X size={12} className="shrink-0" style={{ color: '#ef4444' }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SwarmPage() {
  const [goal,          setGoal]          = useState('')
  const [context,       setContext]       = useState('')
  const [queenType,     setQueenType]     = useState<QueenType>('strategic')
  const [consensusType, setConsensusType] = useState<ConsensusType>('raft')
  const [budgetUsd,     setBudgetUsd]     = useState('5.00')
  const [running,       setRunning]       = useState(false)
  const [events,        setEvents]        = useState<ParsedEvent[]>([])
  const [phases,        setPhases]        = useState<PhaseView[]>([])
  const [synthesis,     setSynthesis]     = useState('')
  const [swarmId,       setSwarmId]       = useState('')
  const [error,         setError]         = useState('')
  const [copied,        setCopied]        = useState(false)
  const [showSettings,  setShowSettings]  = useState(false)

  const abortRef   = useRef<AbortController | null>(null)
  const logRef     = useRef<HTMLDivElement>(null)

  const addEvent = useCallback((event: ParsedEvent) => {
    setEvents(prev => [...prev, event])
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    })
  }, [])

  const updatePhase = useCallback((phaseNum: number, update: Partial<PhaseView>) => {
    setPhases(prev => {
      const idx = prev.findIndex(p => p.phase === phaseNum)
      if (idx === -1) {
        return [...prev, { phase: phaseNum, title: '', tasks: [], status: 'running', ...update }]
      }
      const next = [...prev]
      next[idx] = { ...next[idx], ...update }
      return next
    })
  }, [])

  const updateTask = useCallback((taskId: string, update: Partial<TaskView>) => {
    setPhases(prev => prev.map(phase => ({
      ...phase,
      tasks: phase.tasks.some(t => t.id === taskId)
        ? phase.tasks.map(t => t.id === taskId ? { ...t, ...update } : t)
        : phase.tasks,
    })))
  }, [])

  async function handleLaunch() {
    if (!goal.trim()) { setError('"Goal" is required.'); return }
    setError('')
    setEvents([])
    setPhases([])
    setSynthesis('')
    setSwarmId('')
    setRunning(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch('/api/swarm/dispatch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          goal,
          context:       context || undefined,
          queenType,
          consensusType,
          budgetUsd:     parseFloat(budgetUsd) || 5,
        }),
        signal: ctrl.signal,
      })

      const sid = res.headers.get('X-Swarm-Id') ?? ''
      if (sid) setSwarmId(sid)

      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
        throw new Error(j.error ?? `Server error ${res.status}`)
      }

      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const lines = decoder.decode(value, { stream: true }).split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as SwarmEvent
            const parsed: ParsedEvent = { type: event.type, payload: event.payload, ts: event.ts }

            addEvent(parsed)

            // Update phase/task state from events
            if (event.type === 'phase_start') {
              updatePhase(Number(event.payload.phase), {
                phase:  Number(event.payload.phase),
                title:  String(event.payload.title ?? ''),
                tasks:  [],
                status: 'running',
              })
            } else if (event.type === 'phase_end') {
              updatePhase(Number(event.payload.phase), {
                status: Number(event.payload.approvedTasks) > 0 ? 'completed' : 'failed',
              })
            } else if (event.type === 'task_start') {
              const phaseNum = phases.find(p => p.status === 'running')?.phase ?? 1
              const taskView: TaskView = {
                id:     String(event.payload.taskId ?? ''),
                title:  String(event.payload.title ?? ''),
                role:   String(event.payload.role ?? ''),
                model:  String(event.payload.model ?? ''),
                status: 'running',
              }
              setPhases(prev => prev.map(p =>
                p.status === 'running'
                  ? { ...p, tasks: [...p.tasks, taskView] }
                  : p
              ))
            } else if (event.type === 'task_end') {
              updateTask(String(event.payload.taskId ?? ''), {
                status: event.payload.approved ? 'approved' : 'rejected',
                tokens: Number(event.payload.tokensUsed ?? 0),
              })
            } else if (event.type === 'complete') {
              setSynthesis(String(event.payload.synthesis ?? ''))
            }
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message ?? 'Swarm failed.')
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  function handleStop() {
    abortRef.current?.abort()
    setRunning(false)
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(synthesis)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isComplete = events.some(e => e.type === 'complete')
  const hasError   = events.some(e => e.type === 'error')

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#050508' }}>
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: '#1a1a2e' }}
        >
          <Network size={20} style={{ color: '#6c63ff' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold mb-0.5" style={{ color: '#e8e8f0' }}>Swarm Orchestration</h1>
          <p className="text-sm" style={{ color: '#55556a' }}>
            Coordinate a queen-led swarm of 22 specialist agents to accomplish complex multi-phase goals.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left: config ───────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Goal */}
          <div>
            <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: '#9090b0' }}>
              Swarm Goal <span style={{ color: '#f87171' }}>*</span>
            </label>
            <textarea
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="e.g. Build a complete go-to-market strategy for a B2B SaaS product targeting SMEs in the UK healthcare sector, including market research, competitive analysis, messaging framework, and a 90-day action plan."
              rows={5}
              className="w-full text-sm rounded-xl px-4 py-3 resize-none outline-none"
              style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
            />
          </div>

          {/* Context */}
          <div>
            <label className="block text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: '#9090b0' }}>
              Additional Context
            </label>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="Business background, constraints, prior research, target audience details…"
              rows={3}
              className="w-full text-sm rounded-xl px-4 py-3 resize-none outline-none"
              style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
            />
          </div>

          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings(s => !s)}
            className="flex items-center gap-2 text-xs"
            style={{ color: '#55556a' }}
          >
            {showSettings ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Advanced Settings
          </button>

          {showSettings && (
            <div className="rounded-xl p-4 space-y-4" style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}>
              {/* Queen type */}
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: '#9090b0' }}>Queen Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {QUEEN_OPTIONS.map(q => (
                    <button
                      key={q.id}
                      onClick={() => setQueenType(q.id)}
                      className="rounded-lg px-3 py-2 text-xs text-left transition-colors"
                      style={{
                        backgroundColor: queenType === q.id ? '#1a1a2e' : '#12121e',
                        border:          `1px solid ${queenType === q.id ? '#6c63ff' : '#24243e'}`,
                        color:           queenType === q.id ? '#e8e8f0' : '#9090b0',
                      }}
                    >
                      <div className="font-semibold">{q.label}</div>
                      <div className="mt-0.5 text-xs opacity-70">{q.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Consensus type */}
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: '#9090b0' }}>Consensus Protocol</label>
                <div className="grid grid-cols-3 gap-2">
                  {CONSENSUS_OPTIONS.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setConsensusType(c.id)}
                      className="rounded-lg px-3 py-2 text-xs text-left transition-colors"
                      style={{
                        backgroundColor: consensusType === c.id ? '#1a1a2e' : '#12121e',
                        border:          `1px solid ${consensusType === c.id ? '#6c63ff' : '#24243e'}`,
                        color:           consensusType === c.id ? '#e8e8f0' : '#9090b0',
                      }}
                    >
                      <div className="font-semibold">{c.label}</div>
                      <div className="mt-0.5 text-xs opacity-70">{c.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Budget */}
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: '#9090b0' }}>Budget Cap (USD)</label>
                <input
                  type="number"
                  min="0.10"
                  max="50"
                  step="0.50"
                  value={budgetUsd}
                  onChange={e => setBudgetUsd(e.target.value)}
                  className="w-full text-sm rounded-lg px-3 py-2 outline-none"
                  style={{ backgroundColor: '#12121e', border: '1px solid #24243e', color: '#e8e8f0' }}
                />
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs rounded-xl px-4 py-3" style={{ backgroundColor: '#2e1a1a', color: '#f87171' }}>{error}</p>
          )}

          {/* Launch / Stop */}
          {!running ? (
            <button
              onClick={handleLaunch}
              disabled={!goal.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-opacity"
              style={{
                backgroundColor: '#6c63ff',
                color:           '#fff',
                opacity:         goal.trim() ? 1 : 0.4,
                cursor:          goal.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              <Crown size={16} />
              Launch Swarm
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
              style={{ backgroundColor: '#ef4444', color: '#fff' }}
            >
              <X size={16} />
              Abort Swarm
            </button>
          )}

          {swarmId && (
            <p className="text-xs text-center" style={{ color: '#24243e' }}>
              Swarm ID: <code style={{ color: '#55556a' }}>{swarmId}</code>
            </p>
          )}

          {/* Phase cards */}
          {phases.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#9090b0' }}>Execution Plan</h3>
              {phases.map(phase => <PhaseCard key={phase.phase} phase={phase} />)}
            </div>
          )}
        </div>

        {/* ── Right: output ───────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          {/* Event log */}
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #24243e', backgroundColor: '#0d0d14' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #24243e' }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#55556a' }}>
                Swarm Log
              </span>
              {running && <Loader2 size={12} className="animate-spin" style={{ color: '#6c63ff' }} />}
              {isComplete && <span className="text-xs" style={{ color: '#22c55e' }}>✓ Complete</span>}
              {hasError  && <span className="text-xs" style={{ color: '#ef4444' }}>✗ Error</span>}
            </div>
            <div
              ref={logRef}
              className="h-64 overflow-y-auto px-4 py-2"
              style={{ backgroundColor: '#050508' }}
            >
              {events.length === 0 ? (
                <p className="text-xs py-4 text-center" style={{ color: '#24243e' }}>
                  Events will stream here when the swarm runs.
                </p>
              ) : (
                events.map((e, i) => <EventRow key={i} event={e} />)
              )}
            </div>
          </div>

          {/* Synthesis output */}
          <div className="rounded-xl overflow-hidden flex-1" style={{ border: '1px solid #24243e', backgroundColor: '#0d0d14' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #24243e' }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#55556a' }}>
                Synthesised Output
              </span>
              {synthesis && (
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-md"
                  style={{ backgroundColor: '#12121e', color: copied ? '#22c55e' : '#9090b0' }}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
            <div className="h-96 overflow-y-auto p-4">
              {synthesis ? (
                <pre
                  className="text-xs leading-relaxed whitespace-pre-wrap font-mono"
                  style={{ color: '#c8c8e0' }}
                >
                  {synthesis}
                </pre>
              ) : (
                <p className="text-xs py-4 text-center" style={{ color: '#24243e' }}>
                  The swarm's synthesised deliverable will appear here on completion.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Info footer */}
      <p className="mt-8 text-xs text-center" style={{ color: '#24243e' }}>
        Requires <code style={{ color: '#55556a' }}>ANTHROPIC_API_KEY</code> · Queen uses Opus 4.6 · Specialists use Sonnet/Haiku · Budget capped at ${budgetUsd}
      </p>
    </div>
  )
}

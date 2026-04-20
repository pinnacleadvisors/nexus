'use client'

/**
 * /build — Dev Console
 * Phase 19a: Nexus builds Nexus.
 * Describe a feature/bug/error → Claude Opus plans it → approve → OpenClaw executes.
 */

import { useState, useRef } from 'react'
import {
  Terminal,
  GitBranch,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Send,
  Code2,
  FileCode,
  Cpu,
  RefreshCw,
  ExternalLink,
  Kanban,
  Search,
  Shield,
  Play,
  Package,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BuildPlan, BuildRequestType } from '@/lib/build/types'
import {
  CATEGORY_META,
  IMPACT_META,
  WORK_META,
  type ResearchDigest,
  type ResearchCategory,
} from '@/lib/build/research'

// ── Types ─────────────────────────────────────────────────────────────────────
type ActiveTab = 'console' | 'research'

type PanelState =
  | 'idle'
  | 'fetching_tree'
  | 'planning'
  | 'plan_ready'
  | 'dispatching'
  | 'dispatched'
  | 'error'

interface DispatchResult {
  sessionId:   string
  boardCardId: string | null
  branchUrl:   string
  dispatched:  boolean
  note?:       string
}

// ── Constants ─────────────────────────────────────────────────────────────────
const REQUEST_TYPES: { value: BuildRequestType; label: string; desc: string }[] = [
  { value: 'feature', label: 'Feature',    desc: 'Add new functionality' },
  { value: 'bug',     label: 'Bug Report', desc: 'Describe a bug to fix' },
  { value: 'error',   label: 'Error',      desc: 'Paste a stack trace'   },
]

const COMPLEXITY_META: Record<string, { label: string; color: string }> = {
  S:  { label: 'Small (<1h)',   color: '#22c55e' },
  M:  { label: 'Medium (1-4h)', color: '#6c63ff' },
  L:  { label: 'Large (4-8h)',  color: '#f59e0b' },
  XL: { label: 'XL (8h+)',      color: '#ef4444' },
}

const RISK_META: Record<string, { color: string }> = {
  low:    { color: '#22c55e' },
  medium: { color: '#f59e0b' },
  high:   { color: '#ef4444' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractPlan(text: string): BuildPlan | null {
  const match = text.match(/<plan>([\s\S]*?)<\/plan>/)
  if (!match) return null
  try {
    return JSON.parse(match[1].trim()) as BuildPlan
  } catch {
    return null
  }
}

function stripPlanTags(text: string): string {
  return text.replace(/<plan>[\s\S]*?<\/plan>/g, '').trim()
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-semibold"
      style={{ backgroundColor: color + '22', color, border: `1px solid ${color}44` }}
    >
      {label}
    </span>
  )
}

function PlanCard({ plan, onApprove, onReject, dispatching }: {
  plan: BuildPlan
  onApprove: () => void
  onReject:  () => void
  dispatching: boolean
}) {
  const [stepsOpen, setStepsOpen] = useState(true)
  const [filesOpen, setFilesOpen] = useState(false)
  const complexity = COMPLEXITY_META[plan.complexity] ?? { label: plan.complexity, color: '#9090b0' }
  const risk       = RISK_META[plan.risk]             ?? { color: '#9090b0' }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#24243e', backgroundColor: '#0d0d14' }}>
      {/* Header */}
      <div className="px-5 py-4 border-b" style={{ borderColor: '#24243e', backgroundColor: '#12121e' }}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold leading-snug" style={{ color: '#e8e8f0' }}>
            {plan.title}
          </h3>
          <div className="flex gap-2 shrink-0 mt-0.5">
            <Badge label={plan.complexity} color={complexity.color} />
            <Badge label={plan.risk}       color={risk.color} />
          </div>
        </div>
        <p className="mt-1.5 text-sm" style={{ color: '#9090b0' }}>{plan.summary}</p>
      </div>

      {/* Meta row */}
      <div className="px-5 py-3 flex flex-wrap gap-4 border-b text-xs" style={{ borderColor: '#1a1a2e', color: '#9090b0' }}>
        <span className="flex items-center gap-1.5">
          <Clock size={12} />
          {plan.estimatedMinutes < 60
            ? `~${plan.estimatedMinutes}m`
            : `~${Math.round(plan.estimatedMinutes / 60 * 10) / 10}h`}
        </span>
        <span className="flex items-center gap-1.5">
          <GitBranch size={12} />
          <code className="font-mono text-xs" style={{ color: '#6c63ff' }}>{plan.branchName}</code>
        </span>
        <span className="flex items-center gap-1.5">
          <Code2 size={12} />
          {plan.commitMessage}
        </span>
      </div>

      {/* Steps */}
      <div className="border-b" style={{ borderColor: '#1a1a2e' }}>
        <button
          className="w-full flex items-center gap-2 px-5 py-3 text-sm font-medium text-left"
          style={{ color: '#c0c0d8' }}
          onClick={() => setStepsOpen(v => !v)}
        >
          {stepsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Steps ({plan.steps.length})
        </button>
        {stepsOpen && (
          <ol className="pb-3 px-5 space-y-2">
            {[...plan.steps].sort((a, b) => a.order - b.order).map(step => (
              <li key={step.order} className="flex gap-3">
                <span
                  className="flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shrink-0 mt-0.5"
                  style={{ backgroundColor: '#1a1a2e', color: '#6c63ff' }}
                >
                  {step.order}
                </span>
                <div>
                  <div className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{step.action}</div>
                  <div className="text-xs mt-0.5" style={{ color: '#6c6c88' }}>{step.description}</div>
                  {step.file && (
                    <code className="text-xs mt-0.5 block font-mono" style={{ color: '#6c63ff' }}>{step.file}</code>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Affected files (collapsed by default) */}
      <div className="border-b" style={{ borderColor: '#1a1a2e' }}>
        <button
          className="w-full flex items-center gap-2 px-5 py-3 text-sm font-medium text-left"
          style={{ color: '#c0c0d8' }}
          onClick={() => setFilesOpen(v => !v)}
        >
          {filesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <FileCode size={13} />
          Affected Files ({plan.affectedFiles.length})
        </button>
        {filesOpen && (
          <ul className="pb-3 px-5 space-y-1">
            {plan.affectedFiles.map(f => (
              <li key={f}>
                <code className="text-xs font-mono" style={{ color: '#9090b0' }}>{f}</code>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Test instructions */}
      <div className="px-5 py-3 border-b" style={{ borderColor: '#1a1a2e' }}>
        <div className="text-xs font-medium mb-1" style={{ color: '#6c6c88' }}>How to verify</div>
        <p className="text-sm" style={{ color: '#9090b0' }}>{plan.testInstructions}</p>
      </div>

      {/* Approve / Reject */}
      <div className="px-5 py-4 flex gap-3">
        <button
          onClick={onApprove}
          disabled={dispatching}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-60"
          style={{ backgroundColor: '#6c63ff', color: '#fff' }}
        >
          {dispatching
            ? <Loader2 size={14} className="animate-spin" />
            : <CheckCircle2 size={14} />}
          {dispatching ? 'Dispatching…' : 'Approve & Dispatch'}
        </button>
        <button
          onClick={onReject}
          disabled={dispatching}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
          style={{ backgroundColor: '#1a1a2e', color: '#9090b0', border: '1px solid #24243e' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#e8e8f0' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#9090b0' }}
        >
          <XCircle size={14} />
          Reject
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BuildPage() {
  const [requestType, setRequestType] = useState<BuildRequestType>('feature')
  const [description, setDescription] = useState('')
  const [panelState, setPanelState]   = useState<PanelState>('idle')
  const [streamText, setStreamText]   = useState('')
  const [plan, setPlan]               = useState<BuildPlan | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null)
  const [fileTree, setFileTree]       = useState<string>('')
  const abortRef = useRef<AbortController | null>(null)

  // ── Generate plan ──────────────────────────────────────────────────────────
  async function handlePlan() {
    if (!description.trim() || panelState === 'planning') return

    setPanelState('fetching_tree')
    setStreamText('')
    setPlan(null)
    setError(null)
    setDispatchResult(null)

    // Fetch file tree silently (non-fatal)
    let tree = fileTree
    if (!tree) {
      try {
        const res = await fetch('/api/build/filetree')
        if (res.ok) {
          const data = await res.json() as { tree: string }
          tree = data.tree
          setFileTree(tree)
        }
      } catch { /* non-fatal */ }
    }

    setPanelState('planning')
    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/build/plan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: requestType, description, fileTree: tree }),
        signal:  abortRef.current.signal,
      })

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(data.error ?? `Request failed (${res.status})`)
        setPanelState('error')
        return
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let fullText  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullText += decoder.decode(value, { stream: true })
        setStreamText(fullText)
      }

      const parsed = extractPlan(fullText)
      if (parsed) {
        setPlan(parsed)
        setPanelState('plan_ready')
      } else {
        setError('Could not parse a valid plan from the response. Try rephrasing your request.')
        setPanelState('error')
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') { setPanelState('idle'); return }
      setError((err as Error).message)
      setPanelState('error')
    }
  }

  // ── Dispatch to OpenClaw ───────────────────────────────────────────────────
  async function handleDispatch() {
    if (!plan) return
    setPanelState('dispatching')
    setError(null)

    try {
      const res = await fetch('/api/build/dispatch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan }),
      })
      const data = await res.json() as {
        ok: boolean; sessionId?: string; boardCardId?: string
        branchUrl?: string; dispatched?: boolean; note?: string; error?: string
      }

      if (!data.ok) {
        setError(data.error ?? 'Dispatch failed')
        setPanelState('plan_ready')
        return
      }

      setDispatchResult({
        sessionId:   data.sessionId   ?? '',
        boardCardId: data.boardCardId ?? null,
        branchUrl:   data.branchUrl   ?? '',
        dispatched:  data.dispatched  ?? false,
        note:        data.note,
      })
      setPanelState('dispatched')
    } catch (err) {
      setError((err as Error).message)
      setPanelState('plan_ready')
    }
  }

  // ── Reject / reset ─────────────────────────────────────────────────────────
  function handleReject() {
    setPanelState('idle')
    setPlan(null)
    setStreamText('')
    setError(null)
  }

  function handleReset() {
    abortRef.current?.abort()
    setPanelState('idle')
    setPlan(null)
    setStreamText('')
    setError(null)
    setDispatchResult(null)
  }

  const isLoading  = panelState === 'fetching_tree' || panelState === 'planning'
  const analysisText = streamText ? stripPlanTags(streamText) : ''

  // ── Research tab state ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab]               = useState<ActiveTab>('console')
  const [researchDigests, setResearchDigests]   = useState<ResearchDigest[]>([])
  const [researchLoading, setResearchLoading]   = useState(false)
  const [researchLoaded, setResearchLoaded]     = useState(false)
  const [researchRunning, setResearchRunning]   = useState(false)
  const [researchRunNote, setResearchRunNote]   = useState<string | null>(null)
  const [researchError, setResearchError]       = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter]     = useState<ResearchCategory | 'all'>('all')
  const [stackHealthOpen, setStackHealthOpen]   = useState(true)

  async function loadResearch() {
    if (researchLoaded) return
    setResearchLoading(true)
    try {
      const res = await fetch('/api/build/research?limit=5')
      if (res.ok) {
        const data = await res.json() as { digests: ResearchDigest[] }
        setResearchDigests(data.digests ?? [])
        setResearchLoaded(true)
      }
    } catch { /* non-fatal */ }
    finally { setResearchLoading(false) }
  }

  function handleTabChange(tab: ActiveTab) {
    setActiveTab(tab)
    if (tab === 'research' && !researchLoaded) loadResearch()
  }

  async function handleRunResearch() {
    setResearchRunning(true)
    setResearchRunNote(null)
    setResearchError(null)
    try {
      const res = await fetch('/api/build/research', { method: 'POST' })
      const data = await res.json() as {
        ok: boolean; mode?: string; note?: string
        digest?: ResearchDigest; error?: string
      }
      if (!res.ok) { setResearchError(data.error ?? 'Research run failed'); return }
      if (data.mode === 'inngest') {
        setResearchRunNote(data.note ?? 'Research loop queued — check back in ~1 minute.')
      } else if (data.digest) {
        setResearchDigests(prev => [data.digest!, ...prev])
        setResearchLoaded(true)
      }
    } catch (err) {
      setResearchError((err as Error).message)
    } finally {
      setResearchRunning(false)
    }
  }

  const latestDigest      = researchDigests[0]
  const filteredSuggestions = (latestDigest?.suggestions ?? []).filter(
    s => categoryFilter === 'all' || s.category === categoryFilter,
  )
  const SEVERITY_COLOR: Record<string, string> = {
    critical: '#ef4444', high: '#f97316', moderate: '#f59e0b', low: '#22c55e',
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#050508' }}>
      {/* Page header */}
      <div className="px-6 py-5 border-b shrink-0" style={{ borderColor: '#1a1a2e' }}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-9 h-9 rounded-lg"
              style={{ backgroundColor: '#6c63ff22', border: '1px solid #6c63ff44' }}
            >
              {activeTab === 'console'
                ? <Terminal size={18} style={{ color: '#6c63ff' }} />
                : <Search   size={18} style={{ color: '#6c63ff' }} />}
            </div>
            <div>
              <h1 className="text-lg font-semibold" style={{ color: '#e8e8f0' }}>
                {activeTab === 'console' ? 'Dev Console' : 'Research Loop'}
              </h1>
              <p className="text-xs" style={{ color: '#6c6c88' }}>
                {activeTab === 'console'
                  ? 'Nexus builds Nexus — describe a change, approve the plan, dispatch to Claude Code'
                  : 'Weekly AI/dev research digest — suggestions, stack health, improvement ideas'}
              </p>
            </div>
          </div>
          {/* Tab switcher */}
          <div
            className="flex rounded-lg p-0.5 shrink-0"
            style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
          >
            {(['console', 'research'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={activeTab === tab
                  ? { backgroundColor: '#6c63ff', color: '#fff' }
                  : { backgroundColor: 'transparent', color: '#6c6c88' }}
              >
                {tab === 'console' ? <Terminal size={12} /> : <Search size={12} />}
                {tab === 'console' ? 'Console' : 'Research'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Console tab ───────────────────────────────────────────────────── */}
      {activeTab === 'console' && (
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Left: Input panel ──────────────────────────────────────────── */}
        <div
          className="w-80 shrink-0 flex flex-col border-r overflow-y-auto"
          style={{ borderColor: '#1a1a2e', backgroundColor: '#0d0d14' }}
        >
          <div className="p-5 space-y-5">

            {/* Request type */}
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#6c6c88' }}>
                REQUEST TYPE
              </label>
              <div className="space-y-2">
                {REQUEST_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setRequestType(t.value)}
                    className={cn(
                      'w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors',
                    )}
                    style={
                      requestType === t.value
                        ? { backgroundColor: '#1a1a2e', borderColor: '#6c63ff', color: '#e8e8f0' }
                        : { backgroundColor: 'transparent', borderColor: '#24243e', color: '#9090b0' }
                    }
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{t.label}</span>
                      <span className="text-xs opacity-70">{t.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#6c6c88' }}>
                {requestType === 'error' ? 'PASTE STACK TRACE OR ERROR' : 'DESCRIPTION'}
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={
                  requestType === 'feature'
                    ? 'e.g. Add a dark mode toggle to the settings page'
                    : requestType === 'bug'
                    ? 'e.g. The kanban drag-drop breaks on mobile devices'
                    : 'Paste the full error message or stack trace here…'
                }
                rows={8}
                className="w-full rounded-lg px-3 py-2.5 text-sm resize-none outline-none"
                style={{
                  backgroundColor: '#12121e',
                  border:          '1px solid #24243e',
                  color:           '#e8e8f0',
                  fontFamily:      requestType === 'error' ? 'monospace' : 'inherit',
                  fontSize:        requestType === 'error' ? '0.75rem' : '0.875rem',
                }}
                onFocus={e  => { (e.target as HTMLTextAreaElement).style.borderColor = '#6c63ff66' }}
                onBlur={e   => { (e.target as HTMLTextAreaElement).style.borderColor = '#24243e' }}
                disabled={isLoading || panelState === 'dispatching'}
              />
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <button
                onClick={handlePlan}
                disabled={!description.trim() || isLoading || panelState === 'dispatching'}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50"
                style={{ backgroundColor: '#6c63ff', color: '#fff' }}
              >
                {isLoading
                  ? <><Loader2 size={14} className="animate-spin" />Generating plan…</>
                  : <><Cpu size={14} />Generate Plan</>}
              </button>

              {(panelState !== 'idle') && (
                <button
                  onClick={handleReset}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs transition-colors"
                  style={{ color: '#55556a', backgroundColor: 'transparent', border: '1px solid #1a1a2e' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#9090b0' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#55556a' }}
                >
                  <RefreshCw size={12} />
                  {isLoading ? 'Stop' : 'Start over'}
                </button>
              )}
            </div>

            {/* Tips */}
            {panelState === 'idle' && (
              <div className="rounded-lg p-3 text-xs space-y-2" style={{ backgroundColor: '#12121e', color: '#6c6c88' }}>
                <div className="font-medium" style={{ color: '#9090b0' }}>Tips</div>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Be specific — name the file or component</li>
                  <li>For errors, include the full stack trace</li>
                  <li>Claude Opus will plan; Claude Code will execute</li>
                  <li>Review the plan before approving</li>
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Output panel ────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-y-auto p-6 space-y-5">

          {/* Idle state */}
          {panelState === 'idle' && (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 py-20">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e' }}
              >
                <Terminal size={28} style={{ color: '#24243e' }} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: '#6c6c88' }}>No plan yet</p>
                <p className="text-xs mt-1" style={{ color: '#3a3a52' }}>
                  Describe your request and click Generate Plan
                </p>
              </div>
            </div>
          )}

          {/* Loading / streaming */}
          {(panelState === 'fetching_tree' || panelState === 'planning') && (
            <div className="space-y-4">
              <div className="flex items-center gap-2" style={{ color: '#6c63ff' }}>
                <Loader2 size={14} className="animate-spin" />
                <span className="text-sm font-medium">
                  {panelState === 'fetching_tree' ? 'Reading file tree…' : 'Claude Opus is planning…'}
                </span>
              </div>
              {analysisText && (
                <div
                  className="rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e', color: '#c0c0d8' }}
                >
                  {analysisText}
                  <span className="inline-block w-1.5 h-4 ml-0.5 align-middle animate-pulse rounded-sm" style={{ backgroundColor: '#6c63ff' }} />
                </div>
              )}
            </div>
          )}

          {/* Plan ready */}
          {panelState === 'plan_ready' && plan && (
            <div className="space-y-4">
              {analysisText && (
                <div
                  className="rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e', color: '#c0c0d8' }}
                >
                  {analysisText}
                </div>
              )}
              <PlanCard
                plan={plan}
                onApprove={handleDispatch}
                onReject={handleReject}
                dispatching={false}
              />
            </div>
          )}

          {/* Dispatching */}
          {panelState === 'dispatching' && plan && (
            <div className="space-y-4">
              {analysisText && (
                <div
                  className="rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap opacity-50"
                  style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e', color: '#c0c0d8' }}
                >
                  {analysisText}
                </div>
              )}
              <PlanCard
                plan={plan}
                onApprove={handleDispatch}
                onReject={handleReject}
                dispatching={true}
              />
            </div>
          )}

          {/* Dispatched */}
          {panelState === 'dispatched' && dispatchResult && plan && (
            <div className="space-y-4">
              {/* Success banner */}
              <div
                className="rounded-xl p-5 border"
                style={{ backgroundColor: '#0d1a0d', borderColor: '#22c55e44' }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 size={18} style={{ color: '#22c55e' }} />
                  <span className="font-semibold text-sm" style={{ color: '#22c55e' }}>
                    {dispatchResult.dispatched ? 'Dispatched to Claude Code' : 'Plan ready — awaiting OpenClaw'}
                  </span>
                </div>

                {dispatchResult.note && (
                  <p className="text-xs mb-3" style={{ color: '#6c9e6c' }}>{dispatchResult.note}</p>
                )}

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2" style={{ color: '#9090b0' }}>
                    <GitBranch size={13} />
                    <span>Branch:</span>
                    <a
                      href={dispatchResult.branchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1"
                      style={{ color: '#6c63ff' }}
                    >
                      <code className="font-mono text-xs">{plan.branchName}</code>
                      <ExternalLink size={11} />
                    </a>
                  </div>

                  {dispatchResult.dispatched && dispatchResult.sessionId && (
                    <div className="flex items-center gap-2" style={{ color: '#9090b0' }}>
                      <Terminal size={13} />
                      <span>Session:</span>
                      <code className="font-mono text-xs" style={{ color: '#c0c0d8' }}>
                        {dispatchResult.sessionId}
                      </code>
                    </div>
                  )}

                  {dispatchResult.boardCardId && (
                    <div className="flex items-center gap-2" style={{ color: '#9090b0' }}>
                      <Kanban size={13} />
                      <span>Board card created in</span>
                      <a href="/board" style={{ color: '#6c63ff' }}>
                        /board
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Plan summary (collapsed) */}
              <div
                className="rounded-xl border p-4"
                style={{ backgroundColor: '#0d0d14', borderColor: '#1a1a2e' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: '#9090b0' }}>Plan: {plan.title}</span>
                  <div className="flex gap-2">
                    <Badge label={plan.complexity} color={COMPLEXITY_META[plan.complexity]?.color ?? '#9090b0'} />
                    <Badge label={plan.risk}       color={RISK_META[plan.risk]?.color ?? '#9090b0'} />
                  </div>
                </div>
              </div>

              {/* Start over */}
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm border transition-colors"
                style={{ color: '#9090b0', borderColor: '#24243e', backgroundColor: 'transparent' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#e8e8f0' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#9090b0' }}
              >
                <Send size={13} />
                New request
              </button>
            </div>
          )}

          {/* Error state */}
          {panelState === 'error' && error && (
            <div className="space-y-4">
              <div
                className="rounded-xl p-5 border"
                style={{ backgroundColor: '#1a0d0d', borderColor: '#ef444444' }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={16} style={{ color: '#ef4444' }} />
                  <span className="font-semibold text-sm" style={{ color: '#ef4444' }}>Error</span>
                </div>
                <p className="text-sm" style={{ color: '#c08080' }}>{error}</p>
              </div>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm border"
                style={{ color: '#9090b0', borderColor: '#24243e', backgroundColor: 'transparent' }}
              >
                <RefreshCw size={13} />
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── Research tab ──────────────────────────────────────────────────── */}
      {activeTab === 'research' && (
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Top bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-4 text-sm" style={{ color: '#9090b0' }}>
              {latestDigest ? (
                <>
                  <span>Last run: <span style={{ color: '#c0c0d8' }}>{new Date(latestDigest.runAt).toLocaleString()}</span></span>
                  <span>{latestDigest.suggestions.length} suggestions</span>
                  <span>{latestDigest.stackIssues.length} stack issues</span>
                  <span>{latestDigest.rawSearchCount} sources</span>
                </>
              ) : researchLoading ? (
                <span className="flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />Loading digest…</span>
              ) : (
                <span>No research runs yet — click Run Now to start</span>
              )}
            </div>
            <button
              onClick={handleRunResearch}
              disabled={researchRunning}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-60"
              style={{ backgroundColor: '#6c63ff', color: '#fff' }}
            >
              {researchRunning
                ? <><Loader2 size={14} className="animate-spin" />Running…</>
                : <><Play size={14} />Run Now</>}
            </button>
          </div>

          {/* Note / error banners */}
          {researchRunNote && (
            <div className="rounded-lg px-4 py-3 text-sm flex items-center gap-2"
              style={{ backgroundColor: '#0d1a0d', border: '1px solid #22c55e44', color: '#6c9e6c' }}>
              <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
              {researchRunNote}
            </div>
          )}
          {researchError && (
            <div className="rounded-lg px-4 py-3 text-sm flex items-center gap-2"
              style={{ backgroundColor: '#1a0d0d', border: '1px solid #ef444444', color: '#c08080' }}>
              <AlertTriangle size={14} style={{ color: '#ef4444' }} />
              {researchError}
            </div>
          )}

          {/* Category filter pills */}
          {latestDigest && latestDigest.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(['all', 'security', 'performance', 'cost', 'dx', 'deprecation', 'new-tool'] as const).map(cat => {
                const meta = cat === 'all' ? null : CATEGORY_META[cat]
                const isActive = categoryFilter === cat
                return (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                    style={isActive && meta
                      ? { backgroundColor: meta.bg, color: meta.color, border: `1px solid ${meta.color}44` }
                      : isActive
                      ? { backgroundColor: '#6c63ff22', color: '#6c63ff', border: '1px solid #6c63ff44' }
                      : { backgroundColor: '#12121e', color: '#6c6c88', border: '1px solid #24243e' }}
                  >
                    {cat === 'all' ? 'All' : CATEGORY_META[cat].label}
                  </button>
                )
              })}
            </div>
          )}

          {/* Suggestion cards */}
          {filteredSuggestions.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {filteredSuggestions.map(s => {
                const cat    = CATEGORY_META[s.category] ?? { label: s.category, color: '#9090b0', bg: '#9090b022' }
                const impact = IMPACT_META[s.impact]     ?? { label: s.impact, color: '#9090b0' }
                const work   = WORK_META[s.estimatedWork] ?? { label: s.estimatedWork, color: '#9090b0' }
                return (
                  <div
                    key={s.id ?? s.title}
                    className="rounded-xl border p-4 space-y-3"
                    style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-snug" style={{ color: '#e8e8f0' }}>{s.title}</p>
                      <span
                        className="px-2 py-0.5 rounded text-xs font-medium shrink-0"
                        style={{ backgroundColor: cat.bg, color: cat.color }}
                      >{cat.label}</span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: '#9090b0' }}>{s.description}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{ backgroundColor: impact.color + '22', color: impact.color }}>
                        {impact.label} impact
                      </span>
                      <span className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{ backgroundColor: work.color + '22', color: work.color }}>
                        {work.label}
                      </span>
                      {s.boardCardId && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                          style={{ backgroundColor: '#22c55e22', color: '#22c55e' }}>
                          <Kanban size={10} />Board card
                        </span>
                      )}
                    </div>
                    {s.sourceUrl && (
                      <a
                        href={s.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs truncate"
                        style={{ color: '#6c63ff' }}
                      >
                        <ExternalLink size={10} />
                        {s.sourceTitle || s.sourceUrl}
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Empty suggestions state */}
          {latestDigest && filteredSuggestions.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Search size={28} style={{ color: '#24243e' }} />
              <p className="text-sm" style={{ color: '#6c6c88' }}>
                {categoryFilter === 'all' ? 'No suggestions in this digest.' : `No ${CATEGORY_META[categoryFilter as ResearchCategory]?.label ?? categoryFilter} suggestions.`}
              </p>
            </div>
          )}

          {/* Stack health */}
          {latestDigest && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#24243e' }}>
              <button
                className="w-full flex items-center justify-between px-5 py-3"
                style={{ backgroundColor: '#12121e' }}
                onClick={() => setStackHealthOpen(v => !v)}
              >
                <span className="flex items-center gap-2 text-sm font-medium" style={{ color: '#c0c0d8' }}>
                  <Shield size={14} style={{ color: latestDigest.stackIssues.length > 0 ? '#ef4444' : '#22c55e' }} />
                  Stack Health
                  {latestDigest.stackIssues.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-xs font-bold"
                      style={{ backgroundColor: '#ef444422', color: '#ef4444' }}>
                      {latestDigest.stackIssues.length}
                    </span>
                  )}
                </span>
                {stackHealthOpen ? <ChevronDown size={14} style={{ color: '#6c6c88' }} /> : <ChevronRight size={14} style={{ color: '#6c6c88' }} />}
              </button>
              {stackHealthOpen && (
                <div className="p-4" style={{ backgroundColor: '#0d0d14' }}>
                  {latestDigest.stackIssues.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm" style={{ color: '#22c55e' }}>
                      <CheckCircle2 size={14} />No vulnerabilities found
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {latestDigest.stackIssues.map((issue, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-lg"
                          style={{ backgroundColor: '#12121e', border: '1px solid #1a1a2e' }}>
                          <Package size={14} className="mt-0.5 shrink-0"
                            style={{ color: SEVERITY_COLOR[issue.severity] ?? '#9090b0' }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <code className="text-xs font-mono" style={{ color: '#e8e8f0' }}>{issue.package}</code>
                              <span className="px-1.5 py-0.5 rounded text-xs font-semibold"
                                style={{ backgroundColor: (SEVERITY_COLOR[issue.severity] ?? '#9090b0') + '22', color: SEVERITY_COLOR[issue.severity] ?? '#9090b0' }}>
                                {issue.severity}
                              </span>
                              {issue.fixAvailable && (
                                <span className="text-xs" style={{ color: '#22c55e' }}>fix available</span>
                              )}
                            </div>
                            <p className="text-xs mt-0.5" style={{ color: '#6c6c88' }}>{issue.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Research history */}
          {researchDigests.length > 1 && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: '#6c6c88' }}>PREVIOUS RUNS</p>
              <div className="space-y-2">
                {researchDigests.slice(1).map(d => (
                  <div key={d.id} className="flex items-center justify-between px-4 py-2.5 rounded-lg text-xs"
                    style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e' }}>
                    <span style={{ color: '#9090b0' }}>{new Date(d.runAt).toLocaleString()}</span>
                    <span style={{ color: '#6c6c88' }}>{d.suggestions.length} suggestions · {d.stackIssues.length} issues</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

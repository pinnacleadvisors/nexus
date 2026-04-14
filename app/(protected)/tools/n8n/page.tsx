'use client'

import React, { useState, useCallback } from 'react'
import {
  Workflow,
  Zap,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  Plus,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Loader2,
  ExternalLink,
  AlertCircle,
  GitBranch,
  Bot,
  ArrowRight,
} from 'lucide-react'
import { WORKFLOW_TEMPLATES, WORKFLOW_CATEGORIES } from '@/lib/n8n/templates'
import type { WorkflowTemplate, N8nWorkflowStatus } from '@/lib/n8n/types'
import type { GapAnalysis } from '@/lib/n8n/gap-detector'

type ExecutionStatus = 'success' | 'error' | 'running' | 'waiting'

// ── Helpers ───────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: ExecutionStatus }) {
  const map: Record<ExecutionStatus, { color: string; bg: string; icon: React.ElementType; label: string }> = {
    success: { color: '#22c55e', bg: '#1a2e1a', icon: CheckCircle2, label: 'Success' },
    error:   { color: '#ef4444', bg: '#2e1a1a', icon: XCircle,      label: 'Error' },
    running: { color: '#6c63ff', bg: '#1a1a2e', icon: Loader2,      label: 'Running' },
    waiting: { color: '#fbbf24', bg: '#2e2818', icon: Clock,        label: 'Waiting' },
  }
  const cfg = map[status] ?? map.waiting
  const Icon = cfg.icon as React.ComponentType<{ size?: number; className?: string }>
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}
    >
      <Icon size={10} className={status === 'running' ? 'animate-spin' : ''} />
      {cfg.label}
    </span>
  )
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  content:    { bg: '#1a1a2e', text: '#818cf8' },
  sales:      { bg: '#1a2e1a', text: '#4ade80' },
  marketing:  { bg: '#2e1a2e', text: '#c084fc' },
  operations: { bg: '#2e2818', text: '#fbbf24' },
  finance:    { bg: '#2e2818', text: '#fbbf24' },
  support:    { bg: '#2e1a1a', text: '#f87171' },
  monitoring: { bg: '#1a2428', text: '#22d3ee' },
}

// ── Template card ─────────────────────────────────────────────────────────────
function TemplateCard({
  template,
  onImport,
  onExpand,
  expanded,
}: {
  template: WorkflowTemplate
  onImport: (t: WorkflowTemplate) => void
  onExpand: (id: string) => void
  expanded: boolean
}) {
  const col = CATEGORY_COLORS[template.category] ?? { bg: '#1a1a2e', text: '#9090b0' }
  const catLabel = WORKFLOW_CATEGORIES.find(c => c.id === template.category)?.label ?? template.category

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3 mb-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: col.bg }}
          >
            <Workflow size={16} style={{ color: col.text }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
                {template.name}
              </h3>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: col.bg, color: col.text }}
              >
                {catLabel}
              </span>
            </div>
            <p className="text-xs mt-0.5 line-clamp-2" style={{ color: '#9090b0' }}>
              {template.description}
            </p>
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 mb-3 text-xs" style={{ color: '#55556a' }}>
          <span className="flex items-center gap-1">
            <Clock size={11} />
            ~{template.estimatedSetupMinutes} min setup
          </span>
          <span className="flex items-center gap-1">
            <Zap size={11} />
            {template.triggers[0]}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onImport(template)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: '#6c63ff', color: '#fff' }}
          >
            <Download size={12} />
            Import to n8n
          </button>
          <button
            onClick={() => onExpand(template.id)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors"
            style={{ backgroundColor: '#12121e', color: '#9090b0' }}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? 'Hide' : 'Details'}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          className="px-4 pb-4 space-y-3"
          style={{ borderTop: '1px solid #1a1a2e' }}
        >
          {/* Setup checklist */}
          <div className="pt-3">
            <p className="text-xs font-medium mb-2" style={{ color: '#9090b0' }}>Setup checklist</p>
            <ol className="space-y-1">
              {template.setupChecklist.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-xs" style={{ color: '#7070a0' }}>
                  <span
                    className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                    style={{ backgroundColor: '#1a1a2e', color: '#6c63ff' }}
                  >
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {/* OpenClaw steps */}
          {template.openClawSteps.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: '#6c63ff' }}>
                OpenClaw browser automation needed
              </p>
              <ul className="space-y-1">
                {template.openClawSteps.map((step, i) => (
                  <li key={i} className="text-xs flex items-start gap-1.5" style={{ color: '#7070a0' }}>
                    <span style={{ color: '#6c63ff' }}>→</span>
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Required env vars */}
          {template.requiredEnvVars.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1.5" style={{ color: '#55556a' }}>Required env vars</p>
              <div className="flex flex-wrap gap-1">
                {template.requiredEnvVars.map(v => (
                  <code
                    key={v}
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: '#12121e', color: '#9090b0' }}
                  >
                    {v}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Live workflow row ─────────────────────────────────────────────────────────
function WorkflowRow({
  workflow,
  onToggle,
  toggling,
}: {
  workflow: N8nWorkflowStatus
  onToggle: (id: string, active: boolean) => void
  toggling: boolean
}) {
  const lastRun = workflow.lastExecution
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e' }}
    >
      {/* Active indicator */}
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: workflow.active ? '#22c55e' : '#55556a' }}
      />

      {/* Name + tags */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>
          {workflow.name}
        </p>
        {workflow.tags?.length > 0 && (
          <div className="flex gap-1 mt-0.5">
            {workflow.tags.slice(0, 3).map(t => (
              <span
                key={t.id}
                className="text-[10px] px-1.5 py-0 rounded"
                style={{ backgroundColor: '#12121e', color: '#55556a' }}
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Last run status */}
      {lastRun ? (
        <StatusBadge status={lastRun.status} />
      ) : (
        <span className="text-xs" style={{ color: '#55556a' }}>Never run</span>
      )}

      {/* Last run time */}
      {lastRun?.stoppedAt && (
        <span className="text-xs hidden sm:block" style={{ color: '#55556a' }}>
          {new Date(lastRun.stoppedAt).toLocaleString()}
        </span>
      )}

      {/* Toggle active */}
      <button
        onClick={() => onToggle(workflow.id, !workflow.active)}
        disabled={toggling}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
        style={{
          backgroundColor: workflow.active ? '#2e1a1a' : '#1a2e1a',
          color:           workflow.active ? '#ef4444'  : '#22c55e',
        }}
      >
        {toggling ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
        {workflow.active ? 'Pause' : 'Activate'}
      </button>
    </div>
  )
}

// ── Gap analysis panel (shown inside GeneratePanel result area) ───────────────
function GapAnalysisPanel({
  gap,
  onBridge,
  bridging,
  bridgeResult,
}: {
  gap:          GapAnalysis
  onBridge:     () => void
  bridging:     boolean
  bridgeResult: { openClawDispatched: boolean; openClawSessionId?: string } | null
}) {
  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{
        backgroundColor: gap.hybridRequired ? '#1a1a2e' : '#0d1a0d',
        border: `1px solid ${gap.hybridRequired ? '#6c63ff' : '#166534'}`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <GitBranch size={13} style={{ color: gap.hybridRequired ? '#6c63ff' : '#4ade80' }} />
        <p className="text-xs font-semibold" style={{ color: gap.hybridRequired ? '#a5b4fc' : '#4ade80' }}>
          {gap.hybridRequired ? 'Hybrid Routing Required' : 'Pure n8n — No Gaps'}
        </p>
        <span
          className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium"
          style={{
            backgroundColor: gap.hybridRequired ? '#2e2860' : '#1a2e1a',
            color:           gap.hybridRequired ? '#818cf8' : '#22c55e',
          }}
        >
          {gap.summary}
        </span>
      </div>

      {/* Routing explanation */}
      <p className="text-[11px] leading-relaxed" style={{ color: '#7070a0' }}>
        {gap.routingExplanation}
      </p>

      {/* Step columns */}
      <div className="grid grid-cols-2 gap-3">
        {/* n8n steps */}
        <div>
          <p className="text-[10px] font-medium mb-1.5 flex items-center gap-1" style={{ color: '#4ade80' }}>
            <Workflow size={10} /> n8n ({gap.apiNativeSteps.length})
          </p>
          <ul className="space-y-1">
            {gap.apiNativeSteps.map(s => (
              <li key={s.id} className="text-[10px] flex items-start gap-1" style={{ color: '#55556a' }}>
                <span style={{ color: '#4ade80' }}>✓</span>
                {s.description}
              </li>
            ))}
          </ul>
        </div>

        {/* OpenClaw steps */}
        {gap.hybridRequired && (
          <div>
            <p className="text-[10px] font-medium mb-1.5 flex items-center gap-1" style={{ color: '#a5b4fc' }}>
              <Bot size={10} /> OpenClaw ({gap.openClawSteps.length})
            </p>
            <ul className="space-y-1">
              {gap.openClawSteps.map(s => (
                <li key={s.id} className="text-[10px] flex items-start gap-1" style={{ color: '#55556a' }}>
                  <span style={{ color: '#a5b4fc' }}>→</span>
                  <span>
                    {s.description}
                    {s.openClawReason && (
                      <span style={{ color: '#3d3d60' }}> — {s.openClawReason}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Dispatch button */}
      {gap.hybridRequired && !bridgeResult && (
        <button
          onClick={onBridge}
          disabled={bridging}
          className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-60"
          style={{ backgroundColor: '#2e2860', color: '#a5b4fc' }}
        >
          {bridging
            ? <><Loader2 size={12} className="animate-spin" /> Dispatching to OpenClaw…</>
            : <><ArrowRight size={12} /> Dispatch OpenClaw Steps</>
          }
        </button>
      )}

      {/* Bridge result */}
      {bridgeResult && (
        <div
          className="flex items-start gap-2 p-2.5 rounded-lg text-[11px]"
          style={{
            backgroundColor: bridgeResult.openClawDispatched ? '#1a2e1a' : '#2e2818',
            color:           bridgeResult.openClawDispatched ? '#4ade80' : '#fbbf24',
          }}
        >
          {bridgeResult.openClawDispatched ? (
            <>
              <CheckCircle2 size={12} className="shrink-0 mt-0.5" />
              <span>
                OpenClaw dispatched{bridgeResult.openClawSessionId
                  ? ` (session: ${bridgeResult.openClawSessionId})`
                  : ''
                }. Results will arrive via webhook.
              </span>
            </>
          ) : (
            <>
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span>
                OpenClaw not configured — set{' '}
                <code style={{ color: '#fbbf24' }}>OPENCLAW_GATEWAY_URL</code> +{' '}
                <code style={{ color: '#fbbf24' }}>OPENCLAW_BEARER_TOKEN</code> in Doppler.
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Generate panel ────────────────────────────────────────────────────────────
function GeneratePanel({ onClose }: { onClose: () => void }) {
  const [description,     setDescription]     = useState('')
  const [businessContext, setBusinessContext] = useState('')
  const [loading,         setLoading]         = useState(false)
  const [result,          setResult]          = useState<{
    workflow:     Record<string, unknown>
    checklist:    string[]
    explanation:  string
    importUrl?:   string
    gapAnalysis?: GapAnalysis
  } | null>(null)
  const [error,       setError]       = useState('')
  const [copied,      setCopied]      = useState(false)
  const [bridging,    setBridging]    = useState(false)
  const [bridgeResult, setBridgeResult] = useState<{
    openClawDispatched: boolean
    openClawSessionId?: string
  } | null>(null)

  async function handleGenerate() {
    if (!description.trim()) { setError('Please describe your workflow.'); return }
    setError('')
    setResult(null)
    setBridgeResult(null)
    setLoading(true)
    try {
      const res = await fetch('/api/n8n/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ description, businessContext }),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        throw new Error(json.error ?? `Server error ${res.status}`)
      }
      const data = await res.json() as typeof result
      setResult(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleBridge() {
    setBridging(true)
    setBridgeResult(null)
    try {
      const res = await fetch('/api/n8n/bridge', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ description, businessContext }),
      })
      const data = await res.json() as {
        openClawDispatched: boolean
        openClawSessionId?: string
      }
      setBridgeResult({
        openClawDispatched: data.openClawDispatched,
        openClawSessionId:  data.openClawSessionId,
      })
    } catch {
      setBridgeResult({ openClawDispatched: false })
    } finally {
      setBridging(false)
    }
  }

  async function handleCopy() {
    if (!result) return
    await navigator.clipboard.writeText(JSON.stringify(result.workflow, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(5,5,8,0.85)' }}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid #24243e' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: '#1a1a2e' }}
          >
            <Workflow size={16} style={{ color: '#6c63ff' }} />
          </div>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
              Generate Custom Workflow
            </h2>
            <p className="text-xs" style={{ color: '#55556a' }}>
              Claude writes the n8n JSON · gap detection routes browser steps to OpenClaw
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: '#12121e', color: '#9090b0' }}
          >
            Close
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: inputs */}
          <div
            className="w-72 shrink-0 flex flex-col gap-3 p-4 overflow-y-auto"
            style={{ borderRight: '1px solid #24243e' }}
          >
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#9090b0' }}>
                Describe the workflow <span style={{ color: '#f87171' }}>*</span>
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="e.g. Every Monday, fetch our top 5 blog posts from the RSS feed and generate Twitter threads for each one, then save them to a Notion database for review."
                rows={5}
                className="w-full text-xs rounded-lg px-3 py-2 resize-none outline-none"
                style={{
                  backgroundColor: '#12121e',
                  border: '1px solid #24243e',
                  color: '#e8e8f0',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#9090b0' }}>
                Business context (optional)
              </label>
              <textarea
                value={businessContext}
                onChange={e => setBusinessContext(e.target.value)}
                placeholder="e.g. SaaS startup, uses HubSpot CRM, Resend for email, Supabase for data"
                rows={3}
                className="w-full text-xs rounded-lg px-3 py-2 resize-none outline-none"
                style={{
                  backgroundColor: '#12121e',
                  border: '1px solid #24243e',
                  color: '#e8e8f0',
                }}
              />
            </div>

            {error && (
              <p className="text-xs px-3 py-2 rounded-lg flex items-start gap-2" style={{ backgroundColor: '#2e1a1a', color: '#f87171' }}>
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                {error}
              </p>
            )}

            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
              style={{ backgroundColor: '#6c63ff', color: '#fff' }}
            >
              {loading
                ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
                : <><Zap size={14} /> Generate Workflow</>
              }
            </button>

            {result?.importUrl && (
              <a
                href={result.importUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium"
                style={{ backgroundColor: '#1a2e1a', color: '#22c55e' }}
              >
                <ExternalLink size={12} />
                Open in n8n
              </a>
            )}

            {/* Bridge info */}
            <div
              className="rounded-lg p-3 text-[10px] leading-relaxed"
              style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e', color: '#3d3d60' }}
            >
              <span style={{ color: '#55556a' }}>Priority routing:</span>{' '}
              n8n handles API-native steps first. Browser automation / scraping
              steps are automatically flagged and dispatched to OpenClaw.
            </div>
          </div>

          {/* Right: result */}
          <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
            {result ? (
              <div className="p-4 space-y-4">
                {/* Explanation */}
                <div>
                  <p className="text-xs font-medium mb-1" style={{ color: '#9090b0' }}>What this workflow does</p>
                  <p className="text-xs leading-relaxed" style={{ color: '#c8c8e0' }}>{result.explanation}</p>
                </div>

                {/* Gap analysis */}
                {result.gapAnalysis && (
                  <GapAnalysisPanel
                    gap={result.gapAnalysis}
                    onBridge={handleBridge}
                    bridging={bridging}
                    bridgeResult={bridgeResult}
                  />
                )}

                {/* Checklist */}
                <div>
                  <p className="text-xs font-medium mb-2" style={{ color: '#9090b0' }}>Setup checklist</p>
                  <ol className="space-y-1.5">
                    {result.checklist.map((step, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs" style={{ color: '#7070a0' }}>
                        <span
                          className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                          style={{ backgroundColor: '#1a1a2e', color: '#6c63ff' }}
                        >
                          {i + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>

                {/* JSON */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium" style={{ color: '#9090b0' }}>Workflow JSON</p>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md"
                      style={{ backgroundColor: '#12121e', color: copied ? '#22c55e' : '#9090b0' }}
                    >
                      {copied ? <Check size={11} /> : <Copy size={11} />}
                      {copied ? 'Copied' : 'Copy JSON'}
                    </button>
                  </div>
                  <pre
                    className="text-[10px] leading-relaxed overflow-x-auto p-3 rounded-lg font-mono"
                    style={{ backgroundColor: '#050508', color: '#7070a0', maxHeight: '300px' }}
                  >
                    {JSON.stringify(result.workflow, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center flex-1 p-8">
                <p className="text-xs text-center" style={{ color: '#24243e' }}>
                  Describe your automation on the left<br />and click Generate Workflow
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Import result toast ───────────────────────────────────────────────────────
function ImportToast({ template, onClose }: { template: WorkflowTemplate; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(JSON.stringify(template.workflow, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const n8nUrl = typeof window !== 'undefined'
    ? localStorage.getItem('n8n_base_url')
    : null

  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-80 rounded-xl p-4 shadow-xl"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #6c63ff' }}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
            {template.name}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#55556a' }}>
            Ready to import into n8n
          </p>
        </div>
        <button onClick={onClose} style={{ color: '#55556a' }}>
          <XCircle size={16} />
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium"
          style={{ backgroundColor: '#1a1a2e', color: copied ? '#22c55e' : '#9090b0' }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy JSON'}
        </button>
        {n8nUrl && (
          <a
            href={`${n8nUrl}/workflow/new`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium"
            style={{ backgroundColor: '#6c63ff', color: '#fff' }}
          >
            <ExternalLink size={12} />
            Open n8n
          </a>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function N8nPage() {
  const [activeCategory,  setActiveCategory]  = useState<string>('all')
  const [expandedId,      setExpandedId]       = useState<string | null>(null)
  const [importToast,     setImportToast]      = useState<WorkflowTemplate | null>(null)
  const [showGenerate,    setShowGenerate]     = useState(false)
  const [liveWorkflows,   setLiveWorkflows]    = useState<N8nWorkflowStatus[]>([])
  const [loadingLive,     setLoadingLive]      = useState(false)
  const [liveError,       setLiveError]        = useState('')
  const [togglingId,      setTogglingId]       = useState<string | null>(null)

  const filtered = activeCategory === 'all'
    ? WORKFLOW_TEMPLATES
    : WORKFLOW_TEMPLATES.filter(t => t.category === activeCategory)

  function toggleExpand(id: string) {
    setExpandedId(prev => (prev === id ? null : id))
  }

  function handleImport(template: WorkflowTemplate) {
    setImportToast(template)
    setTimeout(() => setImportToast(null), 12000)
  }

  const fetchLiveWorkflows = useCallback(async () => {
    setLoadingLive(true)
    setLiveError('')
    try {
      const res = await fetch('/api/n8n/workflows')
      if (!res.ok) throw new Error(`Status ${res.status}`)
      const data = await res.json() as { workflows: N8nWorkflowStatus[] }
      setLiveWorkflows(data.workflows ?? [])
    } catch (err) {
      setLiveError((err as Error).message)
    } finally {
      setLoadingLive(false)
    }
  }, [])

  async function handleToggle(id: string, activate: boolean) {
    setTogglingId(id)
    try {
      await fetch(`/api/n8n/workflows/${id}/${activate ? 'activate' : 'deactivate'}`, {
        method: 'POST',
      })
      await fetchLiveWorkflows()
    } catch {
      // ignore
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#050508' }}>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold mb-1" style={{ color: '#e8e8f0' }}>
            n8n Workflows
          </h1>
          <p className="text-sm" style={{ color: '#55556a' }}>
            8 pre-built automation blueprints + AI-powered custom workflow generator.
            Import JSON directly into your n8n instance.
          </p>
        </div>
        <button
          onClick={() => setShowGenerate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium shrink-0"
          style={{ backgroundColor: '#6c63ff', color: '#fff' }}
        >
          <Plus size={14} />
          Generate Custom
        </button>
      </div>

      {/* Live workflows section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
            Connected Instance
          </h2>
          <button
            onClick={fetchLiveWorkflows}
            disabled={loadingLive}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: '#12121e', color: '#9090b0' }}
          >
            <RefreshCw size={11} className={loadingLive ? 'animate-spin' : ''} />
            {loadingLive ? 'Loading…' : 'Load from n8n'}
          </button>
        </div>

        {liveError && (
          <div
            className="flex items-center gap-2 p-3 rounded-lg text-xs mb-3"
            style={{ backgroundColor: '#2e2818', color: '#fbbf24' }}
          >
            <AlertCircle size={13} />
            <span>
              {liveError.includes('404') || liveError.includes('503')
                ? 'n8n not connected — set N8N_BASE_URL and N8N_API_KEY in Doppler, then reload.'
                : `n8n error: ${liveError}`}
            </span>
          </div>
        )}

        {liveWorkflows.length > 0 ? (
          <div className="space-y-2">
            {liveWorkflows.map(wf => (
              <WorkflowRow
                key={wf.id}
                workflow={wf}
                onToggle={handleToggle}
                toggling={togglingId === wf.id}
              />
            ))}
          </div>
        ) : !loadingLive && !liveError ? (
          <div
            className="rounded-lg p-4 text-center"
            style={{ backgroundColor: '#0d0d14', border: '1px dashed #24243e' }}
          >
            <p className="text-xs" style={{ color: '#55556a' }}>
              Click &ldquo;Load from n8n&rdquo; to see your live workflows, or set{' '}
              <code style={{ color: '#6c63ff' }}>N8N_BASE_URL</code> +{' '}
              <code style={{ color: '#6c63ff' }}>N8N_API_KEY</code> in Doppler first.
            </p>
          </div>
        ) : null}
      </div>

      {/* Divider */}
      <div
        className="flex items-center gap-3 mb-5"
        style={{ borderTop: '1px solid #1a1a2e' }}
      >
        <span className="pt-3 text-xs font-medium" style={{ color: '#55556a' }}>
          PRE-BUILT TEMPLATES
        </span>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2 mb-5">
        {[{ id: 'all', label: 'All' }, ...WORKFLOW_CATEGORIES].map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
            style={{
              backgroundColor: activeCategory === cat.id ? '#6c63ff' : '#12121e',
              color:           activeCategory === cat.id ? '#fff'     : '#9090b0',
              border:          `1px solid ${activeCategory === cat.id ? '#6c63ff' : '#24243e'}`,
            }}
          >
            {cat.label}
          </button>
        ))}
        <span className="ml-auto text-xs self-center" style={{ color: '#55556a' }}>
          {filtered.length} template{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(template => (
          <TemplateCard
            key={template.id}
            template={template}
            onImport={handleImport}
            onExpand={toggleExpand}
            expanded={expandedId === template.id}
          />
        ))}
      </div>

      {/* Footer */}
      <p className="mt-8 text-xs text-center" style={{ color: '#24243e' }}>
        Requires <code style={{ color: '#55556a' }}>N8N_BASE_URL</code> +{' '}
        <code style={{ color: '#55556a' }}>N8N_API_KEY</code> in Doppler for live integration ·{' '}
        Webhook receiver at <code style={{ color: '#55556a' }}>/api/webhooks/n8n</code> ·{' '}
        Hybrid bridge at <code style={{ color: '#55556a' }}>/api/n8n/bridge</code>
      </p>

      {/* Modals */}
      {showGenerate && <GeneratePanel onClose={() => setShowGenerate(false)} />}
      {importToast  && <ImportToast template={importToast} onClose={() => setImportToast(null)} />}
    </div>
  )
}

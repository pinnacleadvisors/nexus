'use client'

import React, { useState, useRef } from 'react'
import {
  Workflow, Zap, Play, Loader2, X, Copy, Check,
  AlertCircle, Clock, TrendingUp, CheckCircle2,
  Bot, ArrowRight, Lightbulb, Globe,
} from 'lucide-react'
import { AGENT_CAPABILITIES } from '@/lib/agent-capabilities'

const CONSULTANT = AGENT_CAPABILITIES.find(c => c.id === 'consultant')!

// ── Types ─────────────────────────────────────────────────────────────────────

type Opportunity = {
  priority: number
  title: string
  description: string
  tools: string[]
  estimatedSetupMinutes: number
  monthlyCostSaving: string
  requiresOpenClaw: boolean
  rationale: string
  complexity: 'low' | 'medium' | 'high'
}

type ParsedResult = {
  businessSummary: string
  automationOpportunities: Opportunity[]
  openClawEscalations: string[]
  nextSteps: string[]
  totalEstimatedSavingHrs: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseResultJson(text: string): ParsedResult | null {
  try {
    const start = text.indexOf('{')
    if (start === -1) return null
    let depth = 0
    let i = start
    while (i < text.length) {
      if (text[i] === '{') depth++
      if (text[i] === '}') depth--
      if (depth === 0) return JSON.parse(text.slice(start, i + 1)) as ParsedResult
      i++
    }
    return null
  } catch { return null }
}

function ComplexityBadge({ complexity }: { complexity: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    low:    { bg: '#1a2e1a', color: '#22c55e' },
    medium: { bg: '#2e2818', color: '#fbbf24' },
    high:   { bg: '#2e1a1a', color: '#f87171' },
  }
  const s = map[complexity] ?? map.medium
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize"
      style={{ backgroundColor: s.bg, color: s.color }}>
      {complexity}
    </span>
  )
}

function OpportunityCard({ opp }: { opp: Opportunity }) {
  return (
    <div className="rounded-xl p-4 space-y-3 transition-all"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}>
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
          style={{ backgroundColor: '#2e2860', color: '#818cf8' }}>
          {opp.priority}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>{opp.title}</h3>
            <ComplexityBadge complexity={opp.complexity} />
            {opp.requiresOpenClaw && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: '#1a1a2e', color: '#818cf8' }}>
                <Bot size={8} className="inline mr-0.5" />OpenClaw
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed" style={{ color: '#9090b0' }}>{opp.description}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 pl-10">
        {opp.tools.map(t => (
          <span key={t} className="text-[10px] px-2 py-0.5 rounded"
            style={{ backgroundColor: '#12121e', color: '#7070a0' }}>
            {t}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-4 text-[11px] pl-10" style={{ color: '#55556a' }}>
        <span className="flex items-center gap-1">
          <Clock size={10} /> {opp.estimatedSetupMinutes}min setup
        </span>
        <span className="flex items-center gap-1">
          <TrendingUp size={10} /> {opp.monthlyCostSaving} saved/mo
        </span>
      </div>

      {opp.rationale && (
        <p className="text-[10px] leading-relaxed pl-10"
          style={{ color: '#3d3d60', borderTop: '1px solid #1a1a2e', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
          {opp.rationale}
        </p>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConsultantPage() {
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [rawOutput, setRawOutput] = useState('')
  const [parsed, setParsed] = useState<ParsedResult | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [sourceCount, setSourceCount] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const streamRef = useRef<HTMLDivElement>(null)

  function handleInput(key: string, value: string) {
    setInputs(prev => ({ ...prev, [key]: value }))
  }

  async function handleRun() {
    const required = CONSULTANT.inputs.filter(f => f.required)
    for (const field of required) {
      if (!inputs[field.key]?.trim()) {
        setError(`"${field.label}" is required.`)
        return
      }
    }
    setError('')
    setRawOutput('')
    setParsed(null)
    setDone(false)
    setRunning(true)
    setSourceCount(0)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilityId: 'consultant', inputs }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
        throw new Error(json.error ?? `Server error ${res.status}`)
      }

      const count = parseInt(res.headers.get('X-Tavily-Count') ?? '0', 10)
      if (count > 0) setSourceCount(count)

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk
        setRawOutput(buffer)
        requestAnimationFrame(() => {
          if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight
        })
      }

      setParsed(parseResultJson(buffer))
      setDone(true)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message ?? 'Something went wrong.')
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
    await navigator.clipboard.writeText(rawOutput)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const businessName = inputs.businessName?.trim() || 'your business'

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#07070f' }}>
      {/* Header */}
      <div className="shrink-0 px-6 py-5" style={{ borderBottom: '1px solid #24243e' }}>
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #6c63ff, #4c45cc)' }}>
            <Workflow size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold" style={{ color: '#e8e8f0' }}>Automation Consultant</h1>
            <p className="text-xs mt-0.5" style={{ color: '#55556a' }}>
              Identifies automation opportunities, maps to n8n workflows, flags OpenClaw steps, creates Board cards.
            </p>
          </div>
          {sourceCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{ backgroundColor: '#1a2e1a', color: '#4ade80' }}>
              <Globe size={11} />
              {sourceCount} live sources
            </div>
          )}
        </div>
      </div>

      {/* Body: form left, results right */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left: inputs ───────────────────────────────────────────────────── */}
        <div className="w-72 shrink-0 flex flex-col gap-4 p-5 overflow-y-auto"
          style={{ borderRight: '1px solid #24243e' }}>

          {CONSULTANT.inputs.map(field => (
            <div key={field.key}>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#9090b0' }}>
                {field.label}
                {field.required && <span style={{ color: '#f87171' }}> *</span>}
              </label>
              {field.multiline ? (
                <textarea
                  value={inputs[field.key] ?? ''}
                  onChange={e => handleInput(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  rows={3}
                  className="w-full text-xs rounded-lg px-3 py-2 resize-none outline-none"
                  style={{ backgroundColor: '#12121e', border: '1px solid #24243e', color: '#e8e8f0' }}
                />
              ) : (
                <input
                  type="text"
                  value={inputs[field.key] ?? ''}
                  onChange={e => handleInput(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full text-xs rounded-lg px-3 py-2 outline-none"
                  style={{ backgroundColor: '#12121e', border: '1px solid #24243e', color: '#e8e8f0' }}
                />
              )}
            </div>
          ))}

          {error && (
            <p className="text-xs px-3 py-2 rounded-lg flex items-start gap-2"
              style={{ backgroundColor: '#2e1a1a', color: '#f87171' }}>
              <AlertCircle size={12} className="shrink-0 mt-0.5" />{error}
            </p>
          )}

          {running ? (
            <button onClick={handleStop}
              className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium"
              style={{ backgroundColor: '#2e1a1a', color: '#f87171' }}>
              <X size={14} /> Stop
            </button>
          ) : (
            <button onClick={handleRun}
              className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{ background: 'linear-gradient(135deg, #6c63ff, #4c45cc)', color: '#fff' }}>
              <Play size={14} /> Run Analysis
            </button>
          )}

          {/* Info callout */}
          <div className="rounded-lg p-3 text-[10px] leading-relaxed space-y-1.5"
            style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e', color: '#3d3d60' }}>
            <p><span style={{ color: '#55556a' }}>Creates Board cards</span> for each automation opportunity.</p>
            <p><span style={{ color: '#55556a' }}>Live web research</span> via Tavily injected automatically.</p>
            <p><span style={{ color: '#55556a' }}>Report saved</span> to nexus-memory after completion.</p>
          </div>
        </div>

        {/* ── Right: results ─────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {!running && !done && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: '#12121e' }}>
                <Lightbulb size={22} style={{ color: '#6c63ff' }} />
              </div>
              <div>
                <p className="text-sm font-medium mb-1" style={{ color: '#e8e8f0' }}>
                  Ready to analyse {businessName}
                </p>
                <p className="text-xs" style={{ color: '#3d3d60' }}>
                  Fill in the form and click Run Analysis.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-2 w-full max-w-md">
                {['5–8 opportunities ranked', 'n8n workflow blueprints', 'Board cards created'].map(s => (
                  <div key={s} className="rounded-lg p-3 text-center"
                    style={{ backgroundColor: '#0d0d14', border: '1px solid #1a1a2e' }}>
                    <p className="text-[10px] leading-relaxed" style={{ color: '#55556a' }}>{s}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(running || (done && !parsed)) && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              {/* Stream header */}
              <div className="shrink-0 flex items-center gap-2 px-5 py-3"
                style={{ borderBottom: '1px solid #1a1a2e' }}>
                {running
                  ? <><Loader2 size={12} className="animate-spin" style={{ color: '#6c63ff' }} />
                    <span className="text-xs" style={{ color: '#55556a' }}>Analysing…</span></>
                  : <><CheckCircle2 size={12} style={{ color: '#22c55e' }} />
                    <span className="text-xs" style={{ color: '#55556a' }}>Complete</span></>
                }
                {done && (
                  <button onClick={handleCopy}
                    className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs"
                    style={{ backgroundColor: '#12121e', color: '#7070a0' }}>
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
              <div ref={streamRef} className="flex-1 overflow-y-auto p-5">
                <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono"
                  style={{ color: '#c8c8e0' }}>
                  {rawOutput}
                </pre>
              </div>
            </div>
          )}

          {done && parsed && (
            <div className="flex-1 overflow-y-auto">
              {/* Summary bar */}
              <div className="sticky top-0 z-10 px-5 py-3 flex items-center gap-4"
                style={{ backgroundColor: '#0d0d14', borderBottom: '1px solid #1a1a2e' }}>
                <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
                <span className="text-xs font-medium" style={{ color: '#e8e8f0' }}>
                  {parsed.automationOpportunities.length} opportunities identified
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: '#1a2e1a', color: '#22c55e' }}>
                  ~{parsed.totalEstimatedSavingHrs}hrs/mo saved
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={handleCopy}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs"
                    style={{ backgroundColor: '#12121e', color: '#7070a0' }}>
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    {copied ? 'Copied' : 'Copy report'}
                  </button>
                  <button onClick={() => { setDone(false); setRawOutput(''); setParsed(null) }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs"
                    style={{ backgroundColor: '#12121e', color: '#7070a0' }}>
                    <ArrowRight size={11} /> New analysis
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-5">
                {/* Business summary */}
                <div className="rounded-xl p-4"
                  style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}>
                  <p className="text-xs font-medium mb-1" style={{ color: '#55556a' }}>Business summary</p>
                  <p className="text-sm leading-relaxed" style={{ color: '#c8c8e0' }}>{parsed.businessSummary}</p>
                </div>

                {/* Opportunities */}
                <div>
                  <p className="text-xs font-medium mb-3" style={{ color: '#9090b0' }}>
                    Automation Opportunities — ranked by impact × ease
                  </p>
                  <div className="space-y-3">
                    {parsed.automationOpportunities.map(opp => (
                      <OpportunityCard key={opp.priority} opp={opp} />
                    ))}
                  </div>
                </div>

                {/* OpenClaw escalations */}
                {parsed.openClawEscalations.length > 0 && (
                  <div className="rounded-xl p-4"
                    style={{ backgroundColor: '#0d0d14', border: '1px solid #2e2860' }}>
                    <p className="text-xs font-medium mb-2 flex items-center gap-1.5"
                      style={{ color: '#818cf8' }}>
                      <Bot size={12} /> Steps requiring OpenClaw browser automation
                    </p>
                    <ul className="space-y-1.5">
                      {parsed.openClawEscalations.map((step, i) => (
                        <li key={i} className="text-xs flex items-start gap-2" style={{ color: '#7070a0' }}>
                          <ArrowRight size={11} className="shrink-0 mt-0.5" style={{ color: '#818cf8' }} />
                          {step}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Next steps */}
                {parsed.nextSteps.length > 0 && (
                  <div className="rounded-xl p-4"
                    style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}>
                    <p className="text-xs font-medium mb-2" style={{ color: '#9090b0' }}>Next steps</p>
                    <ol className="space-y-1.5">
                      {parsed.nextSteps.map((step, i) => (
                        <li key={i} className="text-xs flex items-start gap-2" style={{ color: '#7070a0' }}>
                          <span className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                            style={{ backgroundColor: '#1a1a2e', color: '#6c63ff' }}>
                            {i + 1}
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Board confirmation */}
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs"
                  style={{ backgroundColor: '#1a2e1a', color: '#22c55e' }}>
                  <CheckCircle2 size={13} />
                  Board cards created — check your Kanban board for automation tasks.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

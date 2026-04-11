'use client'

import { useState, useRef } from 'react'
import {
  FlaskConical, PenLine, Code2, SearchCode, Share2,
  HeadphonesIcon, Mail, Palette, BarChart3, Scale,
  Play, X, ChevronRight, Copy, Check, Loader2,
} from 'lucide-react'
import { AGENT_CAPABILITIES, CAPABILITY_CATEGORIES, type AgentCapability } from '@/lib/agent-capabilities'

// ── Icon map ──────────────────────────────────────────────────────────────────
const ICONS: Record<string, React.ElementType> = {
  FlaskConical, PenLine, Code2, SearchCode, Share2,
  HeadphonesIcon, Mail, Palette, BarChart3, Scale,
}

// ── Category badge colours ────────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  research:  { bg: '#1a2e1a', text: '#4ade80' },
  content:   { bg: '#1a1a2e', text: '#818cf8' },
  code:      { bg: '#1a2428', text: '#22d3ee' },
  marketing: { bg: '#2e1a2e', text: '#c084fc' },
  finance:   { bg: '#2e2818', text: '#fbbf24' },
  legal:     { bg: '#2e1a1a', text: '#f87171' },
}

// ── Sub-components ────────────────────────────────────────────────────────────
function CapabilityCard({
  cap,
  onLaunch,
}: {
  cap: AgentCapability
  onLaunch: (cap: AgentCapability) => void
}) {
  const Icon = ICONS[cap.icon] ?? Play
  const col  = CATEGORY_COLORS[cap.category] ?? { bg: '#1a1a2e', text: '#9090b0' }
  const catLabel = CAPABILITY_CATEGORIES.find(c => c.id === cap.category)?.label ?? cap.category

  return (
    <div
      className="group relative flex flex-col gap-3 rounded-xl p-4 transition-all cursor-pointer"
      style={{
        backgroundColor: '#0d0d14',
        border: '1px solid #24243e',
      }}
      onClick={() => onLaunch(cap)}
    >
      {/* Icon + category */}
      <div className="flex items-start justify-between">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: col.bg }}
        >
          <Icon size={18} style={{ color: col.text }} />
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: col.bg, color: col.text }}
        >
          {catLabel}
        </span>
      </div>

      {/* Name + description */}
      <div>
        <h3 className="text-sm font-semibold mb-1" style={{ color: '#e8e8f0' }}>
          {cap.name}
        </h3>
        <p className="text-xs leading-relaxed" style={{ color: '#9090b0' }}>
          {cap.description}
        </p>
      </div>

      {/* Footer badges */}
      <div className="flex items-center gap-2 mt-auto pt-2" style={{ borderTop: '1px solid #1a1a2e' }}>
        {cap.savesToNotion && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#12121e', color: '#55556a' }}>
            → Notion
          </span>
        )}
        {cap.createsBoardCard && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#12121e', color: '#55556a' }}>
            → Board
          </span>
        )}
        {cap.usesOpenClaw && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#12121e', color: '#6c63ff' }}>
            → OpenClaw
          </span>
        )}
        {/* Launch arrow */}
        <ChevronRight
          size={14}
          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: '#6c63ff' }}
        />
      </div>
    </div>
  )
}

// ── Launch panel ──────────────────────────────────────────────────────────────
function LaunchPanel({
  cap,
  onClose,
}: {
  cap: AgentCapability
  onClose: () => void
}) {
  const [inputs, setInputs]       = useState<Record<string, string>>({})
  const [output, setOutput]       = useState('')
  const [running, setRunning]     = useState(false)
  const [done, setDone]           = useState(false)
  const [error, setError]         = useState('')
  const [copied, setCopied]       = useState(false)
  const abortRef                  = useRef<AbortController | null>(null)
  const outputRef                 = useRef<HTMLPreElement>(null)

  const Icon = ICONS[cap.icon] ?? Play
  const col  = CATEGORY_COLORS[cap.category] ?? { bg: '#1a1a2e', text: '#9090b0' }

  function handleInput(key: string, value: string) {
    setInputs(prev => ({ ...prev, [key]: value }))
  }

  async function handleRun() {
    const required = cap.inputs.filter(f => f.required)
    for (const field of required) {
      if (!inputs[field.key]?.trim()) {
        setError(`"${field.label}" is required.`)
        return
      }
    }

    setError('')
    setOutput('')
    setDone(false)
    setRunning(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilityId: cap.id,
          inputs,
          notionPageId:
            typeof window !== 'undefined'
              ? (localStorage.getItem('knowledge:notion:default') ?? undefined)
              : undefined,
        }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
        throw new Error(json.error ?? `Server error ${res.status}`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        const chunk = decoder.decode(value, { stream: true })
        setOutput(prev => {
          const next = prev + chunk
          // Auto-scroll
          requestAnimationFrame(() => {
            if (outputRef.current) {
              outputRef.current.scrollTop = outputRef.current.scrollHeight
            }
          })
          return next
        })
      }

      setDone(true)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message ?? 'Something went wrong.')
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
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(5,5,8,0.85)' }}
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid #24243e' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: col.bg }}
          >
            <Icon size={16} style={{ color: col.text }} />
          </div>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>{cap.name}</h2>
            <p className="text-xs" style={{ color: '#55556a' }}>Fill in the context and run the agent</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg transition-colors hover:bg-[#1a1a2e]"
            style={{ color: '#55556a' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: inputs */}
          <div
            className="w-72 shrink-0 flex flex-col gap-3 p-4 overflow-y-auto"
            style={{ borderRight: '1px solid #24243e' }}
          >
            {cap.inputs.map(field => (
              <div key={field.key}>
                <label className="block text-xs font-medium mb-1" style={{ color: '#9090b0' }}>
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
                    style={{
                      backgroundColor: '#12121e',
                      border: '1px solid #24243e',
                      color: '#e8e8f0',
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    value={inputs[field.key] ?? ''}
                    onChange={e => handleInput(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full text-xs rounded-lg px-3 py-2 outline-none"
                    style={{
                      backgroundColor: '#12121e',
                      border: '1px solid #24243e',
                      color: '#e8e8f0',
                    }}
                  />
                )}
              </div>
            ))}

            {error && (
              <p className="text-xs rounded-lg px-3 py-2" style={{ backgroundColor: '#2e1a1a', color: '#f87171' }}>
                {error}
              </p>
            )}

            <div className="mt-auto pt-2 flex flex-col gap-2">
              {!running ? (
                <button
                  onClick={handleRun}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  style={{ backgroundColor: '#6c63ff', color: '#fff' }}
                >
                  <Play size={14} />
                  Run Agent
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium"
                  style={{ backgroundColor: '#ef4444', color: '#fff' }}
                >
                  <X size={14} />
                  Stop
                </button>
              )}
            </div>
          </div>

          {/* Right: output */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Output toolbar */}
            <div
              className="shrink-0 flex items-center justify-between px-4 py-2"
              style={{ borderBottom: '1px solid #1a1a2e' }}
            >
              <span className="text-xs" style={{ color: '#55556a' }}>
                {running ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={11} className="animate-spin" style={{ color: '#6c63ff' }} />
                    Generating…
                  </span>
                ) : done ? (
                  <span style={{ color: '#22c55e' }}>✓ Complete — board card created</span>
                ) : (
                  'Output will appear here'
                )}
              </span>
              {output && (
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors"
                  style={{ backgroundColor: '#12121e', color: copied ? '#22c55e' : '#9090b0' }}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>

            {/* Output area */}
            <pre
              ref={outputRef}
              className="flex-1 overflow-y-auto p-4 text-xs leading-relaxed whitespace-pre-wrap font-mono"
              style={{ color: '#c8c8e0' }}
            >
              {output || (
                <span style={{ color: '#24243e' }}>
                  {`Fill in the form and click "Run Agent" to generate your ${cap.name} document.`}
                </span>
              )}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AgentsPage() {
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [activeCap, setActiveCap]           = useState<AgentCapability | null>(null)

  const filtered =
    activeCategory === 'all'
      ? AGENT_CAPABILITIES
      : AGENT_CAPABILITIES.filter(c => c.category === activeCategory)

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#050508' }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold mb-1" style={{ color: '#e8e8f0' }}>
          Agent Capabilities
        </h1>
        <p className="text-sm" style={{ color: '#55556a' }}>
          10 specialised AI agents — each produces a full deliverable document, saves to your knowledge base, and creates a Review card on the board.
        </p>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[{ id: 'all', label: 'All' }, ...CAPABILITY_CATEGORIES].map(cat => (
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
          {filtered.length} agent{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Capability grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map(cap => (
          <CapabilityCard key={cap.id} cap={cap} onLaunch={setActiveCap} />
        ))}
      </div>

      {/* Info footer */}
      <p className="mt-8 text-xs text-center" style={{ color: '#24243e' }}>
        Requires <code style={{ color: '#55556a' }}>ANTHROPIC_API_KEY</code> in Doppler · Results saved to board Review column + linked Notion page
      </p>

      {/* Launch panel overlay */}
      {activeCap && (
        <LaunchPanel
          cap={activeCap}
          onClose={() => setActiveCap(null)}
        />
      )}
    </div>
  )
}

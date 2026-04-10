'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useChat, Chat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { UIMessage } from 'ai'
import { Send, Square, Settings2 } from 'lucide-react'
import type { Milestone, ModelConfig } from '@/lib/types'
import { ADVISOR_MODELS, DEFAULT_MODEL_CONFIG } from '@/lib/types'
import ChatMessages from '@/components/forge/ChatMessages'
import MilestoneTimeline from '@/components/forge/MilestoneTimeline'
import GanttChart from '@/components/forge/GanttChart'
import ForgeActionBar from '@/components/forge/ForgeActionBar'
import ModelSelector from '@/components/forge/ModelSelector'

// ── localStorage helpers ──────────────────────────────────────────────────────
function loadMessages(projectId: string): UIMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(`forge:msgs:${projectId}`)
    return raw ? (JSON.parse(raw) as UIMessage[]) : []
  } catch {
    return []
  }
}

function saveMessages(projectId: string, messages: UIMessage[]) {
  try {
    localStorage.setItem(`forge:msgs:${projectId}`, JSON.stringify(messages))
  } catch {}
}

function loadMilestones(projectId: string): Milestone[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(`forge:miles:${projectId}`)
    return raw ? (JSON.parse(raw) as Milestone[]) : []
  } catch {
    return []
  }
}

function saveMilestones(projectId: string, milestones: Milestone[]) {
  try {
    localStorage.setItem(`forge:miles:${projectId}`, JSON.stringify(milestones))
  } catch {}
}

function loadModelConfig(projectId: string): ModelConfig {
  if (typeof window === 'undefined') return DEFAULT_MODEL_CONFIG
  try {
    const raw = localStorage.getItem(`forge:models:${projectId}`)
    return raw ? (JSON.parse(raw) as ModelConfig) : DEFAULT_MODEL_CONFIG
  } catch {
    return DEFAULT_MODEL_CONFIG
  }
}

function saveModelConfig(projectId: string, config: ModelConfig) {
  try {
    localStorage.setItem(`forge:models:${projectId}`, JSON.stringify(config))
  } catch {}
}

// ── Rough token estimate (1 token ≈ 4 chars) ─────────────────────────────────
function estimateTokens(messages: UIMessage[]): number {
  const totalChars = messages.reduce((sum, m) => {
    const text = m.parts
      .filter(p => p.type === 'text')
      .map(p => (p as { type: 'text'; text: string }).text)
      .join('')
    return sum + text.length
  }, 0)
  return Math.round(totalChars / 4)
}

// ── PDF export ────────────────────────────────────────────────────────────────
const PHASE_LABELS: Record<number, string> = {
  1: 'Foundation',
  2: 'Build',
  3: 'Launch',
  4: 'Growth',
}

function exportBusinessPlanPdf(projectName: string, milestones: Milestone[], agentCount: number) {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const estimatedCost = agentCount * 500

  const byPhase = milestones.reduce<Record<number, Milestone[]>>((acc, m) => {
    if (!acc[m.phase]) acc[m.phase] = []
    acc[m.phase].push(m)
    return acc
  }, {})

  const phaseSections = Object.entries(byPhase)
    .map(([phase, items]) => {
      const label = PHASE_LABELS[Number(phase)] ?? 'Other'
      const cards = items
        .map(
          m => `
        <div class="milestone">
          <h3>${m.title}</h3>
          <p>${m.description}</p>
          ${m.targetDate ? `<div class="date">Target: ${m.targetDate}</div>` : ''}
        </div>`,
        )
        .join('')
      return `<h2>Phase ${phase} — ${label}</h2>${cards}`
    })
    .join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${projectName} — Business Plan</title>
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; max-width: 800px; margin: 0 auto; padding: 48px 40px; color: #1a1a2e; }
    h1 { font-size: 30px; color: #1a1a2e; border-bottom: 3px solid #6c63ff; padding-bottom: 12px; margin-bottom: 4px; }
    .meta { color: #666; font-size: 13px; margin-bottom: 40px; }
    h2 { font-size: 17px; color: #6c63ff; margin-top: 36px; margin-bottom: 12px; font-family: system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.05em; }
    .milestone { margin: 12px 0; padding: 16px 20px; border-left: 4px solid #6c63ff; background: #f8f8ff; page-break-inside: avoid; }
    .milestone h3 { margin: 0 0 6px; font-size: 15px; color: #1a1a2e; }
    .milestone p { margin: 0; color: #444; font-size: 14px; line-height: 1.5; }
    .milestone .date { font-size: 12px; color: #888; margin-top: 8px; font-family: monospace; }
    .footer { margin-top: 60px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 12px; color: #999; }
    @media print { @page { margin: 1.5cm; } body { padding: 0; } }
  </style>
</head>
<body>
  <h1>${projectName}</h1>
  <div class="meta">Business Plan · Generated ${today} · ${agentCount} agent${agentCount !== 1 ? 's' : ''} · Est. $${estimatedCost.toLocaleString()}/mo</div>
  ${phaseSections}
  <div class="footer">Generated by Nexus · nexus.pinnacleadvisors.com</div>
  <script>setTimeout(function(){ window.print(); }, 400);<\/script>
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) {
    alert('Please allow pop-ups to export the business plan as PDF.')
    return
  }
  win.document.write(html)
  win.document.close()
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  projectId: string
  projectName: string
}

export default function ForgeSession({ projectId, projectName }: Props) {
  const [agentCount, setAgentCount]     = useState(3)
  const [showGantt, setShowGantt]       = useState(false)
  const [input, setInput]               = useState('')
  const [showModelSelector, setShowModelSelector] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modelSelectorRef = useRef<HTMLDivElement>(null)

  // ── Model config ──────────────────────────────────────────────────────────
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() => loadModelConfig(projectId))

  // Ref so the custom fetch interceptor always reads the latest value
  const modelConfigRef = useRef(modelConfig)
  useEffect(() => {
    modelConfigRef.current = modelConfig
    saveModelConfig(projectId, modelConfig)
  }, [modelConfig, projectId])

  // ── Milestones ────────────────────────────────────────────────────────────
  const [milestones, setMilestones] = useState<Milestone[]>(() => loadMilestones(projectId))

  // ── Chat setup ────────────────────────────────────────────────────────────
  const chat = useMemo(
    () => new Chat({ messages: loadMessages(projectId) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // only once — parent re-keys this component when projectId changes
  )

  // Custom transport that injects model config into every request body
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        fetch: async (url, init) => {
          const body = JSON.parse((init?.body as string) ?? '{}')
          body.advisorModel  = modelConfigRef.current.advisorModel
          body.executorModel = modelConfigRef.current.executorModel
          return globalThis.fetch(url, { ...init, body: JSON.stringify(body) })
        },
      }),
    [], // created once; reads from ref dynamically
  )

  const { messages, sendMessage, status, stop, error } = useChat({ chat, transport })

  // ── Persistence ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (messages.length > 0) saveMessages(projectId, messages)
  }, [messages, projectId])

  useEffect(() => {
    saveMilestones(projectId, milestones)
  }, [milestones, projectId])

  // ── Milestone extraction ──────────────────────────────────────────────────
  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') return
    const lastMsg = messages.at(-1)
    if (!lastMsg || lastMsg.role !== 'assistant') return

    const text = lastMsg.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map(p => p.text)
      .join('')

    const match = text.match(/<milestones>([\s\S]*?)<\/milestones>/)
    if (!match) return

    try {
      const parsed: Milestone[] = JSON.parse(match[1])
      setMilestones(prev => {
        const existingIds = new Set(prev.map(m => m.id))
        const newOnes = parsed.filter(m => !existingIds.has(m.id))
        return newOnes.length > 0 ? [...prev, ...newOnes] : prev
      })
    } catch {
      // Malformed JSON — ignore
    }
  }, [messages, status])

  // ── Close model selector on outside click ─────────────────────────────────
  useEffect(() => {
    if (!showModelSelector) return
    function handler(e: MouseEvent) {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node)) {
        setShowModelSelector(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModelSelector])

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || status === 'streaming' || status === 'submitted') return
    sendMessage({ text: trimmed })
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const isStreaming   = status === 'streaming' || status === 'submitted'
  const advisorLabel  = ADVISOR_MODELS.find(m => m.id === modelConfig.advisorModel)?.label ?? 'Opus 4.6'
  const estimatedToks = estimateTokens(messages)
  const isCompressed  = messages.length > 20 // matches server-side MSG_THRESHOLD

  return (
    <div className="flex flex-1 min-h-0">
      {/* ── Left panel: Chat ──────────────────────────────────────────── */}
      <div className="w-1/2 flex flex-col" style={{ borderRight: '1px solid #24243e' }}>

        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between px-4 h-12"
          style={{ borderBottom: '1px solid #24243e', backgroundColor: '#0d0d14' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
              Consulting Agent
            </span>
            {/* Token count */}
            {messages.length > 0 && (
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: '#12121e',
                  color: isCompressed ? '#f59e0b' : '#55556a',
                  border: `1px solid ${isCompressed ? '#f59e0b44' : '#24243e'}`,
                  fontVariantNumeric: 'tabular-nums',
                }}
                title={isCompressed ? 'Sliding window active — older messages compressed' : 'Estimated session tokens'}
              >
                ~{estimatedToks.toLocaleString()} tok{isCompressed ? ' 🗜' : ''}
              </span>
            )}
          </div>

          {/* Model selector toggle */}
          <div className="flex items-center gap-2" ref={modelSelectorRef}>
            <button
              onClick={() => setShowModelSelector(s => !s)}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-colors"
              style={{
                backgroundColor: showModelSelector ? '#1a1a2e' : 'transparent',
                color: '#6c63ff',
                border: '1px solid #24243e',
              }}
              title="Configure advisor & executor models"
            >
              <Settings2 size={11} />
              <span className="text-xs">{advisorLabel}</span>
            </button>

            {showModelSelector && (
              <ModelSelector
                config={modelConfig}
                onChange={config => {
                  setModelConfig(config)
                  setShowModelSelector(false)
                }}
                onClose={() => setShowModelSelector(false)}
              />
            )}
          </div>
        </div>

        {/* Messages */}
        <ChatMessages messages={messages} status={status} error={error} />

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="shrink-0 p-3"
          style={{ borderTop: '1px solid #24243e', backgroundColor: '#0d0d14' }}
        >
          <div
            className="flex items-end gap-2 rounded-xl px-3 py-2"
            style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your business idea..."
              rows={1}
              disabled={isStreaming}
              className="flex-1 bg-transparent resize-none text-sm outline-none py-1"
              style={{ color: '#e8e8f0', maxHeight: '120px', minHeight: '24px' }}
            />
            <button
              type={isStreaming ? 'button' : 'submit'}
              onClick={isStreaming ? stop : undefined}
              className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
              style={{
                backgroundColor: isStreaming ? '#ef4444' : input.trim() ? '#6c63ff' : '#1a1a2e',
                cursor: input.trim() || isStreaming ? 'pointer' : 'default',
              }}
            >
              {isStreaming ? <Square size={13} className="text-white" /> : <Send size={13} className="text-white" />}
            </button>
          </div>
          <p className="text-xs mt-1.5 text-center" style={{ color: '#55556a' }}>
            Enter to send · Shift+Enter for new line
          </p>
        </form>
      </div>

      {/* ── Right panel: Timeline / Gantt ─────────────────────────── */}
      <div className="w-1/2 flex flex-col">
        <div
          className="shrink-0 flex items-center justify-between px-4 h-12"
          style={{ borderBottom: '1px solid #24243e', backgroundColor: '#0d0d14' }}
        >
          <span className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
            {showGantt ? 'Project Gantt' : 'Milestones'}
          </span>
          {milestones.length > 0 && (
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ backgroundColor: '#1a1a2e', color: '#22c55e', border: '1px solid #24243e' }}
            >
              {milestones.length} milestone{milestones.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {showGantt ? (
          <GanttChart milestones={milestones} />
        ) : (
          <MilestoneTimeline milestones={milestones} />
        )}

        <ForgeActionBar
          agentCount={agentCount}
          setAgentCount={setAgentCount}
          onLaunch={() => setShowGantt(s => !s)}
          milestonesReady={milestones.length > 0}
          showGantt={showGantt}
          milestones={milestones}
          onExportPdf={() => exportBusinessPlanPdf(projectName, milestones, agentCount)}
        />
      </div>
    </div>
  )
}

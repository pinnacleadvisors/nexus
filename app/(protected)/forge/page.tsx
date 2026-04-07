'use client'

import { useState, useEffect, useRef } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Send, Square } from 'lucide-react'
import type { Milestone } from '@/lib/types'
import ChatMessages from '@/components/forge/ChatMessages'
import MilestoneTimeline from '@/components/forge/MilestoneTimeline'
import GanttChart from '@/components/forge/GanttChart'
import ForgeActionBar from '@/components/forge/ForgeActionBar'

export default function ForgePage() {
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [agentCount, setAgentCount] = useState(3)
  const [showGantt, setShowGantt] = useState(false)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { messages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  })

  // Extract milestones from completed assistant messages
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

  const isStreaming = status === 'streaming' || status === 'submitted'

  return (
    <div className="flex h-full" style={{ backgroundColor: '#050508' }}>
      {/* ── Left panel: Chat ──────────────────────────────────────────── */}
      <div
        className="w-1/2 flex flex-col"
        style={{ borderRight: '1px solid #24243e' }}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between px-4 h-12"
          style={{ borderBottom: '1px solid #24243e', backgroundColor: '#0d0d14' }}
        >
          <span className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
            Consulting Agent
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ backgroundColor: '#1a1a2e', color: '#6c63ff', border: '1px solid #24243e' }}
          >
            Claude Sonnet
          </span>
        </div>

        {/* Messages */}
        <ChatMessages messages={messages} status={status} />

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
              style={{
                color: '#e8e8f0',
                maxHeight: '120px',
                minHeight: '24px',
              }}
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
              {isStreaming ? (
                <Square size={13} className="text-white" />
              ) : (
                <Send size={13} className="text-white" />
              )}
            </button>
          </div>
          <p className="text-xs mt-1.5 text-center" style={{ color: '#55556a' }}>
            Enter to send · Shift+Enter for new line
          </p>
        </form>
      </div>

      {/* ── Right panel: Timeline / Gantt ────────────────────────────── */}
      <div className="w-1/2 flex flex-col">
        {/* Header */}
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
        />
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import type { UIMessage } from 'ai'
import { Bot, User, AlertTriangle } from 'lucide-react'

function stripMilestones(text: string) {
  return text.replace(/<milestones>[\s\S]*?<\/milestones>/g, '').trim()
}

interface Props {
  messages: UIMessage[]
  status: string
  error?: Error
}

export default function ChatMessages({ messages, status, error }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: '#1a1a2e', border: '1px solid #24243e' }}
        >
          <Bot size={28} style={{ color: '#6c63ff' }} />
        </div>
        <div>
          <h3 className="font-semibold text-lg mb-1" style={{ color: '#e8e8f0' }}>
            Start with your idea
          </h3>
          <p className="text-sm max-w-xs" style={{ color: '#9090b0' }}>
            Describe your business idea — the consulting agent will help you refine it, identify gaps, and build a roadmap.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map(message => {
        const isUser = message.role === 'user'
        const text = message.parts
          .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
          .map(p => p.text)
          .join('')
        const displayText = isUser ? text : stripMilestones(text)

        if (!displayText && !isUser) return null

        return (
          <div
            key={message.id}
            className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {/* Avatar */}
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{
                backgroundColor: isUser ? '#6c63ff' : '#1a1a2e',
                border: isUser ? 'none' : '1px solid #24243e',
              }}
            >
              {isUser ? (
                <User size={14} className="text-white" />
              ) : (
                <Bot size={14} style={{ color: '#6c63ff' }} />
              )}
            </div>

            {/* Bubble */}
            <div
              className="max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
              style={
                isUser
                  ? { backgroundColor: '#6c63ff', color: '#fff' }
                  : { backgroundColor: '#12121e', color: '#e8e8f0', border: '1px solid #24243e' }
              }
            >
              {displayText}
            </div>
          </div>
        )
      })}

      {/* Error banner */}
      {error && (
        <div
          className="flex gap-3 items-start rounded-xl px-4 py-3"
          style={{ backgroundColor: '#2e0d0d', border: '1px solid #ef444433' }}
        >
          <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
          <div className="text-sm" style={{ color: '#ef4444' }}>
            <span className="font-semibold">Error — </span>
            {error.message.includes('500') || error.message.includes('Internal server error')
              ? 'The AI provider is temporarily unavailable. Please try again.'
              : error.message}
          </div>
        </div>
      )}

      {/* Streaming indicator */}
      {status === 'submitted' && (
        <div className="flex gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: '#1a1a2e', border: '1px solid #24243e' }}
          >
            <Bot size={14} style={{ color: '#6c63ff' }} />
          </div>
          <div
            className="rounded-2xl px-4 py-3 flex items-center gap-1"
            style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
          >
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full animate-bounce"
                style={{
                  backgroundColor: '#6c63ff',
                  animationDelay: `${i * 150}ms`,
                  animationDuration: '800ms',
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

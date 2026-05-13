'use client'

/**
 * ToolCallCard — Phase 2b of task_plan-chat.md.
 *
 * Inline card rendered for each tool call the agent made during a turn.
 * Collapsed by default showing tool name + first-line args; click to
 * expand and see full input + output (JSON-formatted). Lets the operator
 * see "what Claude actually did" without scrolling through chunky inline
 * tool-result text.
 *
 * Receives ToolCall records from /api/platform-chat/poll which forwards
 * them from the claude-gateway's job-store (services/claude-gateway/src/
 * spawn.ts captures tool_use + tool_result CLI events).
 */

import { useState } from 'react'
import { ChevronRight, ChevronDown, Wrench, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { ToolCall } from '@/lib/claw/gateway-jobs'

interface Props {
  call: ToolCall
}

export default function ToolCallCard({ call }: Props) {
  const [open, setOpen] = useState(false)
  const pending = !call.finishedAt
  const elapsedMs = call.finishedAt ? call.finishedAt - call.startedAt : null

  // Friendly display name — strip the `mcp__server__` prefix when present
  // so the operator sees the tool action, not the plumbing.
  const friendly = call.name.replace(/^mcp__[^_]+__/, '')

  // First-line preview of input — args are usually a small dict but can
  // get long. Cap at ~80 chars in the collapsed view.
  const inputPreview = typeof call.input === 'string'
    ? call.input.slice(0, 80)
    : (() => {
        try {
          const s = JSON.stringify(call.input)
          return s.length > 80 ? s.slice(0, 77) + '…' : s
        } catch { return '(unserializable args)' }
      })()

  return (
    <div
      className="rounded-lg my-2 text-xs overflow-hidden"
      style={{
        background:           'rgba(255,255,255,0.02)',
        border:               `1px solid ${call.isError ? 'rgba(239,68,68,0.30)' : 'rgba(255,255,255,0.08)'}`,
        backdropFilter:       'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
        style={{ color: '#c8c8d8' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {call.isError
          ? <AlertTriangle size={11} style={{ color: '#fca5a5' }} />
          : pending
            ? <Wrench         size={11} style={{ color: '#a8a3ff' }} />
            : <CheckCircle2   size={11} style={{ color: '#22c55e' }} />}
        <span className="font-mono font-semibold shrink-0" style={{ color: call.isError ? '#fca5a5' : '#e8e8f0' }}>{friendly}</span>
        <span className="font-mono truncate min-w-0 opacity-60">{inputPreview}</span>
        {elapsedMs !== null && (
          <span className="font-mono text-[10px] shrink-0 opacity-50">{elapsedMs}ms</span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <div className="font-mono uppercase tracking-wider text-[10px] mb-1" style={{ color: '#55556a' }}>Input</div>
            <pre className="overflow-x-auto rounded px-2 py-1.5 text-[11px]" style={{ background: 'rgba(0,0,0,0.30)', color: '#9090b0' }}>
              {safeStringify(call.input)}
            </pre>
          </div>
          {call.output !== undefined && (
            <div>
              <div className="font-mono uppercase tracking-wider text-[10px] mb-1" style={{ color: '#55556a' }}>
                {call.isError ? 'Output (error)' : 'Output'}
              </div>
              <pre className="overflow-x-auto rounded px-2 py-1.5 text-[11px]" style={{ background: 'rgba(0,0,0,0.30)', color: call.isError ? '#fca5a5' : '#9090b0' }}>
                {safeStringify(call.output)}
              </pre>
            </div>
          )}
          {pending && (
            <div className="text-[11px] italic" style={{ color: '#9090b0' }}>(still pending — output will land when the tool returns)</div>
          )}
        </div>
      )}
    </div>
  )
}

function safeStringify(v: unknown): string {
  if (typeof v === 'string') return v
  try { return JSON.stringify(v, null, 2) }
  catch { return String(v) }
}

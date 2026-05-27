'use client'

/**
 * RetrospectiveBanner — R9 follow-up.
 *
 * Renders the 1-paragraph LLM-generated retrospective at the top of a
 * chat session's message pane when present. Lets the operator see
 * "what we decided last time" the moment they reopen a stale session
 * instead of scrolling 50 messages back.
 *
 * The retrospective is written by the daily /api/cron/chat-retrospectives
 * job (migration 092) — sessions inactive ≥ 7 days get a one-paragraph
 * summary persisted to chat_sessions.retrospective_md.
 *
 * Shared between BusinessChat + PlatformChat so both views render the
 * banner identically.
 */

import { useState } from 'react'
import { History, ChevronDown, ChevronUp } from 'lucide-react'

interface Props {
  retrospective:  string | null | undefined
  generatedAt?:   string | null
}

export default function RetrospectiveBanner({ retrospective, generatedAt }: Props) {
  const [expanded, setExpanded] = useState(true)
  if (!retrospective || retrospective.trim().length === 0) return null

  const age = generatedAt ? formatGeneratedAge(generatedAt) : null

  return (
    <div
      className="rounded-xl px-4 py-3 mb-3"
      style={{
        background:  'linear-gradient(135deg, rgba(108,99,255,0.08), rgba(13,13,20,0.55))',
        border:      '1px solid rgba(108,99,255,0.25)',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={expanded}
      >
        <History size={14} style={{ color: '#a8a3ff' }} />
        <span className="text-xs font-medium" style={{ color: '#c4b5fd' }}>
          What we decided last time
        </span>
        {age && (
          <span className="text-[10px]" style={{ color: '#55556a' }}>
            · {age}
          </span>
        )}
        <span className="ml-auto" style={{ color: '#9090b0' }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {expanded && (
        <p className="mt-2 text-sm leading-relaxed" style={{ color: '#9090b0' }}>
          {retrospective}
        </p>
      )}
    </div>
  )
}

function formatGeneratedAge(iso: string): string | null {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  const ageMs = Date.now() - t
  if (ageMs < 0) return 'just now'
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000))
  if (days === 0) return 'generated today'
  if (days === 1) return 'generated 1d ago'
  return `generated ${days}d ago`
}

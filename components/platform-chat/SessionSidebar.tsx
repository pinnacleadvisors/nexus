'use client'

/**
 * SessionSidebar — Phase 4 of task_plan-chat.md.
 *
 * Left rail of /manage-platform Console showing past chat sessions for
 * the operator. Active session is highlighted; hover reveals a delete
 * icon; "+ New chat" button creates a fresh untitled session.
 *
 * Driven entirely by props — the parent owns the session list state and
 * re-fetches when it changes. Keeps this component small + testable.
 */

import { MessageSquarePlus, Trash2, MessageSquare, Loader2 } from 'lucide-react'

export interface SessionSummary {
  id:               string
  title:            string
  created_at:       string
  last_message_at:  string
}

interface Props {
  sessions:          SessionSummary[]
  activeSessionId:   string | null
  loading:           boolean
  onSelect:          (sessionId: string) => void
  onNew:             () => void
  onDelete:          (sessionId: string) => void
}

export default function SessionSidebar({ sessions, activeSessionId, loading, onSelect, onNew, onDelete }: Props) {
  return (
    <div
      className="w-64 shrink-0 flex flex-col h-full"
      style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* New chat */}
      <div className="p-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: 'linear-gradient(135deg, rgba(108,99,255,0.20), rgba(108,99,255,0.05))',
            border:     '1px solid rgba(108,99,255,0.30)',
            color:      '#e8e8f0',
          }}
        >
          <MessageSquarePlus size={14} />
          <span>New chat</span>
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {loading && sessions.length === 0 && (
          <div className="flex items-center gap-2 text-xs px-3 py-3" style={{ color: '#9090b0' }}>
            <Loader2 size={12} className="animate-spin" /> Loading sessions…
          </div>
        )}
        {!loading && sessions.length === 0 && (
          <div className="text-xs px-3 py-3" style={{ color: '#55556a' }}>
            No past chats. Click "New chat" to start.
          </div>
        )}
        {sessions.map(s => (
          <SessionRow
            key={s.id}
            session={s}
            active={s.id === activeSessionId}
            onSelect={() => onSelect(s.id)}
            onDelete={() => onDelete(s.id)}
          />
        ))}
      </div>
    </div>
  )
}

function SessionRow({ session, active, onSelect, onDelete }: { session: SessionSummary; active: boolean; onSelect: () => void; onDelete: () => void }) {
  return (
    <div
      className="group relative flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer transition-colors"
      style={{
        background: active ? 'rgba(108,99,255,0.12)' : 'transparent',
        border:     active ? '1px solid rgba(108,99,255,0.25)' : '1px solid transparent',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
      onClick={onSelect}
    >
      <MessageSquare size={12} style={{ color: active ? '#a8a3ff' : '#9090b0' }} className="shrink-0" />
      <span
        className="flex-1 min-w-0 text-xs truncate"
        style={{ color: active ? '#e8e8f0' : '#c8c8d8' }}
        title={session.title}
      >
        {session.title}
      </span>
      <button
        onClick={e => { e.stopPropagation(); if (confirm(`Delete "${session.title}"? Cannot be undone.`)) onDelete() }}
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded"
        title="Delete chat"
        style={{ color: '#ef4444' }}
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

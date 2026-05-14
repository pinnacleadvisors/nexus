'use client'

/**
 * ViewsPanel — slide-in side panel container that hosts the active view.
 *
 * Anchored to the right edge of the chat surface. Visible width is 360px
 * (narrow enough to keep the chat readable beside it on a 13" screen,
 * wide enough for a checklist + medium-length descriptions).
 *
 * Children render the active view (TasksView / ApprovalsView / CalendarView).
 * The panel itself only handles the chrome — close button, title, layout.
 */

import { X } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  title:    string
  subtitle?: string
  onClose:  () => void
  children: ReactNode
}

export default function ViewsPanel({ title, subtitle, onClose, children }: Props) {
  return (
    <aside
      className="w-[360px] shrink-0 flex flex-col h-full"
      style={{
        background:           'linear-gradient(180deg, rgba(15,15,24,0.96), rgba(8,8,14,0.96))',
        borderLeft:           '1px solid rgba(255,255,255,0.08)',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <header className="flex items-start justify-between gap-2 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: '#e8e8f0' }}>{title}</div>
          {subtitle && <div className="text-[10px] mt-0.5 truncate" style={{ color: '#9090b0' }}>{subtitle}</div>}
        </div>
        <button
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close view"
          className="shrink-0 p-1 rounded transition-colors"
          style={{ color: '#9090b0' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#e8e8f0' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9090b0' }}
        >
          <X size={14} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </aside>
  )
}

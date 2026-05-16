'use client'

/**
 * ViewsDropdown — the "Views" button + popover menu that opens auxiliary
 * panels in the chat surface. Modeled after Claude Code's Views button.
 *
 * Props:
 *   scope: 'admin' | 'business:<slug>'   — passed straight to every panel
 *   onOpen(view): called when the user picks one — parent renders the panel
 *
 * Self-contained: no portal, no global state. Parent owns the active view
 * so it can also close it when navigating chats.
 */

import { useEffect, useRef, useState } from 'react'
import { LayoutGrid, ChevronDown, ListTodo, CheckSquare, CalendarDays, Bug, Activity } from 'lucide-react'

export type ViewName = 'tasks' | 'approvals' | 'calendar' | 'bug-hunt' | 'health'

interface Props {
  scope:        string
  activeView:   ViewName | null
  onOpen:       (view: ViewName | null) => void
  /** Optional badges per view (e.g. open-task count). Renders next to the label. */
  badges?:      Partial<Record<ViewName, number>>
}

interface ViewSpec {
  id:    ViewName
  label: string
  hint:  string
  Icon:  typeof ListTodo
}

const VIEWS: ViewSpec[] = [
  { id: 'tasks',     label: 'Manual to-dos',   hint: 'Tasks the agent flagged for you',         Icon: ListTodo },
  { id: 'approvals', label: 'Approval queue',  hint: 'Pending approve/deny decisions',          Icon: CheckSquare },
  { id: 'calendar',  label: 'Calendar',        hint: 'Upcoming due dates + scheduled runs',     Icon: CalendarDays },
  { id: 'bug-hunt',  label: 'Bug hunt',        hint: 'Operator-gated loop to audit the platform', Icon: Bug },
  { id: 'health',    label: 'Platform health', hint: 'Slack delivery, cron status, recent errors, cost-guard signals', Icon: Activity },
]

export default function ViewsDropdown({ scope, activeView, onOpen, badges }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown',   onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown',   onEsc)
    }
  }, [open])

  function pick(view: ViewName) {
    setOpen(false)
    onOpen(view === activeView ? null : view)
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title={`Views (scope: ${scope})`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{
          background: activeView ? 'linear-gradient(135deg, rgba(108,99,255,0.25), rgba(108,99,255,0.08))' : 'rgba(255,255,255,0.03)',
          border:     activeView ? '1px solid rgba(108,99,255,0.30)' : '1px solid rgba(255,255,255,0.08)',
          color:      activeView ? '#e8e8f0' : '#9090b0',
        }}
        onMouseEnter={e => { if (!activeView) e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
        onMouseLeave={e => { if (!activeView) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
      >
        <LayoutGrid size={12} />
        <span>Views</span>
        <ChevronDown size={11} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1.5 w-64 rounded-lg overflow-hidden z-30 shadow-2xl"
          style={{
            background:           'rgba(15,15,24,0.96)',
            border:               '1px solid rgba(255,255,255,0.10)',
            backdropFilter:       'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className="px-3 py-2 text-[10px] uppercase tracking-[0.16em]" style={{ color: '#55556a', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            Open a side view
          </div>
          {VIEWS.map(v => {
            const Active = v.id === activeView
            const Icon = v.Icon
            const badge = badges?.[v.id]
            return (
              <button
                key={v.id}
                onClick={() => pick(v.id)}
                className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors"
                style={{
                  background: Active ? 'rgba(108,99,255,0.10)' : 'transparent',
                }}
                onMouseEnter={e => { if (!Active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { if (!Active) e.currentTarget.style.background = 'transparent' }}
              >
                <Icon size={14} style={{ color: Active ? '#a8a3ff' : '#9090b0' }} className="mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium" style={{ color: Active ? '#e8e8f0' : '#c8c8d8' }}>{v.label}</div>
                    {typeof badge === 'number' && badge > 0 && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(168,163,255,0.15)', color: '#a8a3ff' }}>{badge}</span>
                    )}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: '#55556a' }}>{v.hint}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

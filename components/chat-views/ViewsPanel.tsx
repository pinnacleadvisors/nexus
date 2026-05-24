'use client'

/**
 * ViewsPanel — adaptive container that hosts the active view.
 *
 * Two presentations driven by viewport width:
 *
 *   - Desktop (≥ md, 768px): slide-in side panel anchored to the right edge.
 *     Resizable via left-edge drag, persists width per `storageKey`. Matches
 *     the pre-Phase-2 behaviour for laptop ops.
 *
 *   - Mobile (< md): Vaul-backed bottom-sheet. Drag handle at the top,
 *     swipe-down to dismiss, snap-points at 50%/90% of viewport height.
 *     Matches the Claude Code mobile-app pattern the operator likes.
 *
 * Phase 2A of task_plan-collaborative-chat.md (PR #285). Children render
 * the active view (TasksView / ApprovalsView / CalendarView / BugHuntView /
 * HealthView) — the chrome here only handles layout + dismissal.
 */

import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Drawer } from 'vaul'
import { useResizable } from '@/lib/hooks/useResizable'
import { useIsMobile } from '@/lib/hooks/useIsMobile'

interface Props {
  title:    string
  subtitle?: string
  onClose:  () => void
  children: ReactNode
  /** Persistence key — pass a stable per-view key so each view remembers its width. */
  storageKey?: string
}

export default function ViewsPanel(props: Props) {
  // `isMobile` flips when the operator drags a window across the md
  // breakpoint (768px) so the presentation swaps without a remount.
  const isMobile = useIsMobile('md')

  // Esc closes the panel — matches Claude Code's reflex and the existing
  // pattern in ViewsDropdown.tsx (line 53). Listening here covers both
  // DesktopPanel and MobileSheet without duplicating the effect in each.
  // The Vaul drawer also dismisses on Esc via its own backdrop behaviour
  // so this is additive on mobile rather than redundant.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props.onClose])

  return isMobile ? <MobileSheet {...props} /> : <DesktopPanel {...props} />
}

function DesktopPanel({ title, subtitle, onClose, children, storageKey = 'nexus:views-panel:width' }: Props) {
  const resize = useResizable({
    key:          storageKey,
    defaultPx:    360,
    minPx:        260,
    maxPx:        640,
    edge:         'left',
    collapseAtPx: 220,
    onSnap:       onClose,
  })

  return (
    <aside
      className="shrink-0 flex flex-col h-full relative"
      style={{
        background:           'linear-gradient(180deg, rgba(15,15,24,0.96), rgba(8,8,14,0.96))',
        borderLeft:           '1px solid rgba(255,255,255,0.08)',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        width:                `${resize.width}px`,
        transition:           resize.isDragging ? undefined : 'width 100ms ease-out',
      }}
    >
      <div
        {...resize.handleProps}
        style={{
          ...resize.handleProps.style,
          background: resize.isDragging ? 'rgba(108,99,255,0.40)' : 'transparent',
        }}
        onMouseEnter={e => { if (!resize.isDragging) e.currentTarget.style.background = 'rgba(108,99,255,0.15)' }}
        onMouseLeave={e => { if (!resize.isDragging) e.currentTarget.style.background = 'transparent' }}
      />
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

function MobileSheet({ title, subtitle, onClose, children }: Props) {
  // Vaul's Drawer.Root is controlled — `open` stays true while we're rendered,
  // and the operator's swipe/backdrop tap triggers our onClose via onOpenChange.
  return (
    <Drawer.Root open={true} onOpenChange={(o) => { if (!o) onClose() }} shouldScaleBackground={false}>
      <Drawer.Portal>
        <Drawer.Overlay
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.5)' }}
        />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl outline-none"
          style={{
            background:           'linear-gradient(180deg, rgba(15,15,24,0.98), rgba(8,8,14,0.98))',
            borderTop:            '1px solid rgba(255,255,255,0.10)',
            backdropFilter:       'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            maxHeight:            '92vh',
            minHeight:            '50vh',
            boxShadow:            '0 -10px 32px rgba(0,0,0,0.5)',
          }}
        >
          {/* Vaul-conventional drag handle */}
          <div className="mx-auto mt-2 mb-1 h-1.5 w-12 rounded-full" style={{ background: 'rgba(255,255,255,0.18)' }} />
          <Drawer.Title asChild>
            <header className="flex items-start justify-between gap-2 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: '#e8e8f0' }}>{title}</div>
                {subtitle && <div className="text-[10px] mt-0.5 truncate" style={{ color: '#9090b0' }}>{subtitle}</div>}
              </div>
              <button
                onClick={onClose}
                title="Close"
                aria-label="Close view"
                className="shrink-0 p-1.5 min-h-[36px] min-w-[36px] rounded transition-colors"
                style={{ color: '#9090b0' }}
              >
                <X size={16} />
              </button>
            </header>
          </Drawer.Title>
          <Drawer.Description className="sr-only">Mobile bottom-sheet view</Drawer.Description>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

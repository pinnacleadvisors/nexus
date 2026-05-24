'use client'

/**
 * MobileAwareSessionSidebar — wraps SessionSidebar with viewport-driven presentation.
 *
 *   - Desktop (≥ md, 768px): renders SessionSidebar inline as the chat's
 *     left rail (the pre-Phase-2 behaviour).
 *   - Mobile (< md): hides the inline rail. The parent renders a hamburger
 *     button in the chat header; tapping it sets `mobileOpen=true`, which
 *     opens a Vaul left-side drawer containing SessionSidebar.
 *
 * Phase 2C of task_plan-collaborative-chat.md (PR #285). Mirrors the
 * pattern Claude Code's mobile app uses for chat history navigation.
 *
 * The parent owns the open-state. We keep this component dumb so it works
 * the same way in PlatformChat and BusinessChat.
 */

import { Drawer } from 'vaul'
import SessionSidebar, { type SessionSummary } from './SessionSidebar'
import { useIsMobile } from '@/lib/hooks/useIsMobile'

interface Props {
  sessions:          SessionSummary[]
  activeSessionId:   string | null
  loading:           boolean
  onSelect:          (sessionId: string) => void
  onNew:             () => void
  onDelete:          (sessionId: string) => void
  /** Mobile-only: whether the slide-over is open. Desktop ignores. */
  mobileOpen:        boolean
  /** Mobile-only: called when operator dismisses (swipe-left or backdrop tap). */
  onMobileClose:     () => void
}

export default function MobileAwareSessionSidebar(props: Props) {
  const isMobile = useIsMobile('md')

  const sidebarProps = {
    sessions:        props.sessions,
    activeSessionId: props.activeSessionId,
    loading:         props.loading,
    onSelect:        (id: string) => { props.onSelect(id); if (isMobile) props.onMobileClose() },
    onNew:           () => { props.onNew(); if (isMobile) props.onMobileClose() },
    onDelete:        props.onDelete,
  }

  if (!isMobile) {
    return <SessionSidebar {...sidebarProps} />
  }

  return (
    <Drawer.Root
      direction="left"
      open={props.mobileOpen}
      onOpenChange={(o) => { if (!o) props.onMobileClose() }}
      shouldScaleBackground={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.5)' }}
        />
        <Drawer.Content
          className="fixed top-0 bottom-0 left-0 z-50 flex flex-col outline-none"
          style={{
            background:           'linear-gradient(180deg, rgba(15,15,24,0.98), rgba(8,8,14,0.98))',
            borderRight:          '1px solid rgba(255,255,255,0.10)',
            backdropFilter:       'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            width:                '85vw',
            maxWidth:             '320px',
            boxShadow:            '10px 0 32px rgba(0,0,0,0.5)',
          }}
        >
          <Drawer.Title className="sr-only">Chat sessions</Drawer.Title>
          <Drawer.Description className="sr-only">Past chat sessions for this workspace</Drawer.Description>
          <SessionSidebar {...sidebarProps} />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

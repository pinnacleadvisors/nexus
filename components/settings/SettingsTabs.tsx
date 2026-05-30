'use client'

/**
 * Shared tab bar for the /settings family of pages.
 *
 * Three of the four tabs (AI / Alerts / Access) live on `/settings` itself and
 * are switched via the `?tab=` URL param so deep-links work and refreshes don't
 * lose state. The fourth tab ("Businesses") is its own page at
 * `/settings/businesses` because the businesses CRUD is a substantial UI that
 * deserves its own URL — but it renders this same tab bar at the top so the
 * navigation is consistent in both directions.
 *
 * Pass `activeTab` explicitly: pages know which tab they belong to without
 * having to parse the URL twice.
 */

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { Server, Bell, Shield, Briefcase, Plug, Sparkles, Wand2, Repeat, type LucideIcon } from 'lucide-react'

export type SettingsTabId = 'ai' | 'agents' | 'skills' | 'alerts' | 'access' | 'businesses' | 'accounts' | 'loops'

interface TabSpec {
  id:    SettingsTabId
  label: string
  icon:  LucideIcon
  href:  string
}

export const SETTINGS_TABS: TabSpec[] = [
  { id: 'ai',         label: 'AI providers', icon: Server,    href: '/settings?tab=ai'     },
  { id: 'agents',     label: 'Agents',       icon: Sparkles,  href: '/settings/agents'     },
  { id: 'skills',     label: 'Skills',       icon: Wand2,     href: '/settings?tab=skills' },
  { id: 'accounts',   label: 'Connectors',   icon: Plug,      href: '/settings/accounts'   },
  { id: 'businesses', label: 'Businesses',   icon: Briefcase, href: '/settings/businesses' },
  { id: 'loops',      label: 'Loops',        icon: Repeat,    href: '/settings/loops'      },
  { id: 'alerts',     label: 'Alerts',       icon: Bell,      href: '/settings?tab=alerts' },
  { id: 'access',     label: 'Access',       icon: Shield,    href: '/settings?tab=access' },
]

export default function SettingsTabs({ activeTab }: { activeTab: SettingsTabId }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const activeRef   = useRef<HTMLAnchorElement | null>(null)

  // Mobile UX — when the active tab is off-screen on first paint (375px
  // viewports can't fit all 7 tabs), scroll it into view so the operator
  // never lands on a page with the relevant tab clipped off the right edge.
  useEffect(() => {
    const el = activeRef.current
    const scroller = scrollerRef.current
    if (!el || !scroller) return
    // Only auto-scroll when the active tile is actually clipped — avoids
    // a janky jump when everything already fits.
    const elBox  = el.getBoundingClientRect()
    const scBox  = scroller.getBoundingClientRect()
    if (elBox.left < scBox.left || elBox.right > scBox.right) {
      el.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' })
    }
  }, [activeTab])

  return (
    // Wrapper carries a right-edge fade so the operator can SEE there's
    // more tabs off-screen even before they scroll. Without this affordance
    // a 375px viewport looks like "only 2 tabs exist" — the audit caught
    // this on /settings → Access where Skills / Businesses / Alerts /
    // Access were all clipped.
    <div className="relative mb-5">
      <div
        ref={scrollerRef}
        className="flex items-center gap-1 overflow-x-auto p-1 scrollbar-thin"
        style={{
          background:           'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
          backdropFilter:       'blur(28px) saturate(180%)',
          WebkitBackdropFilter: 'blur(28px) saturate(180%)',
          border:               '1px solid rgba(255,255,255,0.08)',
          borderRadius:         '14px',
          boxShadow:            '0 1px 0 0 rgba(255,255,255,0.04) inset',
          width:                'fit-content',
          maxWidth:             '100%',
          // Hide scrollbar on iOS/Safari where it's normally invisible
          // but show on macOS — visible scrollbar is a useful affordance
          // here, not a styling problem.
          scrollbarWidth:       'thin',
        }}
      >
        {SETTINGS_TABS.map(t => {
          const Icon   = t.icon
          const active = t.id === activeTab
          return (
            <Link
              key={t.id}
              ref={active ? activeRef : undefined}
              href={t.href}
              className="flex items-center gap-2 px-3.5 py-1.5 text-[13px] font-medium transition-all whitespace-nowrap"
              style={{
                borderRadius: '10px',
                background:   active
                  ? 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.08))'
                  : 'transparent',
                border:       active
                  ? '1px solid rgba(108,99,255,0.30)'
                  : '1px solid transparent',
                color:        active ? '#e8e8f0' : '#9090b0',
                boxShadow:    active ? '0 1px 0 0 rgba(255,255,255,0.06) inset' : undefined,
              }}
            >
              <Icon size={13} style={{ color: active ? '#a8a3ff' : '#9090b0' }} />
              {t.label}
            </Link>
          )
        })}
      </div>
      {/* Right-edge fade — visual hint that more tabs exist. Hidden on
          desktop wide enough to show all tabs (lg breakpoint). */}
      <div
        aria-hidden
        className="absolute top-0 right-0 h-full w-8 pointer-events-none lg:hidden"
        style={{
          background:   'linear-gradient(90deg, rgba(5,5,8,0) 0%, rgba(5,5,8,0.55) 70%, rgba(5,5,8,0.85) 100%)',
          borderTopRightRadius:    '14px',
          borderBottomRightRadius: '14px',
        }}
      />
    </div>
  )
}

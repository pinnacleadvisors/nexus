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
import { Server, Bell, Shield, Briefcase, Plug, type LucideIcon } from 'lucide-react'

export type SettingsTabId = 'ai' | 'alerts' | 'access' | 'businesses' | 'accounts'

interface TabSpec {
  id:    SettingsTabId
  label: string
  icon:  LucideIcon
  href:  string
}

export const SETTINGS_TABS: TabSpec[] = [
  { id: 'ai',         label: 'AI providers', icon: Server,    href: '/settings?tab=ai'         },
  { id: 'alerts',     label: 'Alerts',       icon: Bell,      href: '/settings?tab=alerts'     },
  { id: 'access',     label: 'Access',       icon: Shield,    href: '/settings?tab=access'     },
  { id: 'accounts',   label: 'Accounts',     icon: Plug,      href: '/settings/accounts'       },
  { id: 'businesses', label: 'Businesses',   icon: Briefcase, href: '/settings/businesses'     },
]

export default function SettingsTabs({ activeTab }: { activeTab: SettingsTabId }) {
  return (
    <div
      className="flex items-center gap-1 mb-5 overflow-x-auto p-1"
      style={{
        background:           'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
        backdropFilter:       'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border:               '1px solid rgba(255,255,255,0.08)',
        borderRadius:         '14px',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.04) inset',
        width:                'fit-content',
        maxWidth:             '100%',
      }}
    >
      {SETTINGS_TABS.map(t => {
        const Icon   = t.icon
        const active = t.id === activeTab
        return (
          <Link
            key={t.id}
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
  )
}

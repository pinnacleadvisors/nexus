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
      className="flex items-center gap-1 mb-6 border-b overflow-x-auto"
      style={{ borderColor: '#24243e' }}
    >
      {SETTINGS_TABS.map(t => {
        const Icon   = t.icon
        const active = t.id === activeTab
        return (
          <Link
            key={t.id}
            href={t.href}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap"
            style={{
              borderColor: active ? '#6c63ff'  : 'transparent',
              color:       active ? '#e8e8f0'  : '#9090b0',
            }}
          >
            <Icon size={14} />
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}

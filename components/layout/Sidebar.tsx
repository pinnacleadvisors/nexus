'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import {
  Lightbulb,
  Workflow,
  LayoutDashboard,
  Settings,
  Share2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Library,
  FileText,
  Inbox,
  Brain,
  Terminal,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePollWithBackoff } from '@/lib/hooks/usePollWithBackoff'

// Poll cadence for the Dev Console health badge. Long enough to not spam the
// route, short enough that a red cron failure surfaces within a few minutes.
// usePollWithBackoff layers exponential backoff on top so a transient 5xx /
// auth failure doesn't keep hammering the endpoint at constant rate.
const HEALTH_POLL_MS = 5 * 60_000

type HealthBadge = 'red' | 'amber' | null

interface HealthSummary {
  summary?: { red?: number; amber?: number; unknown?: number; green?: number }
}

function useHealthBadge(): HealthBadge {
  const [badge, setBadge] = useState<HealthBadge>(null)

  const fetcher = useCallback(async () => {
    const res = await fetch('/api/health/cron', { cache: 'no-store' })
    if (res.status === 401 || res.status === 403) {
      // Non-owner — endpoint is owner-gated. Don't badge, don't retry.
      setBadge(null)
      return
    }
    if (!res.ok) throw new Error(`health/cron HTTP ${res.status}`)
    const json = await res.json() as HealthSummary
    const r = json.summary?.red   ?? 0
    const a = json.summary?.amber ?? 0
    setBadge(r > 0 ? 'red' : a > 0 ? 'amber' : null)
  }, [])

  usePollWithBackoff(fetcher, { intervalMs: HEALTH_POLL_MS })

  return badge
}

interface NavLink {
  type: 'link'
  href: string
  label: string
  icon: LucideIcon
}

interface NavGroup {
  type: 'group'
  id: string
  label: string
  icon: LucideIcon
  children: NavLink[]
}

type NavItem = NavLink | NavGroup

// Five top-level surfaces, mapped to the operator's mental model:
//   Mission Control = Watch     (default landing)
//   Ideas           = Capture
//   Pipeline        = Decide    (board + automation library + swarm)
//   Knowledge       = Learn     (graph + memory)
//   Toolbox         = Reusable assets (agents, tools, snippets)
//   Settings        = Admin     (everything that lived under Manage Platform)
const NAV: NavItem[] = [
  { type: 'link', href: '/dashboard',       label: 'Mission Control', icon: LayoutDashboard },
  { type: 'link', href: '/idea',            label: 'Ideas',           icon: Lightbulb },
  { type: 'link', href: '/signals',         label: 'Signals',         icon: Inbox },
  { type: 'link', href: '/board',           label: 'Pipeline',        icon: Workflow },
  { type: 'link', href: '/graph',           label: 'Knowledge',       icon: Share2 },
  { type: 'link', href: '/learn',           label: 'Learn',           icon: Brain },
  { type: 'link', href: '/tools',           label: 'Toolbox',         icon: Library },
  { type: 'link', href: '/manage-platform', label: 'Dev Console',     icon: Terminal },
  { type: 'link', href: '/settings',        label: 'Settings',        icon: Settings },
]

function isActive(pathname: string, href: string) {
  if (href === '/dashboard')       return pathname === '/dashboard' || pathname.startsWith('/dashboard/')
  if (href === '/idea')            return pathname === '/idea' || pathname.startsWith('/idea-library')
  if (href === '/signals')         return pathname === '/signals' || pathname.startsWith('/signals/')
  if (href === '/board')           return pathname === '/board' || pathname.startsWith('/automation-library') || pathname.startsWith('/swarm')
  if (href === '/graph')           return pathname === '/graph'
  if (href === '/learn')           return pathname === '/learn' || pathname.startsWith('/learn/')
  if (href === '/tools')           return pathname === '/tools' || pathname.startsWith('/tools/')
  if (href === '/manage-platform') return pathname === '/manage-platform' || pathname.startsWith('/manage-platform/')
  if (href === '/settings')        return pathname === '/settings' || pathname.startsWith('/settings/')
  return pathname === href || pathname.startsWith(href + '/')
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const pathname = usePathname() ?? ''
  const healthBadge = useHealthBadge()

  function toggleGroup(id: string) {
    setOpenGroups(g => ({ ...g, [id]: !g[id] }))
  }

  return (
    <aside
      className={cn(
        'flex flex-col h-full shrink-0 border-r transition-all duration-200',
        collapsed ? 'w-16' : 'w-60'
      )}
      style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
    >
      {/* Logo */}
      <div
        className={cn(
          'flex items-center gap-2 h-16 px-4 border-b shrink-0',
          collapsed && 'justify-center px-0'
        )}
        style={{ borderColor: '#24243e' }}
      >
        <div
          className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
          style={{ backgroundColor: '#6c63ff' }}
        >
          <FileText size={16} className="text-white" />
        </div>
        {!collapsed && (
          <span className="font-bold text-lg tracking-tight" style={{ color: '#e8e8f0' }}>
            Nexus
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {NAV.map(item =>
          item.type === 'link' ? (
            <SidebarLink
              key={item.href}
              link={item}
              collapsed={collapsed}
              active={isActive(pathname, item.href)}
              // Surface a red/amber dot on Dev Console when /api/health/cron
              // reports failing or overdue jobs — the operator notices a
              // problem in the sidebar instead of having to open the Health
              // tab proactively.
              badge={item.href === '/manage-platform' ? healthBadge : null}
            />
          ) : (
            <SidebarGroup
              key={item.id}
              group={item}
              collapsed={collapsed}
              open={openGroups[item.id] ?? false}
              onToggle={() => toggleGroup(item.id)}
              pathname={pathname}
            />
          )
        )}
      </nav>

      {/* Bottom: user + collapse toggle */}
      <div className="px-2 pb-4 space-y-2 shrink-0 border-t pt-3" style={{ borderColor: '#24243e' }}>
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
            collapsed && 'justify-center gap-0 px-0'
          )}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#12121e' }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
          title="Account — click your avatar for sign-out, profile, and security"
        >
          <UserButton />
          {!collapsed && (
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-sm font-medium truncate" style={{ color: '#e8e8f0' }}>
                Account
              </span>
              <span className="text-[10px] uppercase tracking-wide" style={{ color: '#55556a' }}>
                Click avatar
              </span>
            </div>
          )}
        </div>

        <button
          onClick={() => setCollapsed(c => !c)}
          className={cn(
            'flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm transition-colors',
            collapsed && 'justify-center px-0'
          )}
          style={{ color: '#55556a' }}
          onMouseEnter={e => {
            e.currentTarget.style.color = '#9090b0'
            e.currentTarget.style.backgroundColor = '#12121e'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = '#55556a'
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}

function SidebarLink({
  link,
  collapsed,
  active,
  indent,
  badge,
}: {
  link: NavLink
  collapsed: boolean
  active: boolean
  indent?: boolean
  badge?: HealthBadge
}) {
  const Icon = link.icon
  const badgeColor = badge === 'red'
    ? '#ef4444'
    : badge === 'amber'
      ? '#f59e0b'
      : null
  const badgeTitle = badge === 'red'
    ? 'One or more cron jobs are failing — open Dev Console → Health'
    : badge === 'amber'
      ? 'A cron job is overdue or returned a 4xx — open Dev Console → Health'
      : undefined
  return (
    <Link
      href={link.href}
      title={badgeTitle}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        collapsed && 'justify-center px-0',
        indent && !collapsed && 'pl-9',
      )}
      style={
        active
          ? { backgroundColor: '#1a1a2e', color: '#fff', borderLeft: '2px solid #6c63ff' }
          : { color: '#9090b0' }
      }
      onMouseEnter={e => {
        if (!active) e.currentTarget.style.backgroundColor = '#12121e'
      }}
      onMouseLeave={e => {
        if (!active) e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      <span className="relative shrink-0">
        <Icon size={18} className="shrink-0" />
        {badgeColor && (
          <span
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
            style={{ backgroundColor: badgeColor, boxShadow: `0 0 0 2px #0d0d14` }}
            aria-hidden
          />
        )}
      </span>
      {!collapsed && link.label}
    </Link>
  )
}

function SidebarGroup({
  group,
  collapsed,
  open,
  onToggle,
  pathname,
}: {
  group: NavGroup
  collapsed: boolean
  open: boolean
  onToggle: () => void
  pathname: string
}) {
  const Icon = group.icon
  const anyChildActive = group.children.some(c => isActive(pathname, c.href))

  // When collapsed, render the group as a flat list of icon-only links.
  if (collapsed) {
    return (
      <div className="space-y-0.5">
        {group.children.map(c => (
          <SidebarLink
            key={c.href}
            link={c}
            collapsed
            active={isActive(pathname, c.href)}
          />
        ))}
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
        style={{ color: anyChildActive ? '#e8e8f0' : '#9090b0' }}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#12121e' }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
      >
        <Icon size={18} className="shrink-0" />
        <span className="flex-1 text-left">{group.label}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {group.children.map(c => (
            <SidebarLink
              key={c.href}
              link={c}
              collapsed={false}
              active={isActive(pathname, c.href)}
              indent
            />
          ))}
        </div>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import {
  Workflow,
  LayoutDashboard,
  Settings,
  Share2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileText,
  Inbox,
  Brain,
  Terminal,
  Briefcase,
  MessageSquare,
  ListTodo,
  Network,
  ShieldCheck,
  Trophy,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePollWithBackoff } from '@/lib/hooks/usePollWithBackoff'
import { useResizable } from '@/lib/hooks/useResizable'
import { useIsMobile } from '@/lib/hooks/useIsMobile'

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
  /** Optional href on the group label so clicking it navigates AND toggles. */
  href?: string
}

type NavItem = NavLink | NavGroup

/**
 * Async businesses fetched once on mount + cached for the session.
 * The Sidebar uses this to render the Businesses entry as a group with
 * per-business chat sub-items. SessionStorage cache survives navigation
 * (Sidebar re-mounts) but not page reloads — short enough to stay fresh,
 * long enough to avoid every navigation flash.
 */
interface BusinessLink { slug: string; name: string }
interface BusinessesResp { ok: true; businesses: Array<{ slug: string; name: string; status: string }> }
const BUSINESSES_CACHE_KEY = 'nexus:sidebar:businesses'

function readCachedBusinesses(): BusinessLink[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(BUSINESSES_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as BusinessLink[]
  } catch { return null }
}

function useBusinessesForSidebar(): BusinessLink[] {
  // Start empty on both server + client to avoid hydration mismatch (React
  // error #418). Reading sessionStorage during initialState made the server
  // (always []) disagree with the client (could be cached) on hydration.
  // We restore the cached value inside useEffect AFTER mount instead — the
  // visible flash is one frame and matches the existing "fetch fresh from
  // /api/businesses" pattern.
  const [list, setList] = useState<BusinessLink[]>([])
  useEffect(() => {
    let cancelled = false
    // Restore the sessionStorage cache first so the sidebar shows known
    // businesses immediately on navigation, before the network round-trip.
    const cached = readCachedBusinesses()
    if (cached && cached.length > 0) setList(cached)

    ;(async () => {
      try {
        const res = await fetch('/api/businesses', { cache: 'no-store' })
        if (!res.ok) return
        const j = (await res.json()) as BusinessesResp | { ok: false }
        if (!j.ok || cancelled) return
        const filtered = j.businesses
          .filter(b => b.status !== 'archived')
          .map(b => ({ slug: b.slug, name: b.name }))
        setList(filtered)
        try { sessionStorage.setItem(BUSINESSES_CACHE_KEY, JSON.stringify(filtered)) } catch { /* quota */ }
      } catch { /* swallow — fall back to cached / empty */ }
    })()
    return () => { cancelled = true }
  }, [])
  return list
}

// Top-level surfaces, mapped to the operator's mental model:
//   Mission Control = Watch       (default landing)
//   Businesses      = Per-business copilots + management
//   Ideas / Signals = Capture
//   Pipeline        = Decide       (board + automation library + swarm)
//   Knowledge       = Learn        (graph + memory)
//   Settings        = Admin        (AI providers, agents, connectors, businesses, etc.)
//
// The Toolbox link was retired when /tools was deleted — agents now live at
// /settings/agents and connectors at /settings/accounts.
//
// `Businesses` is rendered as a dynamic group when businesses exist —
// children are per-business chat sub-items so the operator reaches a
// specific business's copilot in 1 click. Falls back to a flat link when
// the list is empty (first-time-user state).
// 2026-05-22 — Inbox absorbs three previous nav entries (Approvals, Signals,
// Ideas) per the Paperclip-aesthetic absorption. Routes still exist for
// backward-compat; they just don't have nav entries any more. Future PR
// migrates the Ideas flow into a chat-driven create_business agent and the
// Signals logic into a platform-copilot skill.
const BASE_NAV: NavItem[] = [
  { type: 'link', href: '/dashboard',       label: 'Mission Control', icon: LayoutDashboard },
  { type: 'link', href: '/inbox',           label: 'Inbox',           icon: Inbox },
  { type: 'link', href: '/issues',          label: 'Issues',          icon: ListTodo },
  { type: 'link', href: '/businesses',      label: 'Businesses',      icon: Briefcase },
  { type: 'link', href: '/org',             label: 'Org Chart',       icon: Network },
  { type: 'link', href: '/board',           label: 'Pipeline',        icon: Workflow },
  { type: 'link', href: '/graph',           label: 'Knowledge',       icon: Share2 },
  { type: 'link', href: '/learn',           label: 'Learn',           icon: Brain },
  { type: 'link', href: '/accomplishments', label: 'Wins',            icon: Trophy },
  { type: 'link', href: '/audit',           label: 'Audit',           icon: ShieldCheck },
  { type: 'link', href: '/manage-platform', label: 'Dev Console',     icon: Terminal },
  { type: 'link', href: '/settings',        label: 'Settings',        icon: Settings },
]

function buildNav(businesses: BusinessLink[]): NavItem[] {
  if (businesses.length === 0) return BASE_NAV
  return BASE_NAV.map(item => {
    if (item.type !== 'link' || item.href !== '/businesses') return item
    const group: NavGroup = {
      type:  'group',
      id:    'businesses',
      label: item.label,
      icon:  item.icon,
      href:  '/businesses',
      children: [
        { type: 'link', href: '/businesses', label: 'All businesses', icon: Briefcase },
        ...businesses.map<NavLink>(b => ({
          type:  'link',
          href:  `/businesses/${encodeURIComponent(b.slug)}/chat`,
          label: b.name,
          icon:  MessageSquare,
        })),
      ],
    }
    return group
  })
}

function isActive(pathname: string, href: string) {
  if (href === '/dashboard')       return pathname === '/dashboard' || pathname.startsWith('/dashboard/')
  if (href === '/inbox')           return pathname === '/inbox' || pathname === '/approvals' || pathname === '/signals'
  if (href === '/issues')          return pathname === '/issues' || pathname.startsWith('/issues/')
  if (href === '/businesses')      return pathname === '/businesses' || pathname.startsWith('/businesses/')
  if (href === '/org')             return pathname === '/org' || pathname.startsWith('/org/')
  if (href === '/board')           return pathname === '/board' || pathname.startsWith('/automation-library') || pathname.startsWith('/swarm')
  if (href === '/graph')           return pathname === '/graph'
  if (href === '/learn')           return pathname === '/learn' || pathname.startsWith('/learn/')
  if (href === '/audit')           return pathname === '/audit' || pathname.startsWith('/audit/')
  if (href === '/manage-platform') return pathname === '/manage-platform' || pathname.startsWith('/manage-platform/')
  if (href === '/settings')        return pathname === '/settings' || pathname.startsWith('/settings/')
  return pathname === href || pathname.startsWith(href + '/')
}

export default function Sidebar() {
  const [manualCollapsed, setManualCollapsed] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const pathname = usePathname() ?? ''
  const healthBadge = useHealthBadge()
  const businesses  = useBusinessesForSidebar()
  const nav         = buildNav(businesses)

  // Phase 2 of task_plan-mobile-copilot.md — force icon-rail collapse on
  // narrow viewports. The operator manages from mobile while travelling,
  // and a 240-420px sidebar eats too much of a 375-414px screen. Below
  // 640px we override the manual collapsed/expanded state entirely; the
  // operator's preference is restored when they go back to a wider screen.
  const isNarrow = useIsMobile('sm')
  // `collapsed` is the EFFECTIVE state used by all JSX below. Toggle button
  // (line ~325) still updates manualCollapsed so the operator's choice persists
  // for when they return to a wide viewport.
  const collapsed = isNarrow || manualCollapsed

  // Resizable expanded-width. Drag the right edge to set; double-click to reset.
  // Dragging below 80px snaps to fully-collapsed (operator gets icon-only mode).
  const resize = useResizable({
    key:          'nexus:sidebar:width',
    defaultPx:    240,
    minPx:        180,
    maxPx:        420,
    edge:         'right',
    collapseAtPx: 100,
    onSnap:       () => setManualCollapsed(true),
  })

  // Auto-expand the Businesses group when the user is on a /businesses route
  // so they don't have to click the chevron after navigating in.
  useEffect(() => {
    if (pathname.startsWith('/businesses')) {
      setOpenGroups(g => g.businesses ? g : { ...g, businesses: true })
    }
  }, [pathname])

  function toggleGroup(id: string) {
    setOpenGroups(g => ({ ...g, [id]: !g[id] }))
  }

  return (
    <aside
      className={cn(
        'flex flex-col h-full shrink-0 border-r relative rounded-r-2xl overflow-hidden',
        collapsed ? 'transition-all duration-200' : (resize.isDragging ? '' : 'transition-all duration-100'),
      )}
      style={{
        backgroundColor: '#0d0d14',
        borderColor:     '#24243e',
        // Soft outer shadow + rounded right edge gives the floating-panel look
        // the operator asked for ("modern sleek" — Paperclip-aesthetic absorption).
        boxShadow:       '4px 0 24px -8px rgba(0, 0, 0, 0.45)',
        // Collapsed uses fixed icon-rail width; expanded uses the resizable width.
        width:           collapsed ? '4rem' : `${resize.width}px`,
      }}
    >
      {/* Drag handle on the right edge — only visible when expanded. */}
      {!collapsed && (
        <div
          {...resize.handleProps}
          style={{
            ...resize.handleProps.style,
            background: resize.isDragging ? 'rgba(108,99,255,0.40)' : 'transparent',
          }}
          onMouseEnter={e => { if (!resize.isDragging) e.currentTarget.style.background = 'rgba(108,99,255,0.15)' }}
          onMouseLeave={e => { if (!resize.isDragging) e.currentTarget.style.background = 'transparent' }}
        />
      )}
      {/* Logo */}
      <div
        className={cn(
          'flex items-center gap-2 h-16 px-4 border-b shrink-0',
          collapsed && 'justify-center px-0'
        )}
        style={{ borderColor: '#24243e' }}
      >
        <div
          className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
          style={{
            background:  'linear-gradient(135deg, #7c75ff 0%, #6c63ff 50%, #5b54e6 100%)',
            boxShadow:   '0 4px 14px -2px rgba(108, 99, 255, 0.45)',
          }}
        >
          <FileText size={17} className="text-white" />
        </div>
        {!collapsed && (
          <span className="font-bold text-lg tracking-tight" style={{ color: '#e8e8f0' }}>
            Nexus
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {nav.map(item =>
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
          onClick={() => setManualCollapsed(c => !c)}
          disabled={isNarrow}
          title={isNarrow ? 'Sidebar is locked to icon mode on narrow viewports' : (collapsed ? 'Expand sidebar' : 'Collapse sidebar')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex items-center gap-2 w-full rounded-lg px-3 py-2.5 min-h-[44px] text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
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
        // min-h-[44px] meets the ADA / Apple HIG tap-target guideline
        // (Phase 2 of task_plan-mobile-copilot.md). Desktop layouts are
        // unaffected — the existing px-3 py-2 already exceeded 36px most
        // of the time once the 18px icon is factored in.
        'flex items-center gap-3 rounded-lg px-3 py-2 min-h-[44px] text-sm font-medium transition-colors',
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

  // When the group has an href, render the icon+label as a Link (navigates)
  // and the chevron as a separate toggle button (expands/collapses). This
  // gives the operator one click to go to the index AND one click to expand
  // the children — the previous toggle-only behaviour hid the index route.
  const labelActive = !!group.href && isActive(pathname, group.href) && !anyChildActive
  const Header = group.href
    ? (
        <div
          className="flex items-center rounded-lg overflow-hidden"
          style={(labelActive || anyChildActive)
            ? { backgroundColor: '#1a1a2e' }
            : undefined}
        >
          <Link
            href={group.href}
            className="flex-1 flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors"
            style={{
              color:      labelActive || anyChildActive ? '#e8e8f0' : '#9090b0',
              borderLeft: labelActive || anyChildActive ? '2px solid #6c63ff' : undefined,
            }}
            onMouseEnter={e => { if (!labelActive && !anyChildActive) e.currentTarget.style.backgroundColor = '#12121e' }}
            onMouseLeave={e => { if (!labelActive && !anyChildActive) e.currentTarget.style.backgroundColor = 'transparent' }}
          >
            <Icon size={18} className="shrink-0" />
            <span className="flex-1 text-left truncate">{group.label}</span>
          </Link>
          <button
            onClick={onToggle}
            aria-label={open ? `Collapse ${group.label}` : `Expand ${group.label}`}
            className="shrink-0 px-2 py-2 transition-colors"
            style={{ color: anyChildActive || labelActive ? '#a8a3ff' : '#55556a' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#e8e8f0' }}
            onMouseLeave={e => { e.currentTarget.style.color = anyChildActive || labelActive ? '#a8a3ff' : '#55556a' }}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      )
    : (
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
      )

  return (
    <div>
      {Header}
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

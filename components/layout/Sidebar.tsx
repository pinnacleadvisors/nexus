'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import {
  Hammer,
  LayoutDashboard,
  Kanban,
  Wrench,
  Bot,
  Network,
  Sparkles,
  Workflow,
  ChevronLeft,
  ChevronRight,
  Zap,
  Share2,
  BookOpen,
  GitBranch,
  Terminal,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/forge',          label: 'Forge',      segment: 'forge',     icon: Hammer },
  { href: '/dashboard',      label: 'Dashboard',  segment: 'dashboard', icon: LayoutDashboard },
  { href: '/dashboard/org',  label: 'Org Chart',  segment: 'dashboard', icon: GitBranch },
  { href: '/board',          label: 'Board',      segment: 'board',     icon: Kanban },
  { href: '/build',          label: 'Build',      segment: 'build',     icon: Terminal },
  { href: '/swarm',          label: 'Swarm',      segment: 'swarm',     icon: Network },
  { href: '/graph',          label: 'Graph',      segment: 'graph',     icon: Share2 },
  { href: '/tools/content',  label: 'Content',    segment: 'tools',     icon: Sparkles },
  { href: '/tools/agents',   label: 'Agents',     segment: 'tools',     icon: Bot },
  { href: '/tools/n8n',      label: 'Workflows',  segment: 'tools',     icon: Workflow },
  { href: '/tools/library',  label: 'Library',    segment: 'tools',     icon: BookOpen },
  { href: '/tools',          label: 'Tools',      segment: 'tools',     icon: Wrench },
]

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const segment = useSelectedLayoutSegment()

  return (
    <aside
      className={cn(
        'flex flex-col h-full shrink-0 border-r transition-all duration-200',
        collapsed ? 'w-16' : 'w-60'
      )}
      style={{
        backgroundColor: '#0d0d14',
        borderColor: '#24243e',
      }}
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
          <Zap size={16} className="text-white" />
        </div>
        {!collapsed && (
          <span className="font-bold text-lg tracking-tight" style={{ color: '#e8e8f0' }}>
            Nexus
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1">
        {NAV_ITEMS.map(({ href, label, segment: seg, icon: Icon }) => {
          const active = segment === seg
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                collapsed && 'justify-center px-0',
                active
                  ? 'text-white border-l-2'
                  : 'hover:text-white'
              )}
              style={
                active
                  ? { backgroundColor: '#1a1a2e', borderColor: '#6c63ff', color: '#fff' }
                  : { color: '#9090b0' }
              }
              onMouseEnter={e => {
                if (!active) {
                  ;(e.currentTarget as HTMLAnchorElement).style.backgroundColor = '#12121e'
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  ;(e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'transparent'
                }
              }}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && label}
            </Link>
          )
        })}
      </nav>

      {/* Bottom: user + collapse toggle */}
      <div className="px-2 pb-4 space-y-2 shrink-0">
        <div
          className={cn(
            'flex items-center px-3 py-2',
            collapsed && 'justify-center px-0'
          )}
        >
          <UserButton />
          {!collapsed && (
            <span className="ml-3 text-sm" style={{ color: '#9090b0' }}>
              Account
            </span>
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
            ;(e.currentTarget as HTMLButtonElement).style.color = '#9090b0'
            ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = '#12121e'
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLButtonElement).style.color = '#55556a'
            ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
          }}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}

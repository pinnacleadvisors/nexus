'use client'

import Link from 'next/link'
import type { Tool, ToolCategory } from '@/lib/types'
import {
  Bot,
  Cpu,
  Sparkles,
  Network,
  Database,
  GitBranch,
  Rocket,
  KeyRound,
  BarChart2,
  ShieldAlert,
  CreditCard,
  Mail,
  MessageSquare,
} from 'lucide-react'

const ICON_MAP: Record<string, React.ElementType> = {
  Bot,
  Cpu,
  Sparkles,
  Network,
  Database,
  GitBranch,
  Rocket,
  KeyRound,
  BarChart2,
  ShieldAlert,
  CreditCard,
  Mail,
  MessageSquare,
}

const STATUS_STYLE: Record<Tool['status'], { label: string; color: string; bg: string; border: string }> = {
  available:    { label: 'Connected',    color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.25)' },
  beta:         { label: 'Beta',         color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.25)' },
  'coming-soon':{ label: 'Coming Soon',  color: '#55556a', bg: 'rgba(85,85,106,0.1)',   border: 'rgba(85,85,106,0.25)' },
}

const CATEGORY_ORDER: ToolCategory[] = ['AI', 'Automation', 'Database', 'DevOps', 'Analytics', 'Finance', 'Communication']

interface Props {
  tool: Tool
}

export default function ToolCard({ tool }: Props) {
  const Icon = ICON_MAP[tool.icon] ?? Bot
  const s = STATUS_STYLE[tool.status]

  const card = (
    <div
      className="group rounded-xl p-4 flex flex-col gap-3 transition-all h-full"
      style={{
        backgroundColor: '#12121e',
        border: '1px solid #24243e',
      }}
    >
      {/* Icon + status */}
      <div className="flex items-start justify-between">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: '#1a1a2e', border: '1px solid #24243e' }}
        >
          <Icon size={20} style={{ color: '#6c63ff' }} />
        </div>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ color: s.color, backgroundColor: s.bg, border: `1px solid ${s.border}` }}
        >
          {s.label}
        </span>
      </div>

      {/* Name + description */}
      <div className="flex-1">
        <p className="font-semibold text-sm mb-1" style={{ color: '#e8e8f0' }}>
          {tool.name}
        </p>
        <p className="text-xs leading-relaxed" style={{ color: '#9090b0' }}>
          {tool.description}
        </p>
      </div>
    </div>
  )

  if (tool.href && tool.status === 'available') {
    const hoverHandlers = {
      onMouseEnter: (e: React.MouseEvent) => {
        const div = (e.currentTarget as HTMLElement).querySelector('div') as HTMLDivElement
        if (div) { div.style.borderColor = '#32325a'; div.style.backgroundColor = '#1a1a2e' }
      },
      onMouseLeave: (e: React.MouseEvent) => {
        const div = (e.currentTarget as HTMLElement).querySelector('div') as HTMLDivElement
        if (div) { div.style.borderColor = '#24243e'; div.style.backgroundColor = '#12121e' }
      },
    }

    if (tool.href.startsWith('/')) {
      return (
        <Link href={tool.href} className="block h-full no-underline" {...hoverHandlers}>
          {card}
        </Link>
      )
    }

    return (
      <a
        href={tool.href}
        target="_blank"
        rel="noopener noreferrer"
        className="block h-full no-underline"
        {...hoverHandlers}
      >
        {card}
      </a>
    )
  }

  return card
}

export { CATEGORY_ORDER }

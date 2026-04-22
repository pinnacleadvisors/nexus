'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Bot, Globe, BrainCircuit, Wand2, Layers, Hash, Cpu,
  Terminal, FileCode, ChevronLeft, Copy, Check, Search, Loader2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AgentDefinition } from '@/lib/types'

// Per-slug visual hints — falls back to Bot for anything unknown.
const ICON_BY_SLUG: Record<string, LucideIcon> = {
  firecrawl:             Globe,
  supermemory:           BrainCircuit,
  'workflow-optimizer':  Wand2,
  'agent-generator':     Layers,
  'nexus-architect':     Cpu,
  'nexus-memory':        BrainCircuit,
  'nexus-tester':        Terminal,
}

export default function ManagedAgentsPage() {
  const [agents, setAgents]     = useState<AgentDefinition[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [query, setQuery]       = useState('')
  const [activeSlug, setActive] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/agents/managed')
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        if (json.error) setError(json.error)
        else setAgents(json.agents ?? [])
      })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return agents
    return agents.filter(a =>
      a.slug.toLowerCase().includes(q)
      || a.name.toLowerCase().includes(q)
      || a.description.toLowerCase().includes(q)
      || a.tools.some(t => t.toLowerCase().includes(q))
    )
  }, [agents, query])

  const active = activeSlug ? agents.find(a => a.slug === activeSlug) ?? null : null

  return (
    <div className="p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs mb-1" style={{ color: '#55556a' }}>
            <Link href="/tools/agents" className="hover:underline" style={{ color: '#9090b0' }}>
              Agents
            </Link>
            <span>/</span>
            <span>Managed</span>
          </div>
          <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>
            Managed Agents
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#9090b0' }}>
            Claude managed subagents — specs live in <code style={{ color: '#6c63ff' }}>.claude/agents/*.md</code>.
            Each is transferable to other runtimes.
          </p>
        </div>

        <Link
          href="/tools/agents"
          className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ backgroundColor: '#12121e', color: '#9090b0', border: '1px solid #24243e' }}
        >
          <ChevronLeft size={12} />
          Capabilities
        </Link>
      </div>

      {/* Search */}
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2 mb-5 max-w-md"
        style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
      >
        <Search size={14} style={{ color: '#55556a' }} />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name, description, or tool…"
          className="w-full bg-transparent text-xs outline-none"
          style={{ color: '#e8e8f0' }}
        />
        <span className="text-xs" style={{ color: '#55556a' }}>
          {filtered.length}/{agents.length}
        </span>
      </div>

      {/* State banners */}
      {loading && (
        <div className="flex items-center gap-2 text-xs" style={{ color: '#9090b0' }}>
          <Loader2 size={12} className="animate-spin" />
          Loading agent specs…
        </div>
      )}
      {error && (
        <div
          className="text-xs rounded-lg px-3 py-2 mb-4"
          style={{ backgroundColor: '#2e1a1a', color: '#f87171' }}
        >
          {error}
        </div>
      )}

      {/* Grid */}
      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(agent => (
            <AgentCard
              key={agent.slug}
              agent={agent}
              onOpen={() => setActive(agent.slug)}
            />
          ))}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-xs text-center mt-8" style={{ color: '#55556a' }}>
          {agents.length === 0
            ? 'No managed agents found. Add specs to .claude/agents/*.md.'
            : 'No agents match your search.'}
        </p>
      )}

      {/* Detail drawer */}
      {active && (
        <DetailDrawer agent={active} onClose={() => setActive(null)} />
      )}
    </div>
  )
}

function AgentCard({ agent, onOpen }: { agent: AgentDefinition; onOpen: () => void }) {
  const Icon = ICON_BY_SLUG[agent.slug] ?? Bot
  return (
    <button
      onClick={onOpen}
      className="text-left rounded-xl p-4 flex flex-col gap-3 transition-colors"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
      onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#6c63ff')}
      onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#24243e')}
    >
      <div className="flex items-start justify-between">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: '#1a1a2e' }}
        >
          <Icon size={18} style={{ color: '#6c63ff' }} />
        </div>
        <div className="flex items-center gap-1.5">
          {agent.transferable && (
            <span
              className="text-xs px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: '#1a2e1a', color: '#4ade80' }}
            >
              Transferable
            </span>
          )}
          <span
            className="text-xs px-1.5 py-0.5 rounded font-mono"
            style={{ backgroundColor: '#12121e', color: '#9090b0' }}
          >
            {agent.model}
          </span>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
          {agent.name}
        </h3>
        <p className="text-xs font-mono mt-0.5" style={{ color: '#55556a' }}>
          {agent.slug}
        </p>
      </div>

      <p className="text-xs leading-relaxed line-clamp-3" style={{ color: '#9090b0' }}>
        {agent.description || 'No description.'}
      </p>

      <div className="flex flex-wrap gap-1 mt-auto pt-2" style={{ borderTop: '1px solid #1a1a2e' }}>
        {agent.tools.slice(0, 4).map(tool => (
          <span
            key={tool}
            className="text-xs px-1.5 py-0.5 rounded font-mono"
            style={{ backgroundColor: '#12121e', color: '#9090b0' }}
          >
            {tool}
          </span>
        ))}
        {agent.tools.length > 4 && (
          <span className="text-xs px-1.5 py-0.5" style={{ color: '#55556a' }}>
            +{agent.tools.length - 4}
          </span>
        )}
      </div>
    </button>
  )
}

function DetailDrawer({ agent, onClose }: { agent: AgentDefinition; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const Icon = ICON_BY_SLUG[agent.slug] ?? Bot

  async function copyPrompt() {
    await navigator.clipboard.writeText(agent.systemPrompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid #24243e' }}
        >
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: '#1a1a2e' }}
          >
            <Icon size={18} style={{ color: '#6c63ff' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
              {agent.name}
            </h2>
            <p className="text-xs font-mono" style={{ color: '#55556a' }}>
              {agent.sourcePath ?? `.claude/agents/${agent.slug}.md`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg"
            style={{ color: '#9090b0' }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1a1a2e')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        {/* Metadata strip */}
        <div
          className="shrink-0 px-5 py-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs"
          style={{ borderBottom: '1px solid #24243e' }}
        >
          <MetaRow icon={Hash} label="Slug" value={<code style={{ color: '#e8e8f0' }}>{agent.slug}</code>} />
          <MetaRow icon={Cpu}  label="Model" value={<code style={{ color: '#e8e8f0' }}>{agent.model}</code>} />
          <MetaRow
            icon={Bot}
            label="Transferable"
            value={
              <span style={{ color: agent.transferable ? '#4ade80' : '#f87171' }}>
                {agent.transferable ? 'Yes' : 'No'}
              </span>
            }
          />
          <MetaRow
            icon={FileCode}
            label="Version"
            value={<span style={{ color: '#e8e8f0' }}>{agent.version ?? 1}</span>}
          />
        </div>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          {/* Description */}
          <Section label="Description">
            <p className="text-xs leading-relaxed" style={{ color: '#c8c8e0' }}>
              {agent.description || <span style={{ color: '#55556a' }}>No description.</span>}
            </p>
          </Section>

          {/* Tools */}
          <Section label={`Tools (${agent.tools.length})`}>
            {agent.tools.length === 0 ? (
              <p className="text-xs" style={{ color: '#55556a' }}>No tools declared.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {agent.tools.map(tool => (
                  <span
                    key={tool}
                    className="text-xs px-2 py-1 rounded-md font-mono"
                    style={{ backgroundColor: '#0d0d14', color: '#9090b0', border: '1px solid #24243e' }}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            )}
          </Section>

          {/* Env vars */}
          <Section label={`Environment (${agent.envVars.length})`}>
            {agent.envVars.length === 0 ? (
              <p className="text-xs" style={{ color: '#55556a' }}>No env vars required.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {agent.envVars.map(v => (
                  <span
                    key={v}
                    className="text-xs px-2 py-1 rounded-md font-mono"
                    style={{ backgroundColor: '#1a1a2e', color: '#fbbf24' }}
                  >
                    {v}
                  </span>
                ))}
              </div>
            )}
          </Section>

          {/* System prompt */}
          <Section
            label="System prompt"
            action={
              <button
                onClick={copyPrompt}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md"
                style={{ backgroundColor: '#0d0d14', color: copied ? '#4ade80' : '#9090b0', border: '1px solid #24243e' }}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            }
          >
            <pre
              className="text-xs font-mono whitespace-pre-wrap leading-relaxed rounded-lg p-3"
              style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#c8c8e0' }}
            >
              {agent.systemPrompt}
            </pre>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({
  label,
  action,
  children,
}: {
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#9090b0' }}>
          {label}
        </h3>
        {action}
      </div>
      {children}
    </div>
  )
}

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={12} style={{ color: '#55556a' }} />
      <span style={{ color: '#55556a' }}>{label}:</span>
      <span>{value}</span>
    </div>
  )
}

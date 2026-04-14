'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  BookOpen, Code2, Bot, MessageSquare, Zap,
  Search, Copy, Check, ChevronRight, Plus,
  X, Loader2, Star, TrendingUp, Coins,
  ShieldAlert, AlertTriangle,
} from 'lucide-react'
import type {
  LibraryType,
  CodeSnippet,
  AgentTemplate,
  PromptTemplate,
  SkillDefinition,
  LibraryEntry,
  LibrarySearchResult,
} from '@/lib/library/types'
import {
  LANGUAGE_COLORS,
  RISK_COLORS,
  FORMAT_LABELS,
  TOKENS_PER_HIT,
} from '@/lib/library/types'

// ── Tab config ────────────────────────────────────────────────────────────────
const TABS: Array<{ id: LibraryType; label: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = [
  { id: 'code',   label: 'Code',    Icon: Code2 as React.ComponentType<{ size?: number; className?: string }> },
  { id: 'agent',  label: 'Agents',  Icon: Bot as React.ComponentType<{ size?: number; className?: string }> },
  { id: 'prompt', label: 'Prompts', Icon: MessageSquare as React.ComponentType<{ size?: number; className?: string }> },
  { id: 'skill',  label: 'Skills',  Icon: Zap as React.ComponentType<{ size?: number; className?: string }> },
]

// ── Sub-components ────────────────────────────────────────────────────────────
function QualityDots({ score }: { score: number }) {
  const filled = Math.round(score * 5)
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: i < filled ? '#6c63ff' : '#24243e' }}
        />
      ))}
    </span>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
      style={{ backgroundColor: '#1a1a2e', color: copied ? '#22c55e' : '#9090b0' }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// ── Code card ─────────────────────────────────────────────────────────────────
function CodeCard({ entry }: { entry: CodeSnippet }) {
  const [expanded, setExpanded] = useState(false)
  const langColor = LANGUAGE_COLORS[entry.language] ?? { bg: '#1a1a2e', text: '#9090b0' }

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate" style={{ color: '#e8e8f0' }}>
            {entry.title}
          </h3>
          <p className="text-xs mt-0.5 line-clamp-2" style={{ color: '#9090b0' }}>
            {entry.description}
          </p>
        </div>
        <span
          className="shrink-0 text-xs px-2 py-0.5 rounded-full font-mono"
          style={{ backgroundColor: langColor.bg, color: langColor.text }}
        >
          {entry.language}
        </span>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1">
        {entry.tags.slice(0, 4).map(tag => (
          <span key={tag} className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#12121e', color: '#55556a' }}>
            {tag}
          </span>
        ))}
      </div>

      {/* Code preview / expand */}
      {expanded && (
        <pre
          className="text-xs rounded-lg p-3 overflow-x-auto font-mono leading-relaxed"
          style={{ backgroundColor: '#060609', color: '#c8c8e0', border: '1px solid #1a1a2e', maxHeight: 240, overflowY: 'auto' }}
        >
          {entry.code}
        </pre>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid #1a1a2e' }}>
        <div className="flex items-center gap-3">
          <QualityDots score={entry.avg_quality_score} />
          <span className="text-xs" style={{ color: '#55556a' }}>
            {entry.usage_count} uses
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ backgroundColor: '#12121e', color: '#9090b0' }}
          >
            {expanded ? 'Hide' : 'View'}
          </button>
          <CopyButton text={entry.code} />
        </div>
      </div>
    </div>
  )
}

// ── Agent card ────────────────────────────────────────────────────────────────
function AgentCard({ entry }: { entry: AgentTemplate }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate" style={{ color: '#e8e8f0' }}>
              {entry.name}
            </h3>
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#1a1a2e', color: '#818cf8' }}>
              v{entry.version}
            </span>
          </div>
          <p className="text-xs mt-0.5 line-clamp-2" style={{ color: '#9090b0' }}>
            {entry.role}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {entry.tags.slice(0, 4).map(tag => (
          <span key={tag} className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#12121e', color: '#55556a' }}>
            {tag}
          </span>
        ))}
      </div>

      {expanded && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium" style={{ color: '#55556a' }}>System Prompt</p>
          <pre
            className="text-xs rounded-lg p-3 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap"
            style={{ backgroundColor: '#060609', color: '#c8c8e0', border: '1px solid #1a1a2e', maxHeight: 200 }}
          >
            {entry.system_prompt}
          </pre>
          {entry.constraints.length > 0 && (
            <>
              <p className="text-xs font-medium" style={{ color: '#55556a' }}>Constraints</p>
              <ul className="text-xs space-y-0.5" style={{ color: '#9090b0' }}>
                {entry.constraints.map((c, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span style={{ color: '#6c63ff' }}>·</span> {c}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid #1a1a2e' }}>
        <div className="flex items-center gap-3">
          <QualityDots score={entry.avg_quality_score} />
          <span className="text-xs" style={{ color: '#55556a' }}>{entry.usage_count} uses</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs px-2 py-1 rounded"
            style={{ backgroundColor: '#12121e', color: '#9090b0' }}
          >
            {expanded ? 'Hide' : 'View'}
          </button>
          <CopyButton text={entry.system_prompt} />
        </div>
      </div>
    </div>
  )
}

// ── Prompt card ───────────────────────────────────────────────────────────────
function PromptCard({ entry }: { entry: PromptTemplate }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate" style={{ color: '#e8e8f0' }}>
            {entry.name}
          </h3>
          <p className="text-xs mt-0.5 line-clamp-2" style={{ color: '#9090b0' }}>
            {entry.description}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#1a2e1a', color: '#4ade80' }}>
            {FORMAT_LABELS[entry.format]}
          </span>
        </div>
      </div>

      {/* Variables */}
      {entry.variables.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.variables.map(v => (
            <span key={v} className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: '#12121e', color: '#818cf8' }}>
              {`{{${v}}}`}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <pre
          className="text-xs rounded-lg p-3 overflow-y-auto whitespace-pre-wrap leading-relaxed"
          style={{ backgroundColor: '#060609', color: '#c8c8e0', border: '1px solid #1a1a2e', maxHeight: 240 }}
        >
          {entry.template}
        </pre>
      )}

      <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid #1a1a2e' }}>
        <div className="flex items-center gap-3">
          <QualityDots score={entry.avg_quality_score} />
          <span className="text-xs" style={{ color: '#55556a' }}>
            <Star size={10} className="inline mr-0.5" style={{ color: '#fbbf24' }} />
            {entry.neuro_score}
          </span>
          <span className="text-xs" style={{ color: '#55556a' }}>{entry.usage_count} uses</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs px-2 py-1 rounded"
            style={{ backgroundColor: '#12121e', color: '#9090b0' }}
          >
            {expanded ? 'Hide' : 'View'}
          </button>
          <CopyButton text={entry.template} />
        </div>
      </div>
    </div>
  )
}

// ── Skill card ────────────────────────────────────────────────────────────────
function SkillCard({ entry }: { entry: SkillDefinition }) {
  const [expanded, setExpanded] = useState(false)
  const riskColor = RISK_COLORS[entry.risk_level]

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate font-mono" style={{ color: '#e8e8f0' }}>
            {entry.name}
          </h3>
          <p className="text-xs mt-0.5 line-clamp-2" style={{ color: '#9090b0' }}>
            {entry.description}
          </p>
        </div>
        <span
          className="shrink-0 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
          style={{ backgroundColor: riskColor.bg, color: riskColor.text }}
        >
          {entry.risk_level === 'high' && <ShieldAlert size={10} />}
          {entry.risk_level === 'medium' && <AlertTriangle size={10} />}
          {entry.risk_level}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: '#12121e', color: '#22d3ee' }}>
          {entry.mcp_tool_name}
        </span>
        {entry.requires_openclaw && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#12121e', color: '#6c63ff' }}>
            OpenClaw
          </span>
        )}
        {entry.tags.slice(0, 3).map(tag => (
          <span key={tag} className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#12121e', color: '#55556a' }}>
            {tag}
          </span>
        ))}
      </div>

      {expanded && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium" style={{ color: '#55556a' }}>Input Schema</p>
          <pre
            className="text-xs rounded-lg p-3 font-mono leading-relaxed overflow-x-auto"
            style={{ backgroundColor: '#060609', color: '#c8c8e0', border: '1px solid #1a1a2e', maxHeight: 160 }}
          >
            {JSON.stringify(entry.input_schema, null, 2)}
          </pre>
        </div>
      )}

      <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid #1a1a2e' }}>
        <div className="flex items-center gap-3">
          <QualityDots score={entry.avg_quality_score} />
          <span className="text-xs" style={{ color: '#55556a' }}>{entry.usage_count} uses</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs px-2 py-1 rounded"
            style={{ backgroundColor: '#12121e', color: '#9090b0' }}
          >
            {expanded ? 'Hide' : 'View'}
          </button>
          <CopyButton text={entry.mcp_tool_name} />
        </div>
      </div>
    </div>
  )
}

// ── Entry card router ─────────────────────────────────────────────────────────
function EntryCard({ type, entry }: { type: LibraryType; entry: LibraryEntry }) {
  if (type === 'code')   return <CodeCard   entry={entry as CodeSnippet} />
  if (type === 'agent')  return <AgentCard  entry={entry as AgentTemplate} />
  if (type === 'prompt') return <PromptCard entry={entry as PromptTemplate} />
  return <SkillCard entry={entry as SkillDefinition} />
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LibraryPage() {
  const [activeTab, setActiveTab]         = useState<LibraryType>('code')
  const [q, setQ]                         = useState('')
  const [results, setResults]             = useState<LibrarySearchResult[]>([])
  const [loading, setLoading]             = useState(false)
  const [totalUsage, setTotalUsage]       = useState<Record<LibraryType, number>>({
    code: 0, agent: 0, prompt: 0, skill: 0,
  })

  const tokensSaved = (Object.keys(totalUsage) as LibraryType[]).reduce(
    (sum, t) => sum + totalUsage[t] * TOKENS_PER_HIT[t],
    0,
  )

  const fetchEntries = useCallback(async (type: LibraryType, query: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ type, q: query, limit: '50' })
      const res    = await fetch(`/api/library?${params}`)
      if (res.ok) {
        const json = await res.json() as { results: LibrarySearchResult[] }
        setResults(json.results ?? [])
        // Accumulate usage counts for token savings counter
        const count = (json.results ?? []).reduce(
          (s: number, r: LibrarySearchResult) => s + (r.entry.usage_count ?? 0),
          0,
        )
        setTotalUsage(prev => ({ ...prev, [type]: count }))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchEntries(activeTab, q)
  }, [activeTab, fetchEntries])

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => fetchEntries(activeTab, q), 300)
    return () => clearTimeout(t)
  }, [q, activeTab, fetchEntries])

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#050508' }}>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold mb-1" style={{ color: '#e8e8f0' }}>
            Library
          </h1>
          <p className="text-sm" style={{ color: '#55556a' }}>
            Reusable code, agent templates, prompts, and skills. Agents query this before generating anything new.
          </p>
        </div>

        {/* Token savings banner */}
        <div
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl shrink-0"
          style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: '#1a1a2e' }}
          >
            <Coins size={15} style={{ color: '#6c63ff' }} />
          </div>
          <div>
            <p className="text-xs" style={{ color: '#55556a' }}>Est. tokens saved</p>
            <p className="text-base font-bold" style={{ color: '#6c63ff' }}>
              {tokensSaved.toLocaleString()}
            </p>
          </div>
          <div style={{ width: 1, height: 28, backgroundColor: '#24243e' }} />
          <div className="flex flex-col gap-1">
            {(Object.keys(TOKENS_PER_HIT) as LibraryType[]).map(t => (
              <div key={t} className="flex items-center gap-1.5 text-xs" style={{ color: '#55556a' }}>
                <TrendingUp size={9} />
                {t}: {TOKENS_PER_HIT[t]} / hit
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 flex-wrap">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              backgroundColor: activeTab === id ? '#6c63ff' : '#12121e',
              color:           activeTab === id ? '#fff'    : '#9090b0',
              border:          `1px solid ${activeTab === id ? '#6c63ff' : '#24243e'}`,
            }}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="relative mb-5">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: '#55556a' }}
        />
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={`Search ${activeTab} library…`}
          className="w-full pl-9 pr-4 py-2 text-sm rounded-lg outline-none"
          style={{
            backgroundColor: '#12121e',
            border: '1px solid #24243e',
            color: '#e8e8f0',
          }}
        />
        {q && (
          <button
            onClick={() => setQ('')}
            className="absolute right-3 top-1/2 -translate-y-1/2"
            style={{ color: '#55556a' }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin" style={{ color: '#6c63ff' }} />
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <BookOpen size={32} style={{ color: '#24243e' }} />
          <p className="text-sm" style={{ color: '#55556a' }}>
            {q ? `No results for "${q}"` : `No ${activeTab} entries yet`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {results.map(r => (
            <EntryCard key={r.entry.id} type={activeTab} entry={r.entry} />
          ))}
        </div>
      )}

      {/* Footer */}
      <p className="mt-8 text-xs text-center" style={{ color: '#24243e' }}>
        {results.length} entr{results.length !== 1 ? 'ies' : 'y'} · Agent auto-extraction active ·{' '}
        <code style={{ color: '#55556a' }}>POST /api/library</code> to add programmatically
      </p>
    </div>
  )
}

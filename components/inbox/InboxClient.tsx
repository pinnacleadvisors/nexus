'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ShieldCheck, ListTodo, Activity, Filter, CheckSquare, Loader2, Sparkles, BookOpen, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import ApprovalCard from '@/components/approvals/ApprovalCard'
import type { InboxItem, InboxKind } from './types'

type FilterKind = 'all' | 'approval' | 'issue' | 'task' | 'activity' | 'system-alert'

const FILTER_LABEL: Record<FilterKind, string> = {
  all:            'All',
  approval:       'Approvals',
  issue:          'Mine',
  task:           'To-dos',
  activity:       'Recent',
  'system-alert': 'Alerts',
}

const KIND_ICON: Record<InboxKind, typeof ShieldCheck> = {
  approval:       ShieldCheck,
  issue:          ListTodo,
  task:           CheckSquare,
  activity:       Activity,
  'system-alert': AlertTriangle,
}

const KIND_COLOR: Record<InboxKind, string> = {
  approval:       'text-amber-400',
  issue:          'text-cyan-400',
  task:           'text-emerald-400',
  activity:       'text-zinc-500',
  'system-alert': 'text-orange-400',
}

function shortRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const sec  = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (sec < 60)    return `${sec}s ago`
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

interface Props {
  items: InboxItem[]
}

export default function InboxClient({ items: initialItems }: Props) {
  const [filter, setFilter] = useState<FilterKind>('all')
  // Local state so "mark done" + seed-backlog updates without a full reload.
  const [items, setItems] = useState<InboxItem[]>(initialItems)

  // Track which tasks have been done locally — optimistic toggle.
  const handleTaskDone = useCallback((taskId: string) => {
    setItems(prev => prev.filter(it => !(it.kind === 'task' && it.id === taskId)))
  }, [])

  const counts = useMemo(() => {
    const c: Record<FilterKind, number> = { all: items.length, approval: 0, issue: 0, task: 0, activity: 0, 'system-alert': 0 }
    for (const it of items) c[it.kind]++
    return c
  }, [items])

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter(i => i.kind === filter)),
    [items, filter],
  )

  // Banner — show when ZERO operator-source admin-scope tasks exist AND the
  // deferred-audit backlog hasn't been seeded yet. The seed flow inserts 20+
  // rows at once, so this banner disappears on the next reload after a seed.
  const adminTaskCount = useMemo(
    () => items.filter(it => it.kind === 'task' && it.data.scope === 'admin').length,
    [items],
  )

  return (
    <div>
      {adminTaskCount === 0 && <SeedBacklogBanner onSeedComplete={async () => {
        // Refetch the inbox to surface the new rows. Cheap full reload —
        // the inbox doesn't have a partial-refresh API yet.
        if (typeof window !== 'undefined') window.location.reload()
      }} />}

      <nav className="mb-4 flex flex-wrap items-center gap-2" aria-label="Inbox filters">
        {(Object.keys(FILTER_LABEL) as FilterKind[]).map(k => {
          const count = counts[k]
          const active = filter === k
          return (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ' +
                (active
                  ? 'border-zinc-600 bg-zinc-800/70 text-zinc-100'
                  : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200')
              }
            >
              {k === 'all' && <Filter className="h-3 w-3" />}
              {FILTER_LABEL[k]}
              <span className={active ? 'text-zinc-400' : 'text-zinc-600'}>{count}</span>
            </button>
          )
        })}
      </nav>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-zinc-400">
            {filter === 'all'
              ? 'Nothing in your inbox. All caught up.'
              : `No ${FILTER_LABEL[filter].toLowerCase()} items right now.`}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map(item => (
            <li key={`${item.kind}-${item.id}`}>
              <InboxRow item={item} onTaskDone={handleTaskDone} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function InboxRow({ item, onTaskDone }: { item: InboxItem; onTaskDone?: (id: string) => void }) {
  // Approvals: keep the existing rich ApprovalCard (approve/reject inline).
  if (item.kind === 'approval') {
    return <ApprovalCard approval={item.data} />
  }

  const Icon = KIND_ICON[item.kind]
  const iconColor = KIND_COLOR[item.kind]

  if (item.kind === 'task') {
    return <TaskRow data={item.data} Icon={Icon} iconColor={iconColor} onDone={onTaskDone} />
  }

  if (item.kind === 'system-alert') {
    const d = item.data
    const body = (
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${iconColor}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-200">{d.title}</span>
            <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-orange-300">
              {d.source.replace('-', ' ')}
            </span>
          </div>
          {d.meta && <div className="mt-0.5 text-xs text-zinc-400">{d.meta}</div>}
          <div className="mt-0.5 text-[10px] text-zinc-500">{shortRelative(d.created_at)} · auto-clears when resolved</div>
        </div>
      </div>
    )
    return d.href ? (
      <Link href={d.href} className="block rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-orange-700/40 hover:bg-zinc-900/60">
        {body}
      </Link>
    ) : (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">{body}</div>
    )
  }

  if (item.kind === 'issue') {
    const d = item.data
    return (
      <Link
        href={`/businesses/${d.business_slug}/issues`}
        className="block rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-700 hover:bg-zinc-900/60"
      >
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${iconColor}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-200">{d.title}</span>
              <span className="rounded-full bg-zinc-800/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                {d.status_category}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
              <Link href={`/businesses/${d.business_slug}`} className="hover:text-zinc-300" onClick={e => e.stopPropagation()}>
                {d.business_slug}
              </Link>
              <span className="text-zinc-700">·</span>
              <span>{d.status}</span>
              <span className="text-zinc-700">·</span>
              <time dateTime={d.updated_at}>{shortRelative(d.updated_at)}</time>
            </div>
          </div>
        </div>
      </Link>
    )
  }

  // activity
  if (item.kind !== 'activity') return null  // exhaustiveness — task handled above
  const d = item.data
  const businessHref = d.business_slug ? `/businesses/${d.business_slug}` : null
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${iconColor}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono text-zinc-300">{d.event_type}</span>
            {businessHref && (
              <>
                <span className="text-zinc-700">·</span>
                <Link href={businessHref} className="text-zinc-400 hover:text-zinc-200">
                  {d.business_slug}
                </Link>
              </>
            )}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            <time dateTime={d.created_at}>{shortRelative(d.created_at)}</time>
          </div>
        </div>
      </div>
    </div>
  )
}

function TaskRow({ data, Icon, iconColor, onDone }: {
  data:      Extract<InboxItem, { kind: 'task' }>['data']
  Icon:      typeof ShieldCheck
  iconColor: string
  onDone?:   (id: string) => void
}) {
  const [marking, setMarking] = useState(false)
  // Explain dropdown — collapsed by default. The guide is fetched the first
  // time the operator clicks Explain and cached on the row server-side
  // (operator_tasks.explanation), so reopens are free.
  const [explainOpen,    setExplainOpen]    = useState(false)
  const [explainLoading, setExplainLoading] = useState(false)
  const [explainError,   setExplainError]   = useState<string | null>(null)
  const [explainText,    setExplainText]    = useState<string | null>(null)
  const [explainCached,  setExplainCached]  = useState(false)
  const scopeLabel = data.scope === 'admin' ? 'platform' : data.scope.replace(/^business:/, '')

  async function markDone() {
    if (marking) return
    setMarking(true)
    try {
      // Reuse the existing PATCH endpoint that the chat Views panel uses.
      // 200 even on transient failures (retry-storm safe).
      const res = await fetch(`/api/views/tasks/${data.id}`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ done: true }),
      })
      if (res.ok) {
        onDone?.(data.id)
      } else {
        setMarking(false)
      }
    } catch {
      setMarking(false)
    }
  }

  async function explain() {
    // Toggle behavior: clicking when open just collapses. Clicking when
    // closed expands and fetches if we don't have a guide yet.
    if (explainOpen) {
      setExplainOpen(false)
      return
    }
    setExplainOpen(true)
    if (explainText) return  // already have it for this session
    setExplainLoading(true); setExplainError(null)
    try {
      const res = await fetch(`/api/views/tasks/${data.id}/explain`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({}),
      })
      const json = (await res.json()) as {
        ok: boolean; explanation?: string; cached?: boolean; error?: string
      }
      if (json.ok && json.explanation) {
        setExplainText(json.explanation)
        setExplainCached(json.cached === true)
      } else {
        setExplainError(json.error || 'Could not generate a guide.')
      }
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : 'request failed')
    } finally {
      setExplainLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-700 hover:bg-zinc-900/60">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${iconColor}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <span className="text-sm text-zinc-200 leading-snug flex-1">{data.title}</span>
            <span className="rounded-full bg-zinc-800/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400 shrink-0 mt-0.5">
              {scopeLabel}
            </span>
          </div>
          {data.description && (
            <p className="mt-1 text-xs text-zinc-400 leading-relaxed line-clamp-2">{data.description}</p>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-500">
            <span>{data.source === 'agent' ? 'AI-flagged' : 'manual'}</span>
            <span className="text-zinc-700">·</span>
            <time dateTime={data.created_at}>{shortRelative(data.created_at)}</time>
            {data.due_at && (
              <>
                <span className="text-zinc-700">·</span>
                <span>due {shortRelative(data.due_at)}</span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          <button
            type="button"
            onClick={explain}
            disabled={explainLoading}
            className="rounded-lg border border-indigo-700/60 bg-indigo-900/30 px-2.5 py-1 text-[11px] text-indigo-200 transition hover:bg-indigo-900/50 disabled:opacity-40 inline-flex items-center gap-1"
            title="Generate / show an in-depth step-by-step guide for this task"
            aria-expanded={explainOpen}
          >
            {explainLoading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <BookOpen className="h-3 w-3" />}
            <span className="hidden sm:inline">Explain</span>
            {explainOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={markDone}
            disabled={marking}
            className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:bg-zinc-700/70 disabled:opacity-40"
            title="Mark this task done — agents that read operator_tasks will see done=true"
          >
            {marking ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Done'}
          </button>
        </div>
      </div>
      {explainOpen && (
        <div className="mt-3 rounded-xl border border-indigo-900/40 bg-indigo-950/20 p-3">
          {explainLoading && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating step-by-step guide…
            </div>
          )}
          {explainError && !explainLoading && (
            <div className="flex items-start gap-2 text-xs text-rose-300">
              <span>{explainError}</span>
              <button
                type="button"
                onClick={() => { setExplainText(null); void explain() }}
                className="ml-auto rounded-md border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
              >
                Retry
              </button>
            </div>
          )}
          {explainText && !explainLoading && (
            <>
              <ExplainMarkdown text={explainText} />
              <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-500">
                <span>{explainCached ? 'cached guide' : 'fresh guide'}</span>
                <button
                  type="button"
                  onClick={async () => {
                    setExplainLoading(true); setExplainError(null)
                    try {
                      const res = await fetch(`/api/views/tasks/${data.id}/explain`, {
                        method:  'POST',
                        headers: { 'content-type': 'application/json' },
                        body:    JSON.stringify({ force: true }),
                      })
                      const json = (await res.json()) as { ok: boolean; explanation?: string; error?: string }
                      if (json.ok && json.explanation) {
                        setExplainText(json.explanation); setExplainCached(false)
                      } else setExplainError(json.error || 'Could not regenerate.')
                    } catch (e) {
                      setExplainError(e instanceof Error ? e.message : 'request failed')
                    } finally { setExplainLoading(false) }
                  }}
                  className="rounded-md border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 transition hover:bg-zinc-800"
                  title="Regenerate the guide (skips the cache)"
                >
                  Regenerate
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Minimal markdown renderer — no extra deps. Handles the subset the explain
 * route actually emits: `##` / `###` headings, bullet lists, inline `code`,
 * **bold**, links, and paragraph breaks. Untrusted HTML is escaped first so
 * we don't inherit an XSS vector via a future LLM regression.
 */
function ExplainMarkdown({ text }: { text: string }) {
  const escape = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) => escape(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-zinc-100">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[11px] text-amber-200">$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-300 hover:underline">$1</a>')

  const lines = text.split(/\r?\n/)
  const blocks: React.ReactNode[] = []
  let bullets: string[] = []
  let paragraph: string[] = []

  function flushBullets() {
    if (bullets.length === 0) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-1.5 ml-4 list-disc space-y-1 text-xs text-zinc-300">
        {bullets.map((b, i) => <li key={i} dangerouslySetInnerHTML={{ __html: inline(b) }} />)}
      </ul>,
    )
    bullets = []
  }
  function flushParagraph() {
    if (paragraph.length === 0) return
    const joined = paragraph.join(' ').trim()
    if (joined) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="my-1.5 text-xs leading-relaxed text-zinc-300"
           dangerouslySetInnerHTML={{ __html: inline(joined) }} />,
      )
    }
    paragraph = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('## ')) {
      flushBullets(); flushParagraph()
      blocks.push(<h3 key={`h2-${blocks.length}`} className="mt-2.5 text-sm font-semibold text-zinc-100"
        dangerouslySetInnerHTML={{ __html: inline(line.slice(3)) }} />)
    } else if (line.startsWith('### ')) {
      flushBullets(); flushParagraph()
      blocks.push(<h4 key={`h3-${blocks.length}`} className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-400"
        dangerouslySetInnerHTML={{ __html: inline(line.slice(4)) }} />)
    } else if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph()
      bullets.push(line.replace(/^\s*[-*]\s+/, ''))
    } else if (line === '') {
      flushBullets(); flushParagraph()
    } else {
      flushBullets()
      paragraph.push(line)
    }
  }
  flushBullets(); flushParagraph()

  return <div>{blocks}</div>
}

interface SeedPreview {
  ok:              boolean
  total:           number
  already_present: number
  would_seed:      number
  sample_titles:   string[]
}

function SeedBacklogBanner({ onSeedComplete }: { onSeedComplete: () => Promise<void> }) {
  const [preview, setPreview] = useState<SeedPreview | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Cheap dry-run on mount — banner only renders when there are tasks to seed.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/seed-deferred-tasks', { cache: 'no-store' })
        const j = (await res.json()) as SeedPreview | { ok: false; error: string }
        if (cancelled) return
        if ('ok' in j && j.ok && 'would_seed' in j && j.would_seed > 0) setPreview(j as SeedPreview)
      } catch {
        // Silent — banner is non-essential.
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (dismissed || !preview || preview.would_seed === 0) return null

  async function runSeed() {
    setSeeding(true)
    try {
      const res = await fetch('/api/admin/seed-deferred-tasks', { method: 'POST' })
      const j   = await res.json()
      if (j.ok) {
        await onSeedComplete()
      } else {
        alert(`Seed failed: ${j.error ?? 'unknown'}`)
        setSeeding(false)
      }
    } catch (e) {
      alert(`Seed failed: ${e instanceof Error ? e.message : e}`)
      setSeeding(false)
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-emerald-900/60 bg-emerald-950/30 p-4">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-zinc-100">
            Populate the deferred-audit backlog
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {preview.would_seed} task{preview.would_seed === 1 ? '' : 's'} from <code className="rounded bg-zinc-800/60 px-1 font-mono text-[10px]">lib/backlog/deferred-tasks.json</code> would be added to your inbox
            {preview.already_present > 0 && <> ({preview.already_present} already present, will be skipped)</>}.
            Examples: <span className="text-zinc-300">{preview.sample_titles.slice(0, 3).map(t => t.replace(/^\[\w+\] /, '')).join(' · ')}</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runSeed}
              disabled={seeding}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700 bg-emerald-900/50 px-3 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-900/70 disabled:opacity-40"
            >
              {seeding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {seeding ? 'Seeding…' : `Populate ${preview.would_seed} tasks`}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

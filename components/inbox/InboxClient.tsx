'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ShieldCheck, ListTodo, Activity, Filter, CheckSquare, Loader2, Sparkles, BookOpen, ChevronDown, ChevronUp, AlertTriangle, Briefcase, Eye } from 'lucide-react'
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

// R1 (UX consult): "since last visit" stamp. Stored per-operator in
// localStorage. Items newer than this get a green "NEW" pill so the
// operator can see at a glance what's happened since they last checked
// the inbox. "Mark all seen" updates the stamp to now().
const LAST_VISIT_KEY = 'nexus:inbox:last-visit'

type TimeBucket = 'last-hour' | 'today' | 'this-week' | 'older'

const BUCKET_LABEL: Record<TimeBucket, string> = {
  'last-hour': 'Last hour',
  'today':     'Today',
  'this-week': 'This week',
  'older':     'Older',
}

function bucketFor(iso: string, now: number): TimeBucket {
  const ts = new Date(iso).getTime()
  const ageMs = now - ts
  if (ageMs < 3600_000)        return 'last-hour'   // < 1h
  if (ageMs < 86400_000)       return 'today'       // < 24h
  if (ageMs < 7 * 86400_000)   return 'this-week'   // < 7d
  return 'older'
}

export default function InboxClient({ items: initialItems }: Props) {
  const [filter, setFilter] = useState<FilterKind>('all')
  // Local state so "mark done" + seed-backlog updates without a full reload.
  const [items, setItems] = useState<InboxItem[]>(initialItems)
  // R1: per-business filter. 'all' = no filter; otherwise the business slug.
  const [bizFilter, setBizFilter] = useState<string>('all')
  // R1: "since last visit" marker for the NEW-pill highlighting. Captured
  // on first render; the user clicks "Mark all seen" to bump it forward.
  const lastVisitRef = useRef<number>(0)
  const [lastVisitMs, setLastVisitMs] = useState<number>(0)

  useEffect(() => {
    // Read prior last-visit on mount. First-ever load: pretend it was just
    // now so we don't drown the operator in 30 days of "NEW" pills.
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_VISIT_KEY) : null
    const parsed = stored ? Number(stored) : Date.now()
    lastVisitRef.current = parsed
    setLastVisitMs(parsed)
  }, [])

  const markAllSeen = useCallback(() => {
    const now = Date.now()
    if (typeof window !== 'undefined') window.localStorage.setItem(LAST_VISIT_KEY, String(now))
    lastVisitRef.current = now
    setLastVisitMs(now)
  }, [])

  // Track which tasks have been done locally — optimistic toggle.
  const handleTaskDone = useCallback((taskId: string) => {
    setItems(prev => prev.filter(it => !(it.kind === 'task' && it.id === taskId)))
  }, [])

  const counts = useMemo(() => {
    const c: Record<FilterKind, number> = { all: items.length, approval: 0, issue: 0, task: 0, activity: 0, 'system-alert': 0 }
    for (const it of items) c[it.kind]++
    return c
  }, [items])

  // R1: unique business slugs across all items, for the per-biz dropdown.
  // 'all' + 'admin' (null slug → operator-scope) + alphabetised business slugs.
  const businessSlugs = useMemo(() => {
    const set = new Set<string>()
    for (const it of items) {
      const slug = it.business_slug
      if (slug) set.add(slug)
    }
    return Array.from(set).sort()
  }, [items])

  // R1: apply both filters (kind + business) + bucket the result.
  const filteredAndBucketed = useMemo(() => {
    const now = Date.now()
    const fk = filter === 'all' ? items : items.filter(i => i.kind === filter)
    const fb = bizFilter === 'all'
      ? fk
      : fk.filter(i => (i.business_slug ?? '') === bizFilter)
    const buckets: Record<TimeBucket, InboxItem[]> = {
      'last-hour': [], 'today': [], 'this-week': [], 'older': [],
    }
    for (const it of fb) buckets[bucketFor(it.created_at, now)].push(it)
    return { items: fb, buckets, total: fb.length }
  }, [items, filter, bizFilter])

  // R1: count of items newer than lastVisitMs across the filtered set.
  // Surfaces in the "Mark all seen" affordance so the operator knows
  // how many NEW pills they're about to clear.
  const newSinceLastVisit = useMemo(() => {
    if (!lastVisitMs) return 0
    return filteredAndBucketed.items.filter(it => new Date(it.created_at).getTime() > lastVisitMs).length
  }, [filteredAndBucketed.items, lastVisitMs])

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

      {/* R1: filter row + per-business dropdown + Mark all seen. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-2" aria-label="Inbox filters">
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
        <div className="flex flex-wrap items-center gap-2">
          {/* R1: per-business filter. Hidden when there's only one business. */}
          {businessSlugs.length > 1 && (
            <label className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/40 px-3 py-1 text-xs text-zinc-400">
              <Briefcase className="h-3 w-3" />
              <select
                value={bizFilter}
                onChange={e => setBizFilter(e.target.value)}
                className="bg-transparent text-zinc-200 outline-none"
                aria-label="Filter inbox by business"
              >
                <option value="all">All businesses</option>
                {businessSlugs.map(slug => <option key={slug} value={slug}>{slug}</option>)}
              </select>
            </label>
          )}
          {/* R1: Mark-all-seen. Shows the count of newly-arrived items as
              extra context so the operator knows what they're clearing. */}
          <button
            type="button"
            onClick={markAllSeen}
            disabled={newSinceLastVisit === 0}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/40 px-3 py-1 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
            title={newSinceLastVisit === 0 ? 'Nothing new since your last check' : `Clear ${newSinceLastVisit} NEW pill${newSinceLastVisit === 1 ? '' : 's'}`}
          >
            <Eye className="h-3 w-3" />
            Mark all seen
            {newSinceLastVisit > 0 && (
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">{newSinceLastVisit}</span>
            )}
          </button>
        </div>
      </div>

      {filteredAndBucketed.total === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-zinc-400">
            {filter === 'all' && bizFilter === 'all'
              ? 'Nothing in your inbox. All caught up.'
              : `No items match the current filters.`}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* R1: time-bucketed groups. Operator's mental model is now
              "what happened since last hour / today / this week" rather
              than "scroll through 30 events of unknown freshness". */}
          {(['last-hour', 'today', 'this-week', 'older'] as TimeBucket[]).map(b => {
            const bucketItems = filteredAndBucketed.buckets[b]
            if (bucketItems.length === 0) return null
            return (
              <section key={b}>
                <h2 className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-500">
                  {BUCKET_LABEL[b]}
                  <span className="rounded-full bg-zinc-800/60 px-1.5 text-[10px] text-zinc-400">{bucketItems.length}</span>
                </h2>
                <ul className="space-y-3">
                  {bucketItems.map(item => {
                    const isNew = lastVisitMs > 0 && new Date(item.created_at).getTime() > lastVisitMs
                    return (
                      <li key={`${item.kind}-${item.id}`} className="relative">
                        {isNew && (
                          <span
                            className="absolute -top-1.5 -right-1.5 z-10 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-emerald-300 ring-1 ring-emerald-500/40"
                            title="Arrived since your last inbox check"
                          >
                            NEW
                          </span>
                        )}
                        <InboxRow item={item} onTaskDone={handleTaskDone} />
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function InboxRow({ item, onTaskDone }: { item: InboxItem; onTaskDone?: (id: string) => void }) {
  const router = useRouter()
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
      <div
        role="link"
        tabIndex={0}
        onClick={() => router.push(`/businesses/${d.business_slug}/issues`)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/businesses/${d.business_slug}/issues`) } }}
        className="block cursor-pointer rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-700 hover:bg-zinc-900/60"
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
      </div>
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

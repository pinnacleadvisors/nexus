'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ShieldCheck, ListTodo, Activity, Filter, CheckSquare, Loader2, Sparkles } from 'lucide-react'
import ApprovalCard from '@/components/approvals/ApprovalCard'
import type { InboxItem, InboxKind } from './types'

type FilterKind = 'all' | 'approval' | 'issue' | 'task' | 'activity'

const FILTER_LABEL: Record<FilterKind, string> = {
  all:      'All',
  approval: 'Approvals',
  issue:    'Mine',
  task:     'To-dos',
  activity: 'Recent',
}

const KIND_ICON: Record<InboxKind, typeof ShieldCheck> = {
  approval: ShieldCheck,
  issue:    ListTodo,
  task:     CheckSquare,
  activity: Activity,
}

const KIND_COLOR: Record<InboxKind, string> = {
  approval: 'text-amber-400',
  issue:    'text-cyan-400',
  task:     'text-emerald-400',
  activity: 'text-zinc-500',
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
    const c = { all: items.length, approval: 0, issue: 0, task: 0, activity: 0 }
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
        <button
          type="button"
          onClick={markDone}
          disabled={marking}
          className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:bg-zinc-700/70 disabled:opacity-40"
          title="Mark this task done — agents that read operator_tasks will see done=true"
        >
          {marking ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Done'}
        </button>
      </div>
    </div>
  )
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

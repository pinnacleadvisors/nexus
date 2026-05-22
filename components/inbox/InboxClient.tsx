'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ShieldCheck, ListTodo, Activity, Filter } from 'lucide-react'
import ApprovalCard from '@/components/approvals/ApprovalCard'
import type { InboxItem, InboxKind } from './types'

type FilterKind = 'all' | 'approval' | 'issue' | 'activity'

const FILTER_LABEL: Record<FilterKind, string> = {
  all:      'All',
  approval: 'Approvals',
  issue:    'Mine',
  activity: 'Recent',
}

const KIND_ICON: Record<InboxKind, typeof ShieldCheck> = {
  approval: ShieldCheck,
  issue:    ListTodo,
  activity: Activity,
}

const KIND_COLOR: Record<InboxKind, string> = {
  approval: 'text-amber-400',
  issue:    'text-cyan-400',
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

export default function InboxClient({ items }: Props) {
  const [filter, setFilter] = useState<FilterKind>('all')

  const counts = useMemo(() => {
    const c = { all: items.length, approval: 0, issue: 0, activity: 0 }
    for (const it of items) c[it.kind]++
    return c
  }, [items])

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter(i => i.kind === filter)),
    [items, filter],
  )

  return (
    <div>
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
              <InboxRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function InboxRow({ item }: { item: InboxItem }) {
  // Approvals: keep the existing rich ApprovalCard (approve/reject inline).
  if (item.kind === 'approval') {
    return <ApprovalCard approval={item.data} />
  }

  const Icon = KIND_ICON[item.kind]
  const iconColor = KIND_COLOR[item.kind]

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

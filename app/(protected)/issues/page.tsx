/**
 * /issues — platform-wide issue feed (cross-business).
 *
 * Server component. Mirrors app/(protected)/businesses/[slug]/issues/page.tsx
 * but without the business_slug filter — operator sees every issue from every
 * business, grouped by status_category, filterable via URL params.
 *
 * Sidebar entry sits between Inbox and Businesses. Part of
 * task_plan-platform-expansion.md (Task F).
 */

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase'
import IssueRow from '@/components/issues/IssueRow'
import ReportIssueForm from '@/components/issues/ReportIssueForm'
import { ListTodo } from 'lucide-react'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

interface IssueRowData {
  id:                string
  business_slug:     string
  title:             string
  status:            string
  status_category:   string
  assignee_agent:    string | null
  assignee_user:     string | null
  goal_id:           string | null
  parent_id:         string | null
  created_at:        string
  updated_at:        string
}

const CATEGORIES = ['triage','unstarted','backlog','started','completed','cancelled'] as const

interface BusinessRow { slug: string; name: string }

async function fetchBusinesses(): Promise<BusinessRow[]> {
  const db = createServerClient()
  if (!db) return []
  const res = await (db as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: { message: string } | null }>
      }
    }
  }).from('business_operators')
    .select('slug,name')
    .order('slug', { ascending: true })
  return ((res.data ?? []) as BusinessRow[]) || []
}

async function fetchIssues(filters: { businessSlug?: string; statusCategory?: string }): Promise<IssueRowData[]> {
  const db = createServerClient()
  if (!db) return []
  type Chain = {
    eq: (c: string, v: string) => Chain
    order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: { message: string } | null }>
  }
  let chain = (db as unknown as {
    from: (t: string) => { select: (cols: string) => Chain }
  }).from('issues')
    .select('id,business_slug,title,status,status_category,assignee_agent,assignee_user,goal_id,parent_id,created_at,updated_at') as Chain

  if (filters.businessSlug) chain = chain.eq('business_slug', filters.businessSlug)
  if (filters.statusCategory && CATEGORIES.includes(filters.statusCategory as typeof CATEGORIES[number])) {
    chain = chain.eq('status_category', filters.statusCategory)
  }

  const res = await chain.order('updated_at', { ascending: false })
  return ((res.data ?? []) as IssueRowData[]) || []
}

interface PageProps {
  searchParams: Promise<{ business?: string; status?: string }>
}

export default async function PlatformIssuesPage({ searchParams }: PageProps) {
  // Owner-only — same gate as /audit and /settings.
  const session = await auth()
  if (!session.userId) redirect('/')

  const params       = await searchParams
  const businessSlug = (params.business || '').trim() || undefined
  const statusFilter = (params.status   || '').trim() || undefined

  const [businesses, issues] = await Promise.all([
    fetchBusinesses(),
    fetchIssues({ businessSlug, statusCategory: statusFilter }),
  ])

  const byCategory = new Map<string, IssueRowData[]>()
  for (const cat of CATEGORIES) byCategory.set(cat, [])
  for (const i of issues) {
    const cat = byCategory.get(i.status_category)
    if (cat) cat.push(i)
  }

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex items-center gap-3">
        <ListTodo className="h-6 w-6 text-zinc-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Issues</h1>
          <p className="text-sm text-zinc-400">{issues.length} total across {businessSlug ? `business "${businessSlug}"` : 'all businesses'}.</p>
        </div>
      </header>

      <ReportIssueForm businesses={businesses} />

      <form method="get" className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-zinc-500">Business</span>
          <select
            name="business"
            defaultValue={businessSlug ?? ''}
            className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-zinc-200"
          >
            <option value="">All businesses</option>
            {businesses.map(b => (
              <option key={b.slug} value={b.slug}>{b.name} ({b.slug})</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-zinc-500">Status</span>
          <select
            name="status"
            defaultValue={statusFilter ?? ''}
            className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-zinc-200"
          >
            <option value="">All statuses</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-500"
        >
          Apply
        </button>
        {(businessSlug || statusFilter) && (
          <Link
            href="/issues"
            className="text-zinc-400 hover:text-zinc-200"
          >
            Clear filters
          </Link>
        )}
      </form>

      {issues.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-zinc-400">No issues match the current filters. Apply migrations 047/048 if you expected rows here.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {CATEGORIES.map(cat => {
            const list = byCategory.get(cat) ?? []
            if (list.length === 0) return null
            return (
              <section key={cat}>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {cat} <span className="text-zinc-600">({list.length})</span>
                </h2>
                <ul className="divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
                  {list.map(i => <IssueRow key={i.id} issue={i} businessSlug={i.business_slug} />)}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * /businesses/[slug]/issues — threaded ticket feed (Paperclip absorption Task 3d).
 *
 * Server component. Lists issues for one business, grouped by status_category.
 * Click an issue → IssueDetail (separate page, deferred for follow-up PR).
 *
 * Browser-test pending.
 */

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase'
import IssueRow from '@/components/issues/IssueRow'
import { ArrowLeft, ListTodo } from 'lucide-react'

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

async function fetchIssues(slug: string): Promise<IssueRowData[]> {
  const db = createServerClient()
  if (!db) return []
  const res = await (db as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: { message: string } | null }>
        }
      }
    }
  }).from('issues')
    .select('id,business_slug,title,status,status_category,assignee_agent,assignee_user,goal_id,parent_id,created_at,updated_at')
    .eq('business_slug', slug)
    .order('updated_at', { ascending: false })

  return ((res.data ?? []) as IssueRowData[]) || []
}

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function CompanyIssuesPage({ params }: PageProps) {
  const { slug } = await params
  const issues = await fetchIssues(slug)

  const byCategory = new Map<string, IssueRowData[]>()
  for (const cat of CATEGORIES) byCategory.set(cat, [])
  for (const i of issues) {
    const cat = byCategory.get(i.status_category)
    if (cat) cat.push(i)
  }

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <Link href={`/businesses/${slug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> Company overview
      </Link>

      <header className="mb-6 flex items-center gap-3">
        <ListTodo className="h-6 w-6 text-zinc-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Issues — {slug}</h1>
          <p className="text-sm text-zinc-400">{issues.length} total. Grouped by status category.</p>
        </div>
      </header>

      {issues.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-zinc-400">No issues yet. Apply migrations 047/048 and seed via <code className="rounded bg-zinc-800/60 px-1 py-0.5 text-xs">lib/issues/insert.ts</code>.</p>
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
                  {list.map(i => <IssueRow key={i.id} issue={i} businessSlug={slug} />)}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

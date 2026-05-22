/**
 * /companies/[slug] — company overview (Paperclip absorption Task 3b).
 *
 * Server component. Renders mission + goals tree + agents list + budget
 * summary for one business. Mission lives on business_operators.mission
 * (migration 046); goals from goals table (migration 047). Both gracefully
 * empty pre-migration.
 *
 * Browser-test pending.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase'
import MissionPanel from '@/components/companies/MissionPanel'
import GoalsTreePanel from '@/components/companies/GoalsTreePanel'
import { ArrowLeft, Goal, ListTodo, ShieldCheck } from 'lucide-react'

interface BusinessRow {
  slug:          string
  name:          string
  niche:         string
  status:        string
  mission:       string | null
  brand_voice:   string | null
  parent_org_id: string | null
}

interface GoalRow {
  id:                string
  title:             string
  success_criteria:  string | null
  parent_goal_id:    string | null
  status:            string
}

async function fetchData(slug: string): Promise<{ business: BusinessRow | null; goals: GoalRow[]; issueCount: number; pendingApprovals: number }> {
  const db = createServerClient()
  if (!db) return { business: null, goals: [], issueCount: 0, pendingApprovals: 0 }

  const fromUntyped = (t: string) => (db as unknown as {
    from: (n: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => Promise<{ data: unknown; error: { message: string } | null }>
          order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: { message: string } | null }>
          maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>
        }
      }
    }
  }).from(t)

  const [bizRes, goalsRes, issueRes, approvalRes] = await Promise.all([
    fromUntyped('business_operators')
      .select('slug,name,niche,status,mission,brand_voice,parent_org_id')
      .eq('slug', slug)
      .maybeSingle(),
    fromUntyped('goals')
      .select('id,title,success_criteria,parent_goal_id,status')
      .eq('business_slug', slug)
      .order('created_at', { ascending: true }),
    fromUntyped('issues')
      .select('id')
      .eq('business_slug', slug)
      .eq('status_category', 'started'),
    fromUntyped('approvals')
      .select('id')
      .eq('business_slug', slug)
      .eq('status', 'pending'),
  ])

  return {
    business:        (bizRes.data ?? null) as BusinessRow | null,
    goals:           ((goalsRes.data ?? []) as GoalRow[]) || [],
    issueCount:      ((issueRes.data ?? []) as unknown[]).length,
    pendingApprovals:((approvalRes.data ?? []) as unknown[]).length,
  }
}

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function CompanyDetailPage({ params }: PageProps) {
  const { slug } = await params
  const { business, goals, issueCount, pendingApprovals } = await fetchData(slug)
  if (!business) notFound()

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <Link href="/companies" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> All companies
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{business.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">{business.niche} · {business.status}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <MissionPanel mission={business.mission} brandVoice={business.brand_voice} />
          <GoalsTreePanel goals={goals} />
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="mb-3 text-sm font-medium tracking-tight">Quick links</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href={`/companies/${slug}/issues`} className="flex items-center justify-between rounded-md px-2 py-1.5 text-zinc-300 hover:bg-zinc-800/60">
                  <span className="flex items-center gap-2"><ListTodo className="h-4 w-4 text-zinc-500" /> Issues (started)</span>
                  <span className="text-zinc-500">{issueCount}</span>
                </Link>
              </li>
              <li>
                <Link href="/approvals" className="flex items-center justify-between rounded-md px-2 py-1.5 text-zinc-300 hover:bg-zinc-800/60">
                  <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-zinc-500" /> Pending approvals</span>
                  <span className={pendingApprovals > 0 ? 'text-amber-400' : 'text-zinc-500'}>{pendingApprovals}</span>
                </Link>
              </li>
              <li>
                <Link href={`/dashboard/experiments/${slug}`} className="flex items-center justify-between rounded-md px-2 py-1.5 text-zinc-300 hover:bg-zinc-800/60">
                  <span className="flex items-center gap-2"><Goal className="h-4 w-4 text-zinc-500" /> Experiment dashboard</span>
                </Link>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}

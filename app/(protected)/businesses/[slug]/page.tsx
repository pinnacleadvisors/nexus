/**
 * /businesses/[slug] — business overview.
 *
 * 2026-05-22 merge: was a redirect to /businesses/[slug]/chat; now the rich
 * overview that absorbed /companies/[slug]/page.tsx. Mission + goals tree +
 * budget cards aside + quick links to chat / issues / org-chart.
 *
 * Chat remains 1 click away via the "Open chat" CTA in the header (and on
 * the tile). The chat-first day-to-day workflow is preserved; this page is
 * the surface for everything that isn't the chat itself.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase'
import MissionPanel from '@/components/businesses/MissionPanel'
import GoalsTreePanel from '@/components/businesses/GoalsTreePanel'
import BillerSpendCard, { type BillerSpendRow } from '@/components/businesses/BillerSpendCard'
import BudgetPolicyCard, { type BudgetPolicy } from '@/components/businesses/BudgetPolicyCard'
import BudgetIncidentCard, { type BudgetIncident } from '@/components/businesses/BudgetIncidentCard'
import RunNowButton from '@/components/businesses/RunNowButton'
import GraduateButton from '@/components/businesses/GraduateButton'
import { ArrowLeft, Goal, ListTodo, ShieldCheck, MessageSquare, Network, Zap } from 'lucide-react'

interface BusinessRow {
  slug:          string
  name:          string
  niche:         string
  status:        string
  mission:       string | null
  brand_voice:   string | null
  parent_org_id: string | null
  simulation:    boolean | null   // migration 070
}

interface GoalRow {
  id:                string
  title:             string
  success_criteria:  string | null
  parent_goal_id:    string | null
  status:            string
}

interface BudgetData {
  totalSpent24h: number
  agentSpend:    BillerSpendRow[]
  policies:      BudgetPolicy[]
  incidents:     BudgetIncident[]
}

function buildPolicies(): BudgetPolicy[] {
  const policies: BudgetPolicy[] = []
  const userCap = parseFloat(process.env.USER_DAILY_USD_LIMIT ?? '25') || 25
  const bizCap  = parseFloat(process.env.USER_BUSINESS_DAILY_USD_LIMIT ?? '10') || 10
  policies.push({ label: 'User daily cap',     cap_usd: userCap, scope: 'user-day' })
  policies.push({ label: 'Business daily cap', cap_usd: bizCap,  scope: 'business-day' })
  const agentDefault = process.env.AGENT_BUDGET_USD_DAY_DEFAULT
  if (agentDefault) {
    const n = parseFloat(agentDefault)
    if (Number.isFinite(n) && n > 0) {
      policies.push({ label: 'Agent default cap', cap_usd: n, scope: 'agent-day' })
    }
  }
  return policies
}

interface AnyChain extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  select: (cols: string) => AnyChain
  eq:     (col: string, val: string) => AnyChain
  gte:    (col: string, val: string) => AnyChain
  order:  (col: string, opts: { ascending: boolean }) => AnyChain
  limit:  (n: number) => AnyChain
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>
}

async function fetchBudget(db: { from: (t: string) => AnyChain }, slug: string): Promise<BudgetData> {
  const since24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [spendRes, killRes] = await Promise.all([
    db.from('experiment_metrics')
      .select('payload')
      .eq('business_slug', slug)
      .eq('kind', 'cash_spend')
      .gte('ts', since24hIso),
    db.from('experiment_metrics')
      .select('ts,payload')
      .eq('business_slug', slug)
      .eq('kind', 'kill_switch_check')
      .gte('ts', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('ts', { ascending: false })
      .limit(20),
  ])

  const spendRows = (spendRes.data ?? []) as Array<{ payload?: { usd?: number; agent_slug?: string } | null }>
  const perAgent = new Map<string, number>()
  let total = 0
  for (const r of spendRows) {
    const usd = r.payload?.usd ?? 0
    if (usd <= 0) continue
    total += usd
    const agent = r.payload?.agent_slug || '__unattributed'
    perAgent.set(agent, (perAgent.get(agent) ?? 0) + usd)
  }
  const agentSpend: BillerSpendRow[] = Array.from(perAgent.entries())
    .map(([agent_slug, spent_usd]) => ({ agent_slug, spent_usd, cap_usd: null }))
    .sort((a, b) => b.spent_usd - a.spent_usd)

  const killRows = (killRes.data ?? []) as Array<{
    ts: string
    payload?: { kill?: boolean; reason?: string; spentUsd?: number; capUsd?: number; scope?: string } | null
  }>
  const incidents: BudgetIncident[] = killRows
    .filter(r => r.payload?.kill === true)
    .map(r => ({
      ts:        r.ts,
      scope:     (r.payload?.scope as BudgetIncident['scope']) ?? 'business',
      spent_usd: r.payload?.spentUsd ?? 0,
      cap_usd:   r.payload?.capUsd   ?? 0,
      reason:    r.payload?.reason ?? 'kill_switch',
    }))

  return { totalSpent24h: total, agentSpend, policies: buildPolicies(), incidents }
}

async function fetchData(slug: string): Promise<{
  business:         BusinessRow | null
  goals:            GoalRow[]
  issueCount:       number
  pendingApprovals: number
  budget:           BudgetData
}> {
  const db = createServerClient()
  const emptyBudget: BudgetData = { totalSpent24h: 0, agentSpend: [], policies: buildPolicies(), incidents: [] }
  if (!db) return { business: null, goals: [], issueCount: 0, pendingApprovals: 0, budget: emptyBudget }

  const anyDb = db as unknown as { from: (t: string) => AnyChain }

  const [bizRes, goalsRes, issueRes, approvalRes, budget] = await Promise.all([
    anyDb.from('business_operators')
      .select('slug,name,niche,status,mission,brand_voice,parent_org_id,simulation')
      .eq('slug', slug)
      .maybeSingle(),
    anyDb.from('goals')
      .select('id,title,success_criteria,parent_goal_id,status')
      .eq('business_slug', slug)
      .order('created_at', { ascending: true }),
    anyDb.from('issues')
      .select('id')
      .eq('business_slug', slug)
      .eq('status_category', 'started'),
    anyDb.from('approvals')
      .select('id')
      .eq('business_slug', slug)
      .eq('status', 'pending'),
    fetchBudget(anyDb, slug),
  ])

  return {
    business:         (bizRes.data ?? null) as BusinessRow | null,
    goals:            ((goalsRes.data ?? []) as GoalRow[]) || [],
    issueCount:       ((issueRes.data ?? []) as unknown[]).length,
    pendingApprovals: ((approvalRes.data ?? []) as unknown[]).length,
    budget,
  }
}

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function BusinessDetailPage({ params }: PageProps) {
  const { slug } = await params
  const { business, goals, issueCount, pendingApprovals, budget } = await fetchData(slug)
  if (!business) notFound()

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <Link href="/businesses" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> All businesses
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {business.name}
            {business.simulation && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 font-mono uppercase tracking-wider text-[10px] text-violet-300"
                title="Simulation business — cost-guard short-circuits real spend, money-moving verbs are blocked"
              >
                🧪 sim
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">{business.niche} · {business.status}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RunNowButton slug={slug} simulation={Boolean(business.simulation)} />
          {business.simulation && (
            <>
              <Link
                href={`/businesses/${slug}/simulate`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-700/50 bg-violet-500/10 px-3 py-2 text-sm text-violet-200 transition hover:bg-violet-500/20"
                title="Hyperbolic chamber: compress 30 sim-days into ~1 hour. Manual or auto-pilot."
              >
                <Zap className="h-4 w-4" /> Hyperbolic chamber
              </Link>
              <GraduateButton slug={slug} />
            </>
          )}
          <Link
            href={`/businesses/${slug}/chat`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800/70"
          >
            <MessageSquare className="h-4 w-4" /> Open chat
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <MissionPanel slug={business.slug} mission={business.mission} brandVoice={business.brand_voice} />
          <GoalsTreePanel goals={goals} />
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="mb-3 text-sm font-medium tracking-tight">Quick links</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href={`/businesses/${slug}/issues`} className="flex items-center justify-between rounded-md px-2 py-1.5 text-zinc-300 hover:bg-zinc-800/60">
                  <span className="flex items-center gap-2"><ListTodo className="h-4 w-4 text-zinc-500" /> Issues (started)</span>
                  <span className="text-zinc-500">{issueCount}</span>
                </Link>
              </li>
              <li>
                <Link href={`/businesses/${slug}/org-chart`} className="flex items-center justify-between rounded-md px-2 py-1.5 text-zinc-300 hover:bg-zinc-800/60">
                  <span className="flex items-center gap-2"><Network className="h-4 w-4 text-zinc-500" /> Org chart</span>
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

          <BillerSpendCard rows={budget.agentSpend} totalSpent={budget.totalSpent24h} period="day" />
          <BudgetPolicyCard policies={budget.policies} />
          <BudgetIncidentCard incidents={budget.incidents} />
        </aside>
      </div>
    </div>
  )
}

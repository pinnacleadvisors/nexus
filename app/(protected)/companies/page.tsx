/**
 * /companies — multi-business dashboard (Paperclip absorption Task 3a).
 *
 * Server component. Fetches business_operators rows + the latest cash_spend
 * total per business from experiment_metrics. Renders one CompanyTile per
 * business in a responsive grid.
 *
 * Browser-test pending: this scaffold has not been verified in a running
 * dev session against real Supabase data — operator should validate at
 * 375px and desktop widths before merging Task 3a as complete.
 */

import { createServerClient } from '@/lib/supabase'
import CompanyTile from '@/components/companies/CompanyTile'

interface CompanyRow {
  slug:               string
  name:               string
  niche:              string
  status:             string
  mission:            string | null   // null when migration 046 not applied
  parent_org_id:      string | null
  current_run_id:     string | null
  last_operator_at:   string | null
  slack_channel:      string | null
}

interface SpendRow { business_slug: string; payload: { usd?: number } | null }

async function fetchData(): Promise<{ companies: CompanyRow[]; spend: Map<string, number>; pending: Map<string, number> }> {
  const db = createServerClient()
  if (!db) return { companies: [], spend: new Map(), pending: new Map() }

  const since30dIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Shared permissive shim — Supabase's typed client doesn't yet know about
  // post-migration columns, so every call into the new tables (and into
  // experiment_metrics with the chained operators) goes through this.
  interface AnyChain extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
    select: (cols: string) => AnyChain
    eq:     (col: string, val: string) => AnyChain
    gte:    (col: string, val: string) => AnyChain
    order:  (col: string, opts: { ascending: boolean }) => AnyChain
    maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>
  }
  const anyDb = db as unknown as { from: (table: string) => AnyChain }

  const [companiesRes, spendRes, pendingRes] = await Promise.all([
    anyDb.from('business_operators')
      .select('slug,name,niche,status,mission,parent_org_id,current_run_id,last_operator_at,slack_channel')
      .order('last_operator_at', { ascending: false }),
    anyDb.from('experiment_metrics')
      .select('business_slug,payload')
      .eq('kind', 'cash_spend')
      .gte('ts', since30dIso),
    anyDb.from('approvals')
      .select('business_slug')
      .eq('status', 'pending')
      .gte('created_at', new Date(0).toISOString()),
  ])

  const companies = ((companiesRes.data ?? []) as CompanyRow[]) || []
  const spend = new Map<string, number>()
  for (const r of (spendRes.data ?? []) as SpendRow[]) {
    const usd = r.payload?.usd ?? 0
    spend.set(r.business_slug, (spend.get(r.business_slug) ?? 0) + usd)
  }
  const pending = new Map<string, number>()
  // approvals may not exist — silently empty
  for (const r of (pendingRes.data ?? []) as Array<{ business_slug: string }>) {
    pending.set(r.business_slug, (pending.get(r.business_slug) ?? 0) + 1)
  }
  return { companies, spend, pending }
}

export default async function CompaniesPage() {
  const { companies, spend, pending } = await fetchData()

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
        <p className="mt-1 text-sm text-zinc-400">
          One tile per business. Spend totals are 30-day rolling from experiment_metrics. Pending approvals link to /approvals.
        </p>
      </header>

      {companies.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-zinc-400">No businesses yet. Configure one in <a className="underline" href="/settings">Settings</a>.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {companies.map(c => (
            <CompanyTile
              key={c.slug}
              slug={c.slug}
              name={c.name}
              niche={c.niche}
              status={c.status}
              mission={c.mission}
              spent30dUsd={spend.get(c.slug) ?? 0}
              pendingApprovals={pending.get(c.slug) ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}

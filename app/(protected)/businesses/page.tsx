/**
 * /businesses — tile grid of every business the operator owns.
 *
 * 2026-05-22 merge: was a chat-forward list (199-line client component); now
 * the unified board-level view that absorbed /companies/page.tsx — adds
 * mission preview, 30d spend, pending-approval count to each tile. Per-tile
 * "Open chat" CTA preserves the chat-first day-to-day workflow.
 *
 * Server component. Fail-soft on missing post-migration columns (mission)
 * and missing tables (approvals) — visiting the page pre-migration shows
 * tiles with $0 spend / 0 approvals rather than 500ing.
 */

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase'
import BusinessTile from '@/components/businesses/BusinessTile'
import FleetActionsBar from '@/components/businesses/FleetActionsBar'
import { Settings as SettingsIcon } from 'lucide-react'

interface BusinessLite {
  slug:                  string
  name:                  string
  niche:                 string
  status:                string
  mission:               string | null   // null when migration 046 not applied
  money_model:           { thesis?: string } | null
  last_operator_at:      string | null
  simulation:            boolean         // migration 070
}

interface SpendRow   { business_slug: string; payload: { usd?: number } | null }
interface PendingRow { business_slug: string }

async function fetchData(): Promise<{
  businesses: BusinessLite[]
  spend:      Map<string, number>
  pending:    Map<string, number>
}> {
  const db = createServerClient()
  if (!db) return { businesses: [], spend: new Map(), pending: new Map() }

  const since30dIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  interface AnyChain extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
    select: (cols: string) => AnyChain
    eq:     (col: string, val: string) => AnyChain
    gte:    (col: string, val: string) => AnyChain
    order:  (col: string, opts: { ascending: boolean }) => AnyChain
  }
  const anyDb = db as unknown as { from: (t: string) => AnyChain }

  const [bizRes, spendRes, pendingRes] = await Promise.all([
    anyDb.from('business_operators')
      .select('slug,name,niche,status,mission,money_model,last_operator_at,simulation')
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

  const businesses = ((bizRes.data ?? []) as BusinessLite[]) || []
  const spend = new Map<string, number>()
  for (const r of (spendRes.data ?? []) as SpendRow[]) {
    const usd = r.payload?.usd ?? 0
    spend.set(r.business_slug, (spend.get(r.business_slug) ?? 0) + usd)
  }
  const pending = new Map<string, number>()
  for (const r of (pendingRes.data ?? []) as PendingRow[]) {
    pending.set(r.business_slug, (pending.get(r.business_slug) ?? 0) + 1)
  }
  return { businesses, spend, pending }
}

export default async function BusinessesPage() {
  const { businesses, spend, pending } = await fetchData()

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Businesses</h1>
          <p className="mt-1 text-sm text-zinc-400">
            One tile per business. Spend is 30-day rolling from experiment_metrics. Pending counts link to /approvals.
            Click a tile for the overview, or use <b>Open chat</b> to jump straight to that business&apos;s copilot.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/businesses/new"
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-700/40 bg-violet-500/15 px-3 py-2 text-sm text-violet-200 transition hover:bg-violet-500/25"
          >
            + New business
          </Link>
          <Link
            href="/settings/businesses"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800/70"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            Manage
          </Link>
        </div>
      </header>

      {/* R7: Fleet actions bar — bulk Pause / Resume / Smoke / Refresh-KPIs.
          Hidden when there's <2 businesses (the component returns null). */}
      <FleetActionsBar availableSlugs={businesses.map(b => b.slug)} />

      {businesses.length === 0 ? (
        <div className="rounded-xl border border-violet-700/30 bg-violet-500/5 p-8 text-center">
          <h2 className="text-base font-semibold text-zinc-100">No businesses yet — start with a simulated one</h2>
          <p className="mt-2 text-sm text-zinc-400 max-w-xl mx-auto leading-relaxed">
            The wizard creates a <strong>simulation</strong> business — no real money, no real OAuth — so you can exercise the full chain (chat → board → smoke → graduate) before going live. Auto-enables the dev fixture harness so synthetic Stripe / Gmail / Slack / etc. connections appear immediately on /settings/accounts.
          </p>
          <Link
            href="/businesses/new"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-violet-700/50 bg-violet-500/20 px-4 py-2 text-sm text-violet-100 transition hover:bg-violet-500/30"
          >
            Create your first business →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {businesses.map(b => (
            <BusinessTile
              key={b.slug}
              slug={b.slug}
              name={b.name}
              niche={b.niche}
              status={b.status}
              // Fall back to money_model.thesis when the mission column is empty
              // (lets the merged page render meaningfully pre-migration-046).
              mission={b.mission ?? b.money_model?.thesis ?? null}
              spent30dUsd={spend.get(b.slug) ?? 0}
              pendingApprovals={pending.get(b.slug) ?? 0}
              simulation={Boolean(b.simulation)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

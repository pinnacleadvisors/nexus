/**
 * /dashboard/experiments — fleet index of every business as an experiment.
 *
 * Sibling to /dashboard/experiments/<slug> (D2 per-business dashboard).
 * Before this page existed, the Mission Control Spend tile linked here
 * and got a 404; PR #344 dropped the href until the index landed. This
 * file restores the destination.
 *
 * Server component. Reads in parallel:
 *   1. business_operators rows (every business the operator owns)
 *   2. experiment_metrics aggregated 30d — spend + revenue per slug
 *   3. Latest tick + kill_switch_check timestamps per slug
 *
 * No client interactivity — every row links to /dashboard/experiments/<slug>
 * for the detailed view. Empty state encourages creating the first business
 * (so the page is useful as the operator's day-1 landing too).
 */

import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase'
import { listBusinessesForUser } from '@/lib/business/db'
import { ArrowRight, CircleDollarSign, TrendingUp, Briefcase, AlertCircle, Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface MetricRow {
  business_slug: string | null
  kind:          string
  payload:       { usd?: number; live?: boolean } | null
  ts:            string
}

interface ExperimentSummary {
  slug:           string
  name:           string
  niche:          string
  status:         string
  spend30dUsd:    number
  revenue30dUsd:  number
  ratio:          number | null         // revenue / spend; null if spend === 0
  lastTickAt:     string | null
  lastKilledAt:   string | null
}

async function fetchSummaries(userId: string): Promise<ExperimentSummary[]> {
  const businesses = await listBusinessesForUser(userId)
  if (businesses.length === 0) return []

  const db = createServerClient()
  if (!db) {
    // Fail-soft: return businesses with zeroes if the metrics table is
    // unreachable; the operator still sees the list.
    return businesses.map(b => ({
      slug:           b.slug,
      name:           b.name,
      niche:          b.niche,
      status:         b.status,
      spend30dUsd:    0,
      revenue30dUsd:  0,
      ratio:          null,
      lastTickAt:     null,
      lastKilledAt:   null,
    }))
  }

  const since30dIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const slugs       = businesses.map(b => b.slug)

  // experiment_metrics isn't in the generated Database type — same untyped
  // shim pattern as lib/cost-guard.ts.
  type Query = {
    select: (cols: string) => Query
    in:     (c: string, vs: string[]) => Query
    gte:    (c: string, v: string) => Query
    eq:     (c: string, v: string) => Query
    then:   Promise<{ data: MetricRow[] | null; error: unknown }>['then']
  }
  const metricsQ = (db as unknown as { from: (t: string) => Query })
    .from('experiment_metrics')
    .select('business_slug, kind, payload, ts')
    .in('business_slug', slugs)
    .gte('ts', since30dIso)

  let rows: MetricRow[] = []
  try {
    const res = (await metricsQ) as { data: MetricRow[] | null; error: unknown }
    rows = res.data ?? []
  } catch {
    // Same fail-soft branch as the no-db case above.
  }

  // Aggregate per slug.
  const aggMap = new Map<string, {
    spend:        number
    revenue:      number
    lastTickAt:   string | null
    lastKilledAt: string | null
  }>()
  for (const r of rows) {
    if (!r.business_slug) continue
    const cur = aggMap.get(r.business_slug) ?? {
      spend: 0, revenue: 0, lastTickAt: null, lastKilledAt: null,
    }
    if (r.kind === 'cash_spend') cur.spend   += r.payload?.usd ?? 0
    if (r.kind === 'revenue')    cur.revenue += r.payload?.usd ?? 0
    if (r.kind === 'tick') {
      if (!cur.lastTickAt || r.ts > cur.lastTickAt) cur.lastTickAt = r.ts
    }
    if (r.kind === 'kill_switch_check') {
      if (!cur.lastKilledAt || r.ts > cur.lastKilledAt) cur.lastKilledAt = r.ts
    }
    aggMap.set(r.business_slug, cur)
  }

  return businesses.map(b => {
    const a = aggMap.get(b.slug) ?? { spend: 0, revenue: 0, lastTickAt: null, lastKilledAt: null }
    return {
      slug:           b.slug,
      name:           b.name,
      niche:          b.niche,
      status:         b.status,
      spend30dUsd:    a.spend,
      revenue30dUsd:  a.revenue,
      ratio:          a.spend > 0 ? a.revenue / a.spend : null,
      lastTickAt:     a.lastTickAt,
      lastKilledAt:   a.lastKilledAt,
    }
  }).sort((x, y) => y.spend30dUsd - x.spend30dUsd)
}

function ratioColor(ratio: number | null): string {
  if (ratio === null) return '#9090b0'   // zinc — no data
  if (ratio >= 1.5)   return '#4ade80'   // green — profitable
  if (ratio >= 1.0)   return '#fbbf24'   // yellow — break-even
  return '#f87171'                       // red — under water
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

function fmtRel(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000)            return 'just now'
  if (ms < 60 * 60_000)       return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 24 * 60 * 60_000)  return `${Math.floor(ms / (60 * 60_000))}h ago`
  return `${Math.floor(ms / (24 * 60 * 60_000))}d ago`
}

export default async function ExperimentsIndexPage() {
  const session = await auth()
  if (!session.userId) redirect('/sign-in')

  const summaries = await fetchSummaries(session.userId)

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Experiments</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Each business is an autonomous experiment. Spend / revenue is 30-day rolling from
            <code className="mx-1 rounded bg-zinc-800/60 px-1.5 py-0.5 text-xs">experiment_metrics</code>.
            Click a row for the full dashboard.
          </p>
        </div>
        <Link
          href="/businesses/new"
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-200 transition hover:bg-violet-500/20"
        >
          <Plus className="h-3.5 w-3.5" />
          New experiment
        </Link>
      </header>

      {summaries.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <Briefcase className="mx-auto h-6 w-6 text-zinc-500" />
          <p className="mt-3 text-sm text-zinc-300">No businesses yet.</p>
          <p className="mt-1 text-xs text-zinc-500">
            <Link href="/businesses/new" className="underline">Spin up the first one</Link>
            {' '}— a consultant agent walks you through 7 questions, then provisions one item at a time.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Business</th>
                <th className="px-3 py-2 text-right font-medium">30d spend</th>
                <th className="px-3 py-2 text-right font-medium">30d revenue</th>
                <th className="px-3 py-2 text-right font-medium" title="Revenue ÷ Spend over the last 30 days. Green ≥ 1.5x, yellow ≥ 1.0x, red below.">Ratio</th>
                <th className="px-3 py-2 text-right font-medium">Last tick</th>
                <th className="px-3 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {summaries.map(s => (
                <tr key={s.slug} className="hover:bg-zinc-900/40 transition-colors">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/dashboard/experiments/${encodeURIComponent(s.slug)}`}
                      className="flex flex-col gap-0.5"
                    >
                      <span className="flex items-center gap-2 font-medium text-zinc-100">
                        {s.name}
                        {s.lastKilledAt && (
                          <span title={`Last kill-check ${fmtRel(s.lastKilledAt)}`}>
                            <AlertCircle className="h-3 w-3 text-rose-400" />
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-zinc-500">{s.niche} · {s.status}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                    <span className="inline-flex items-center justify-end gap-1">
                      <CircleDollarSign className="h-3 w-3 text-zinc-500" />
                      {fmtUsd(s.spend30dUsd)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                    <span className="inline-flex items-center justify-end gap-1">
                      <TrendingUp className="h-3 w-3 text-zinc-500" />
                      {fmtUsd(s.revenue30dUsd)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono" style={{ color: ratioColor(s.ratio) }}>
                    {s.ratio === null ? '—' : `${s.ratio.toFixed(2)}x`}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-zinc-500">{fmtRel(s.lastTickAt)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Link
                      href={`/dashboard/experiments/${encodeURIComponent(s.slug)}`}
                      className="inline-flex items-center text-zinc-400 hover:text-zinc-200"
                      aria-label={`Open ${s.name} dashboard`}
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-zinc-500">
        Color legend: <span style={{ color: '#4ade80' }}>green</span> = profitable (revenue ≥ 1.5× spend),{' '}
        <span style={{ color: '#fbbf24' }}>yellow</span> = break-even (≥ 1.0×),{' '}
        <span style={{ color: '#f87171' }}>red</span> = under water,{' '}
        <span style={{ color: '#9090b0' }}>—</span> = no spend in window.
      </p>
    </div>
  )
}

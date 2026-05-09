/**
 * /dashboard/experiments/<slug> — D2 dashboard for an autonomous-business
 * experiment. Server component fetches the snapshot once on render; renders
 * the client child which handles only the [Stop experiment] interaction.
 *
 * Auth — handled upstream by the (protected) route group + proxy.ts middleware
 * which enforces `ALLOWED_USER_IDS`. We only need to make sure unknown slugs
 * yield a graceful "not found" rather than a 500.
 *
 * Data fetched (4 reads):
 *   1. business_operators row — name / niche / status / created_at
 *   2. experiment_metrics rows for the last 30d, all kinds
 *      (Client filters by kind: tick, gate_event, revenue, signup,
 *       content_published)
 *   3. checkKillSwitch(slug) — current automatic kill state + signal
 *   4. estimatePlanBillingUsage(slug) — claudeUsd / codexUsd / ratio
 *
 * The first content_published row with `payload.live === true` is also
 * extracted in the RSC so the kill-switch + KPI cards know when the
 * stagnation timer started.
 *
 * Manual-kill detection: a `kind=kill_switch_check` row whose payload has
 * `manual: true` means the operator hit [Stop experiment]. The Client
 * surfaces this as the "Killed (manual)" state — it overrides the
 * automatic killSwitch result.
 */

import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase'
import { checkKillSwitch } from '@/lib/cost-guard'
import { estimatePlanBillingUsage } from '@/lib/experiments/plan-billing-ledger'
import ExperimentDashboardClient, {
  type ExperimentDashboardData,
  type ExperimentMetricRow,
  type ExperimentBusinessSummary,
} from './ExperimentDashboardClient'

export const dynamic = 'force-dynamic'

// experiment_metrics + business_operators aren't yet in the generated
// Supabase types — same `as never` / `as unknown as` shim pattern that
// lib/cost-guard.ts and lib/experiments/plan-billing-ledger.ts use.
interface BusinessRow {
  slug:        string
  name:        string
  niche:       string
  status:      string
  created_at:  string
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

async function fetchBusiness(slug: string): Promise<BusinessRow | null> {
  const db = createServerClient()
  if (!db) return null
  try {
    const { data } = await (db as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{ data: BusinessRow | null; error: unknown }>
          }
        }
      }
    }).from('business_operators')
      .select('slug,name,niche,status,created_at')
      .eq('slug', slug)
      .maybeSingle()
    return data
  } catch {
    return null
  }
}

async function fetchMetrics(slug: string, sinceIso: string): Promise<ExperimentMetricRow[]> {
  const db = createServerClient()
  if (!db) return []
  try {
    type AnyQuery = {
      eq:    (c: string, v: string) => AnyQuery
      gte:   (c: string, v: string) => AnyQuery
      order: (c: string, opts: { ascending: boolean }) => AnyQuery
      then:  Promise<{ data: ExperimentMetricRow[] | null; error: unknown }>['then']
    }
    const q = (db as unknown as {
      from: (t: string) => { select: (c: string) => AnyQuery }
    }).from('experiment_metrics')
      .select('ts,kind,payload')
      .eq('business_slug', slug)
      .gte('ts', sinceIso)
      .order('ts', { ascending: true })
    const result = (await q) as { data: ExperimentMetricRow[] | null; error: unknown }
    return result.data ?? []
  } catch {
    return []
  }
}

/**
 * Did the operator hit [Stop experiment]? True when the most recent
 * kill_switch_check row has `payload.manual === true`. We look only at the
 * latest row so an operator can later "un-kill" by writing a clearing event
 * (out of scope for D2 — but the contract leaves room).
 */
function detectManualKill(metrics: ExperimentMetricRow[]): boolean {
  const checks = metrics.filter(m => m.kind === 'kill_switch_check')
  if (checks.length === 0) return false
  const latest = checks[checks.length - 1]
  return latest.payload?.manual === true
}

function detectFirstProductLiveAt(metrics: ExperimentMetricRow[]): string | null {
  const published = metrics.filter(m => m.kind === 'content_published')
  const live = published.find(r => r.payload?.live === true)
  return live ? live.ts : null
}

function toBusinessSummary(row: BusinessRow, firstProductLiveAt: string | null): ExperimentBusinessSummary {
  return {
    slug:               row.slug,
    name:               row.name,
    niche:              row.niche,
    status:             row.status,
    createdAt:          row.created_at,
    firstProductLiveAt,
  }
}

export default async function ExperimentDashboardPage(
  props: { params: Promise<{ slug: string }> },
) {
  const { slug } = await props.params

  const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString()
  const [business, metrics, killSwitch, ledger] = await Promise.all([
    fetchBusiness(slug),
    fetchMetrics(slug, since),
    checkKillSwitch(slug),
    estimatePlanBillingUsage(slug),
  ])

  if (!business) {
    notFound()
    // notFound() throws — unreachable, but the TS narrow check needs an explicit
    // return so the rest of the function knows `business` is non-null.
    return null
  }

  const firstProductLiveAt = detectFirstProductLiveAt(metrics)
  const manuallyKilled     = detectManualKill(metrics)

  const data: ExperimentDashboardData = {
    business:        toBusinessSummary(business, firstProductLiveAt),
    killSwitch,
    ledger,
    metrics,
    manuallyKilled,
    computedAt:      new Date().toISOString(),
  }

  return <ExperimentDashboardClient data={data} />
}

/**
 * lib/coaching/insights.ts — server-side coaching-insight generator.
 *
 * R5 of the UX consultation. The business-copilot reads platform state
 * (businesses, spend, smoke history, connected accounts, fixture-mode
 * age) and produces actionable suggestions the operator can resolve in
 * one click. Surfaces in the CoachingCard on /dashboard.
 *
 * Insight kinds (all defined here so the UI can icon/colour them):
 *   - missing-kpi-targets       — pivot decisions need these
 *   - no-completed-smoke        — graduate-preflight stays red
 *   - cost-without-revenue      — business burning cash with no signal
 *   - simulation-stale          — sim >7d old, probably ready to graduate
 *   - fixture-mode-old          — fixture mode on >30d, real OAuth never wired
 *   - no-connectors             — graduated biz with zero connected accounts
 *
 * Pure read — never mutates. Fail-soft: a query failure for one signal
 * just drops that insight, others still surface.
 */

import { createServerClient } from '@/lib/supabase'

export type InsightSeverity = 'info' | 'suggestion' | 'warning'

export interface CoachingInsight {
  id:           string   // stable per (kind, business_slug) for dedupe across requests
  kind:         'missing-kpi-targets' | 'no-completed-smoke' | 'cost-without-revenue' | 'simulation-stale' | 'fixture-mode-old' | 'no-connectors'
  severity:     InsightSeverity
  title:        string
  body:         string
  action_label: string
  action_href:  string
  business_slug: string | null   // null for platform-wide insights (e.g. fixture-mode-old)
}

interface BusinessRow {
  slug:              string
  name:              string
  niche:             string | null
  simulation:        boolean | null
  kpi_targets:       Record<string, unknown> | null
  created_at:        string
}

interface SimulationRunRow { business_slug: string; status: string }
interface ConnectedAccountRow { user_id: string; business_slug: string | null }
interface ExperimentMetricRow { business_slug: string; kind: string; payload: { usd?: number } | null }
interface FixtureModeRow { enabled: boolean; updated_at: string }

const WEEK_MS  = 7  * 24 * 60 * 60 * 1000
const MONTH_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Generate insights for an operator. Returns insights sorted by severity
 * (warning > suggestion > info) then by business name. Caller can dedupe
 * via `insight.id` if they're maintaining a "dismissed" set.
 */
export async function generateCoachingInsights(userId: string): Promise<CoachingInsight[]> {
  const db = createServerClient()
  if (!db) return []

  const insights: CoachingInsight[] = []

  // Load businesses (user-scoped). Fail-soft: empty array on error.
  let businesses: BusinessRow[] = []
  try {
    const r = await (db.from('business_operators' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => Promise<{ data: BusinessRow[] | null }> }
    }).select('slug,name,niche,simulation,kpi_targets,created_at').eq('user_id', userId)
    businesses = r.data ?? []
  } catch { /* swallow */ }

  if (businesses.length === 0) return insights

  // Per-business signals fetched in parallel.
  const slugs = businesses.map(b => b.slug)

  const [smokeRes, accountsRes, spendRes, revenueRes] = await Promise.allSettled([
    // Completed smoke runs per business
    (db.from('simulation_runs' as never) as unknown as {
      select: (c: string) => { in: (c: string, v: string[]) => { eq: (c: string, v: string) => Promise<{ data: SimulationRunRow[] | null }> } }
    }).select('business_slug, status').in('business_slug', slugs).eq('status', 'done'),
    // Connected accounts per business (including fixtures via the GET overlay would require user_id, here we just check real)
    (db.from('connected_accounts' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ data: ConnectedAccountRow[] | null }> } }
    }).select('user_id, business_slug').eq('user_id', userId).eq('status', 'active'),
    // 14-day spend per business
    (db.from('experiment_metrics' as never) as unknown as {
      select: (c: string) => { in: (c: string, v: string[]) => { eq: (c: string, v: string) => { gte: (c: string, v: string) => Promise<{ data: ExperimentMetricRow[] | null }> } } }
    }).select('business_slug, kind, payload').in('business_slug', slugs).eq('kind', 'cash_spend').gte('ts', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()),
    // 14-day revenue per business
    (db.from('experiment_metrics' as never) as unknown as {
      select: (c: string) => { in: (c: string, v: string[]) => { eq: (c: string, v: string) => { gte: (c: string, v: string) => Promise<{ data: ExperimentMetricRow[] | null }> } } }
    }).select('business_slug, kind, payload').in('business_slug', slugs).eq('kind', 'revenue').gte('ts', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()),
  ])

  const smokeByBiz = new Map<string, number>()
  if (smokeRes.status === 'fulfilled') {
    for (const r of smokeRes.value.data ?? []) {
      smokeByBiz.set(r.business_slug, (smokeByBiz.get(r.business_slug) ?? 0) + 1)
    }
  }

  const accountsByBiz = new Map<string, number>()
  if (accountsRes.status === 'fulfilled') {
    for (const r of accountsRes.value.data ?? []) {
      const slug = r.business_slug ?? '__default__'
      accountsByBiz.set(slug, (accountsByBiz.get(slug) ?? 0) + 1)
    }
  }

  const spendByBiz = new Map<string, number>()
  if (spendRes.status === 'fulfilled') {
    for (const r of spendRes.value.data ?? []) {
      const usd = r.payload?.usd ?? 0
      spendByBiz.set(r.business_slug, (spendByBiz.get(r.business_slug) ?? 0) + usd)
    }
  }

  const revenueByBiz = new Map<string, number>()
  if (revenueRes.status === 'fulfilled') {
    for (const r of revenueRes.value.data ?? []) {
      const usd = r.payload?.usd ?? 0
      revenueByBiz.set(r.business_slug, (revenueByBiz.get(r.business_slug) ?? 0) + usd)
    }
  }

  // Platform-wide signals (fixture mode age)
  let fixtureMode: FixtureModeRow | null = null
  try {
    const r = await (db.from('fixture_mode_active' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: FixtureModeRow | null }> } }
    }).select('enabled, updated_at').eq('user_id', userId).maybeSingle()
    fixtureMode = r.data ?? null
  } catch { /* swallow */ }

  // Per-business rules
  for (const biz of businesses) {
    const kpiKeys = biz.kpi_targets ? Object.keys(biz.kpi_targets) : []
    if (kpiKeys.length === 0) {
      insights.push({
        id:            `missing-kpi-targets:${biz.slug}`,
        kind:          'missing-kpi-targets',
        severity:      'suggestion',
        title:         `Set KPI targets for ${biz.name}`,
        body:          `No KPI targets configured. The cost-guard's stagnation pivot uses these to decide kill-switch + auto-pause. Set at least revenue_cents or signups before going further.`,
        action_label:  'Set targets',
        action_href:   `/businesses/${biz.slug}`,
        business_slug: biz.slug,
      })
    }

    if (biz.simulation === true) {
      const smokes = smokeByBiz.get(biz.slug) ?? 0
      if (smokes === 0) {
        insights.push({
          id:            `no-completed-smoke:${biz.slug}`,
          kind:          'no-completed-smoke',
          severity:      'suggestion',
          title:         `${biz.name} has no completed smoke run`,
          body:          `The graduate-to-production preflight requires at least one. Run a smoke (~10 min, no LLM spend with template voice) so you can graduate when ready.`,
          action_label:  'Run smoke',
          action_href:   `/businesses/${biz.slug}/simulate`,
          business_slug: biz.slug,
        })
      }

      // Simulation business >7d old without graduation — probably ready
      const ageMs = Date.now() - new Date(biz.created_at).getTime()
      if (ageMs > WEEK_MS && smokes > 0) {
        insights.push({
          id:            `simulation-stale:${biz.slug}`,
          kind:          'simulation-stale',
          severity:      'info',
          title:         `${biz.name} has been in simulation for ${Math.floor(ageMs / WEEK_MS)} week${Math.floor(ageMs / WEEK_MS) === 1 ? '' : 's'}`,
          body:          `Smoke has run; preflight may be green. Consider graduating to real-money mode when KPIs + connectors are in place.`,
          action_label:  'Open business',
          action_href:   `/businesses/${biz.slug}`,
          business_slug: biz.slug,
        })
      }
    } else {
      // Graduated business — different checks
      const accounts = (accountsByBiz.get(biz.slug) ?? 0) + (accountsByBiz.get('__default__') ?? 0)
      if (accounts === 0) {
        insights.push({
          id:            `no-connectors:${biz.slug}`,
          kind:          'no-connectors',
          severity:      'warning',
          title:         `${biz.name} is real-money but has zero connectors`,
          body:          `Money-moving verbs (Stripe, email, Slack) will fail without connected accounts. Connect platforms via /settings/accounts.`,
          action_label:  'Connect',
          action_href:   '/settings/accounts',
          business_slug: biz.slug,
        })
      }
    }

    // Cost-without-revenue rule
    const spend = spendByBiz.get(biz.slug) ?? 0
    const revenue = revenueByBiz.get(biz.slug) ?? 0
    if (spend > 5 && revenue === 0 && biz.simulation === false) {
      insights.push({
        id:            `cost-without-revenue:${biz.slug}`,
        kind:          'cost-without-revenue',
        severity:      'warning',
        title:         `${biz.name}: $${spend.toFixed(2)} burned, $0 revenue (14d)`,
        body:          `Spend without revenue is the auto-pivot signal. Review what the agents have shipped + decide whether to pivot the niche or pause spend.`,
        action_label:  'Inspect',
        action_href:   `/businesses/${biz.slug}`,
        business_slug: biz.slug,
      })
    }
  }

  // Platform-wide: fixture mode old
  if (fixtureMode?.enabled && fixtureMode.updated_at) {
    const ageMs = Date.now() - new Date(fixtureMode.updated_at).getTime()
    if (ageMs > MONTH_MS) {
      insights.push({
        id:            'fixture-mode-old:platform',
        kind:          'fixture-mode-old',
        severity:      'info',
        title:         `Fixture mode has been on for ${Math.floor(ageMs / MONTH_MS)} month${Math.floor(ageMs / MONTH_MS) === 1 ? '' : 's'}`,
        body:          `Synthetic connectors are still overlaying real ones. If you're past testing, turn it off so real OAuth flows fire.`,
        action_label:  'Open settings',
        action_href:   '/settings?tab=access',
        business_slug: null,
      })
    }
  }

  // Sort: warning > suggestion > info; then by business name
  const severityRank: Record<InsightSeverity, number> = { warning: 0, suggestion: 1, info: 2 }
  insights.sort((a, b) => {
    const sd = severityRank[a.severity] - severityRank[b.severity]
    if (sd !== 0) return sd
    return (a.business_slug ?? '').localeCompare(b.business_slug ?? '')
  })

  return insights
}

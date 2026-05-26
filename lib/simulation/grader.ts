/**
 * lib/simulation/grader.ts — aggregates a finished simulation run's events
 * into a graded report stored on `simulation_runs.result` (PR #364).
 *
 * What the operator sees at the end of a hyperbolic-chamber run:
 *   - KPI hit/miss vs business_operators.kpi_targets
 *   - Approval funnel (how many approved / rejected, by manual vs auto)
 *   - Synthetic revenue + spend totals
 *   - Failure count + critical-failure count
 *   - Suggested takeaways (a short paragraph based on the numbers)
 *
 * Pure read + write — no side effects beyond writing to the run row.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface GradedRunResult {
  events_processed:        number
  approvals: {
    approved:              number
    rejected:              number
    auto_approved:         number
    auto_rejected:         number
  }
  sim_revenue_cents:       number
  sim_spend_cents:         number
  sim_net_cents:           number
  signups_total:           number
  failures:                number
  critical_failures:       number
  churned_count:           number   // v3 — customers who walked away
  lost_ltv_cents:          number   // v3 — synthetic LTV lost to churn
  kpis_hit:                Record<string, boolean | null>
  takeaways:               string[]
}

interface SimulationEventRow {
  kind:           string
  payload:        Record<string, unknown>
  outcome:        Record<string, unknown> | null
  approval_state: string | null
}

interface BusinessTargets {
  kpi_targets?: Record<string, unknown> | null
}

export async function gradeRun(db: SupabaseClient, runId: string): Promise<GradedRunResult | null> {
  // Pull the run + its events in parallel
  const runRes = await (db.from('simulation_runs' as never) as unknown as {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        maybeSingle: () => Promise<{ data: { business_slug: string } | null; error: { message: string } | null }>
      }
    }
  }).select('business_slug').eq('id', runId).maybeSingle()
  if (runRes.error || !runRes.data) return null
  const businessSlug = runRes.data.business_slug

  const evRes = await (db.from('simulation_events' as never) as unknown as {
    select: (c: string) => {
      eq: (c: string, v: string) => Promise<{ data: SimulationEventRow[] | null; error: { message: string } | null }>
    }
  }).select('kind, payload, outcome, approval_state').eq('run_id', runId)
  const events = evRes.data ?? []

  const bizRes = await (db.from('business_operators' as never) as unknown as {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        maybeSingle: () => Promise<{ data: BusinessTargets | null; error: { message: string } | null }>
      }
    }
  }).select('kpi_targets').eq('slug', businessSlug).maybeSingle()
  const targets = (bizRes.data?.kpi_targets ?? {}) as Record<string, number | undefined>

  // ── Aggregations ───────────────────────────────────────────────────────────
  const approvals = {
    approved:       events.filter(e => e.approval_state === 'approved').length,
    rejected:       events.filter(e => e.approval_state === 'rejected').length,
    auto_approved:  events.filter(e => e.approval_state === 'auto_approved').length,
    auto_rejected:  events.filter(e => e.approval_state === 'auto_rejected').length,
  }

  let sim_revenue_cents = 0
  let sim_spend_cents   = 0
  let signups_total     = 0
  for (const e of events) {
    if (e.kind === 'kpi_snapshot') {
      const p = e.payload as { revenue_today_cents?: number; spend_today_cents?: number; signups_today?: number }
      sim_revenue_cents += Number(p.revenue_today_cents ?? 0)
      sim_spend_cents   += Number(p.spend_today_cents   ?? 0)
      signups_total     += Number(p.signups_today       ?? 0)
    }
  }

  const failures          = events.filter(e => e.kind === 'failure').length
  const critical_failures = events.filter(e => e.kind === 'failure' && (e.payload as { severity?: string }).severity === 'critical').length

  // v3: churn events represent customers who walked away. Sum their
  // simulated LTV (from outcome.lost_customer_ltv_cents in the engine)
  // and subtract from sim_net so the policy comparison reflects
  // long-term customer-loss cost, not just immediate revenue.
  const churn_events     = events.filter(e => e.kind === 'churn')
  const lost_ltv_cents   = churn_events.reduce((s, e) => {
    const o = (e as unknown as { outcome?: { lost_customer_ltv_cents?: number } }).outcome ?? null
    return s + Number(o?.lost_customer_ltv_cents ?? 0)
  }, 0)
  const churned_count    = churn_events.length

  // ── KPI grading vs targets (best-effort — unknown targets become null) ─────
  const kpis_hit: Record<string, boolean | null> = {}
  if (typeof targets.revenue_cents === 'number')
    kpis_hit.revenue       = sim_revenue_cents       >= targets.revenue_cents
  if (typeof targets.signups === 'number')
    kpis_hit.signups       = signups_total           >= targets.signups
  if (typeof targets.profit_cents === 'number')
    kpis_hit.profit        = (sim_revenue_cents - sim_spend_cents) >= targets.profit_cents

  // ── Takeaways — short, scannable sentences ─────────────────────────────────
  const takeaways: string[] = []
  const totalApprovals = approvals.approved + approvals.auto_approved
  const totalRejections = approvals.rejected + approvals.auto_rejected
  if (totalApprovals + totalRejections > 0) {
    const pctApproved = Math.round(100 * totalApprovals / (totalApprovals + totalRejections))
    takeaways.push(`${pctApproved}% of approval gates approved (${totalApprovals}/${totalApprovals + totalRejections}).`)
  }
  if (critical_failures > 0) {
    takeaways.push(`${critical_failures} critical failures during the run — check the failure event log for remediation patterns.`)
  } else if (failures > 0) {
    takeaways.push(`${failures} minor failures injected; all non-critical.`)
  }
  if (churned_count > 0) {
    takeaways.push(`${churned_count} customer${churned_count === 1 ? '' : 's'} churned (lost LTV $${(lost_ltv_cents / 100).toFixed(2)}).`)
  }
  if (sim_revenue_cents > 0) {
    const net = sim_revenue_cents - sim_spend_cents - lost_ltv_cents
    const sign = net >= 0 ? '+' : '−'
    takeaways.push(`Simulated net: ${sign}$${Math.abs(net / 100).toFixed(2)} across the run (including $${(lost_ltv_cents / 100).toFixed(2)} lost LTV from churn).`)
  }
  if (Object.keys(kpis_hit).length > 0) {
    const hitCount  = Object.values(kpis_hit).filter(v => v === true).length
    const totalKpis = Object.keys(kpis_hit).length
    takeaways.push(`KPIs hit: ${hitCount}/${totalKpis}.`)
  }
  if (takeaways.length === 0) {
    takeaways.push('Run processed without notable signal — consider running more sim-days or a different approver policy.')
  }

  const result: GradedRunResult = {
    events_processed:  events.length,
    approvals,
    sim_revenue_cents,
    sim_spend_cents,
    sim_net_cents:     sim_revenue_cents - sim_spend_cents - lost_ltv_cents,
    signups_total,
    failures,
    critical_failures,
    churned_count,
    lost_ltv_cents,
    kpis_hit,
    takeaways,
  }

  // Persist
  await (db.from('simulation_runs' as never) as unknown as {
    update: (r: unknown) => { eq: (c: string, v: string) => Promise<unknown> }
  }).update({
    result,
    status:    'done',
    ended_at:  new Date().toISOString(),
  }).eq('id', runId)

  return result
}

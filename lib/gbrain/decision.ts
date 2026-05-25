/**
 * lib/gbrain/decision.ts — pure decision logic for the GBrain bench.
 *
 * Extracted from app/api/cron/gbrain-bench/route.ts so the auto-ADR fill
 * is unit-testable. The route imports computeDecision() from here.
 *
 * Criteria from ADR 009 "GBrain evaluation": gbrain wins if citation
 * gain ≥ +25% over memory-hq AND p95 latency < 3000ms AND errors ≤ 2.
 * Below that, we differentiate "no signal" (reject) from "partial signal"
 * (defer) so the operator-readable PR title reflects the real outcome.
 */

export interface AdapterSummary {
  adapter:           string
  questions:         number
  avg_score:         number
  p50_latency_ms:    number
  p95_latency_ms:    number
  errors:            number
}

export interface BenchDecision {
  verdict:   'integrate' | 'defer' | 'reject'
  rationale: string
}

export function computeDecision(hq: AdapterSummary, gb: AdapterSummary): BenchDecision {
  const rawGainPct = hq.avg_score > 0 ? ((gb.avg_score - hq.avg_score) / hq.avg_score) * 100 : 0
  // Round to 1dp BEFORE the threshold comparison so the operator-facing
  // displayed value ("+25.0%") and the gate decision agree. Without this
  // floating-point quirks like 24.999999% would silently flip "integrate"
  // to "defer" at the exact boundary the ADR specifies.
  const citationGainPct = Math.round(rawGainPct * 10) / 10
  const p95Ok    = gb.p95_latency_ms < 3000
  const errorsOk = gb.errors <= 2
  const gainOk   = citationGainPct >= 25

  const fmtGain = `${citationGainPct >= 0 ? '+' : ''}${citationGainPct.toFixed(1)}%`
  if (gainOk && p95Ok && errorsOk) {
    return {
      verdict:   'integrate',
      rationale: `gbrain wins all ADR 009 criteria: citation gain ${fmtGain} (target ≥ +25%), p95 ${gb.p95_latency_ms}ms (target < 3000ms), ${gb.errors} errors (target ≤ 2). Promote gbrain to default memory adapter for hot reads.`,
    }
  }
  if (citationGainPct <= 0) {
    return {
      verdict:   'reject',
      rationale: `memory-hq matches or beats gbrain on citation (${fmtGain} gain). p95 ${gb.p95_latency_ms}ms, ${gb.errors} errors. No reason to integrate.`,
    }
  }
  // Improvement exists but at least one criterion failed — defer to next bench.
  const failed: string[] = []
  if (!gainOk)   failed.push(`citation gain ${fmtGain} below +25% target`)
  if (!p95Ok)    failed.push(`p95 ${gb.p95_latency_ms}ms above 3000ms target`)
  if (!errorsOk) failed.push(`${gb.errors} errors above ≤2 target`)
  return {
    verdict:   'defer',
    rationale: `gbrain shows improvement (${fmtGain} citation) but fails: ${failed.join('; ')}. Re-run after upstream tuning.`,
  }
}

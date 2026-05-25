/**
 * Unit test for lib/gbrain/decision.ts computeDecision.
 *
 * This logic runs unattended every week via /api/cron/gbrain-bench and
 * auto-opens an ADR PR with "Decision: integrate|defer|reject" pre-filled.
 * Silent regressions here would mislead the operator into shipping (or not
 * shipping) GBrain on bad numbers.
 *
 * Run with: `npx --yes tsx __tests__/gbrain-decision.test.ts`
 */
import { computeDecision, type AdapterSummary } from '../lib/gbrain/decision'

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const HQ: AdapterSummary = {
  adapter: 'memory-hq', questions: 50, avg_score: 0.40,
  p50_latency_ms: 200, p95_latency_ms: 500, errors: 0,
}

// 1. integrate — gbrain wins all three criteria
{
  const gb: AdapterSummary = {
    adapter: 'gbrain', questions: 50, avg_score: 0.55,  // +37.5% over 0.40
    p50_latency_ms: 800, p95_latency_ms: 2500, errors: 1,
  }
  const r = computeDecision(HQ, gb)
  assert(r.verdict === 'integrate', `all-wins should integrate, got ${r.verdict} (${r.rationale})`)
  assert(r.rationale.includes('+37.5%'), `rationale should cite gain pct, got: ${r.rationale}`)
}

// 2. reject — gbrain citation equal-or-worse than memory-hq
{
  const gb: AdapterSummary = {
    adapter: 'gbrain', questions: 50, avg_score: 0.30,  // -25% — worse
    p50_latency_ms: 100, p95_latency_ms: 400, errors: 0,
  }
  const r = computeDecision(HQ, gb)
  assert(r.verdict === 'reject', `worse-citation should reject, got ${r.verdict} (${r.rationale})`)
}

// 3. reject — exactly equal citation (gain = 0)
{
  const gb: AdapterSummary = {
    adapter: 'gbrain', questions: 50, avg_score: 0.40,  // 0% gain
    p50_latency_ms: 100, p95_latency_ms: 400, errors: 0,
  }
  const r = computeDecision(HQ, gb)
  assert(r.verdict === 'reject', `zero-gain should reject, got ${r.verdict} (${r.rationale})`)
}

// 4. defer — citation improved but below +25% threshold
{
  const gb: AdapterSummary = {
    adapter: 'gbrain', questions: 50, avg_score: 0.45,  // +12.5% — partial signal
    p50_latency_ms: 800, p95_latency_ms: 2500, errors: 1,
  }
  const r = computeDecision(HQ, gb)
  assert(r.verdict === 'defer', `partial-gain should defer, got ${r.verdict} (${r.rationale})`)
  assert(r.rationale.includes('below +25%'), `rationale should explain why deferred, got: ${r.rationale}`)
}

// 5. defer — citation passes but p95 latency too high
{
  const gb: AdapterSummary = {
    adapter: 'gbrain', questions: 50, avg_score: 0.55,  // +37.5%
    p50_latency_ms: 1500, p95_latency_ms: 4200, errors: 0,
  }
  const r = computeDecision(HQ, gb)
  assert(r.verdict === 'defer', `slow-p95 should defer, got ${r.verdict} (${r.rationale})`)
  assert(r.rationale.includes('4200ms'), `rationale should cite the actual p95, got: ${r.rationale}`)
}

// 6. defer — citation passes but too many errors
{
  const gb: AdapterSummary = {
    adapter: 'gbrain', questions: 50, avg_score: 0.55,
    p50_latency_ms: 800, p95_latency_ms: 2500, errors: 5,  // > 2 cap
  }
  const r = computeDecision(HQ, gb)
  assert(r.verdict === 'defer', `error-heavy should defer, got ${r.verdict} (${r.rationale})`)
  assert(r.rationale.includes('5 errors'), `rationale should cite error count, got: ${r.rationale}`)
}

// 7. integrate — boundary: exactly +25% gain, exactly 2 errors, p95 just under 3000ms
{
  const gb: AdapterSummary = {
    adapter: 'gbrain', questions: 50, avg_score: 0.50,  // +25.0% exact
    p50_latency_ms: 1000, p95_latency_ms: 2999, errors: 2,
  }
  const r = computeDecision(HQ, gb)
  assert(r.verdict === 'integrate', `boundary case should integrate (≥+25%, <3000ms, ≤2), got ${r.verdict}`)
}

// 8. defer — boundary: p95 exactly 3000ms should fail (< not ≤)
{
  const gb: AdapterSummary = {
    adapter: 'gbrain', questions: 50, avg_score: 0.55,
    p50_latency_ms: 1000, p95_latency_ms: 3000, errors: 0,
  }
  const r = computeDecision(HQ, gb)
  assert(r.verdict === 'defer', `p95=3000 should defer (criterion is <), got ${r.verdict}`)
}

// 9. reject — handle hq.avg_score=0 edge case (no baseline data; division-by-zero guard)
{
  const hqZero: AdapterSummary = { ...HQ, avg_score: 0 }
  const gb: AdapterSummary = {
    adapter: 'gbrain', questions: 50, avg_score: 0.55,
    p50_latency_ms: 1000, p95_latency_ms: 2500, errors: 0,
  }
  const r = computeDecision(hqZero, gb)
  // With baseline 0, citationGainPct=0 → reject (no improvement to measure).
  assert(r.verdict === 'reject', `zero-baseline should reject, got ${r.verdict} (${r.rationale})`)
}

console.log('PASS: gbrain-decision tests')

/**
 * Unit test for lib/experiments/plan-billing-ledger.ts aggregatePlanBilling.
 *
 * Pure aggregation logic — no DB. Covers the four shapes the dashboard
 * cares about: empty, claude-only, codex-only, mixed-with-unmatched.
 *
 * Run with: `npx --yes tsx __tests__/plan-billing-ledger.test.ts`
 */
import { aggregatePlanBilling, PRICING } from '../lib/experiments/plan-billing-ledger'

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const NOW = new Date('2026-06-01T00:00:00Z')

// 1. Empty rows + zero revenue → all zeros + ratio null
{
  const r = aggregatePlanBilling([], 0, NOW)
  assert(r.claudeUsd === 0,    'empty: claudeUsd should be 0')
  assert(r.codexUsd === 0,     'empty: codexUsd should be 0')
  assert(r.totalUsd === 0,     'empty: totalUsd should be 0')
  assert(r.revenueUsd === 0,   'empty: revenueUsd should be 0')
  assert(r.ratioVsRevenue === null, `empty: ratio should be null, got ${r.ratioVsRevenue}`)
  assert(r.rowsAnalyzed === 0, 'empty: rowsAnalyzed should be 0')
  assert(r.unmatchedModels.length === 0, 'empty: unmatched should be []')
}

// 2. Claude-only — Sonnet 1M input + 1M output → $3 + $15 = $18
{
  const r = aggregatePlanBilling([
    { model: 'claude-sonnet-4-6', input_tokens: 1_000_000, output_tokens: 1_000_000 },
  ], 36, NOW)
  assert(r.claudeUsd === 18,   `sonnet 1M+1M should be $18, got ${r.claudeUsd}`)
  assert(r.codexUsd === 0,     'codex should be 0')
  assert(r.totalUsd === 18,    `totalUsd should be $18, got ${r.totalUsd}`)
  assert(r.revenueUsd === 36,  `revenueUsd should be $36, got ${r.revenueUsd}`)
  assert(r.ratioVsRevenue === 2, `ratio should be 2.0, got ${r.ratioVsRevenue}`)
}

// 3. Codex-only — GPT-5.5 1M input + 1M output → $5 + $15 = $20
{
  const r = aggregatePlanBilling([
    { model: 'gpt-5.5-codex', input_tokens: 1_000_000, output_tokens: 1_000_000 },
  ], 0, NOW)
  assert(r.claudeUsd === 0,    'claude should be 0')
  assert(r.codexUsd === 20,    `gpt-5.5 1M+1M should be $20, got ${r.codexUsd}`)
  assert(r.totalUsd === 20,    `totalUsd should be $20, got ${r.totalUsd}`)
  assert(r.ratioVsRevenue === 0, `revenue=0 ratio should be 0, got ${r.ratioVsRevenue}`)
}

// 4. Mixed + unmatched model
{
  const r = aggregatePlanBilling([
    { model: 'claude-opus-4-7',   input_tokens: 100_000, output_tokens: 200_000 },  // $1.5 + $15 = $16.5
    { model: 'gpt-5.5-codex',     input_tokens: 500_000, output_tokens: 100_000 },  // $2.5 + $1.5 = $4
    { model: 'unknown-model-xyz', input_tokens: 999_999, output_tokens: 999_999 },  // unmatched
  ], 50, NOW)
  assert(r.claudeUsd === 16.5,  `opus mix should be $16.5, got ${r.claudeUsd}`)
  assert(r.codexUsd === 4,      `gpt-5.5 mix should be $4, got ${r.codexUsd}`)
  assert(r.totalUsd === 20.5,   `totalUsd should be $20.5, got ${r.totalUsd}`)
  assert(r.unmatchedModels.length === 1 && r.unmatchedModels[0] === 'unknown-model-xyz',
    `expected one unmatched model, got ${JSON.stringify(r.unmatchedModels)}`)
  assert(r.rowsAnalyzed === 3, `rowsAnalyzed should be 3, got ${r.rowsAnalyzed}`)
  // ratio = 50 / 20.5 ≈ 2.439024
  assert(Math.abs((r.ratioVsRevenue ?? 0) - (50 / 20.5)) < 1e-5,
    `ratio should be ~${50 / 20.5}, got ${r.ratioVsRevenue}`)
}

// 5. Pricing table sanity — every entry has positive rates
{
  for (const [model, p] of Object.entries(PRICING)) {
    assert(p.inputPerMillion > 0,  `${model} input rate must be > 0`)
    assert(p.outputPerMillion > 0, `${model} output rate must be > 0`)
    assert(p.category === 'claude' || p.category === 'codex',
      `${model} category must be claude or codex`)
  }
}

console.log('PASS: all 5 plan-billing-ledger cases')

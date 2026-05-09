/**
 * Unit test for lib/cost-guard.ts evaluateKillSwitch.
 *
 * The async checkKillSwitch shell is integration-tested in E3 (insert fake
 * cash_spend rows + invoke solopreneur-tick). Here we cover the pure decision
 * logic — three cases from the C1 spec plus the auto-pivot-eligible signal.
 *
 * Run with: `npx --yes tsx __tests__/cost-guard.test.ts`
 */
import { evaluateKillSwitch, type KillSwitchInputs } from '../lib/cost-guard'

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const NOW = new Date('2026-06-01T00:00:00Z')
const TEN_DAYS_AGO = new Date('2026-05-22T00:00:00Z')   // > 7 days
const TWO_DAYS_AGO = new Date('2026-05-30T00:00:00Z')   // < 7 days

const baseline: KillSwitchInputs = {
  budgetUsd:          100,
  totalSpentUsd:      0,
  last7dRevenueUsd:   0,
  last7dSignups:      0,
  pivotHistoryLength: 0,
  firstProductLiveAt: null,
  now:                NOW,
}

// 1. spent=99 → kill=false (under budget, no live product yet)
{
  const r = evaluateKillSwitch({ ...baseline, totalSpentUsd: 99 })
  assert(!r.kill, `spent=99 should not kill, got ${JSON.stringify(r)}`)
  assert(r.reason === undefined, `spent=99 should have no reason, got ${r.reason}`)
}

// 2. spent=100 → kill=true reason=budget_exhausted
{
  const r = evaluateKillSwitch({ ...baseline, totalSpentUsd: 100 })
  assert(r.kill, `spent=100 should kill, got ${JSON.stringify(r)}`)
  assert(r.reason === 'budget_exhausted', `expected budget_exhausted, got ${r.reason}`)
}

// 3. stagnation + no pivot remaining → kill=true reason=stagnation_pivot_exhausted
{
  const r = evaluateKillSwitch({
    ...baseline,
    last7dRevenueUsd:   2,
    last7dSignups:      10,
    pivotHistoryLength: 1,
    firstProductLiveAt: TEN_DAYS_AGO,
  })
  assert(r.kill, `stagnation+used-pivot should kill, got ${JSON.stringify(r)}`)
  assert(r.reason === 'stagnation_pivot_exhausted',
    `expected stagnation_pivot_exhausted, got ${r.reason}`)
}

// 4. stagnation + pivot still available → kill=false signal=auto_pivot_eligible
{
  const r = evaluateKillSwitch({
    ...baseline,
    last7dRevenueUsd:   2,
    last7dSignups:      10,
    pivotHistoryLength: 0,
    firstProductLiveAt: TEN_DAYS_AGO,
  })
  assert(!r.kill, `first stagnation should not kill, got ${JSON.stringify(r)}`)
  assert(r.signal === 'auto_pivot_eligible',
    `expected auto_pivot_eligible signal, got ${r.signal}`)
}

// 5. stagnation BUT first_product_live_at < 7 days → kill=false (timer not yet)
{
  const r = evaluateKillSwitch({
    ...baseline,
    last7dRevenueUsd:   2,
    last7dSignups:      10,
    pivotHistoryLength: 0,
    firstProductLiveAt: TWO_DAYS_AGO,
  })
  assert(!r.kill, `2-day-old product should not stagnation-kill, got ${JSON.stringify(r)}`)
  assert(r.signal === undefined, `expected no signal, got ${r.signal}`)
}

// 6. no firstProductLiveAt → kill=false even if revenue/signups are 0
{
  const r = evaluateKillSwitch({
    ...baseline,
    last7dRevenueUsd:   0,
    last7dSignups:      0,
    pivotHistoryLength: 0,
    firstProductLiveAt: null,
  })
  assert(!r.kill, `no first-live yet should never stagnation-kill`)
}

// 7. budget=null → no budget enforcement
{
  const r = evaluateKillSwitch({ ...baseline, budgetUsd: null, totalSpentUsd: 9999 })
  assert(!r.kill, `budget=null should not enforce, got ${JSON.stringify(r)}`)
}

// 8. healthy state (revenue + signups above floor, pivot fresh)
{
  const r = evaluateKillSwitch({
    ...baseline,
    last7dRevenueUsd:   200,
    last7dSignups:      300,
    firstProductLiveAt: TEN_DAYS_AGO,
  })
  assert(!r.kill, `healthy state should not kill`)
  assert(r.signal === undefined, `healthy state should have no signal`)
}

console.log('PASS: all 8 evaluateKillSwitch cases')

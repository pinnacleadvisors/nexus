/**
 * Unit test for lib/simulation/check.ts.
 *
 * Covers the pure pieces (isMoneyMovingVerb classifier + SimulationGuardError
 * shape). The async isSimulationBusiness() depends on Supabase + caching;
 * its integration is exercised by the cost-guard + executeBusinessAction
 * call sites at runtime.
 *
 * Run with: `npx --yes tsx __tests__/simulation-safety.test.ts`
 */

import { classifyMoneyMovingVerb, SimulationGuardError, clearSimulationCache } from '../lib/simulation/check'

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

// ── classifyMoneyMovingVerb — Stripe ─────────────────────────────────────────
assert(classifyMoneyMovingVerb('STRIPE_CREATE_CHARGE')      === 'stripe_money_move',  'stripe charge')
assert(classifyMoneyMovingVerb('STRIPE_PAYMENT_INTENT_CREATE') === 'stripe_money_move', 'stripe payment intent')
assert(classifyMoneyMovingVerb('stripe_payout_create')       === 'stripe_money_move',  'stripe payout (lower)')
assert(classifyMoneyMovingVerb('stripe_refund')              === 'stripe_money_move',  'stripe refund')
assert(classifyMoneyMovingVerb('STRIPE_LIST_PRODUCTS')        === null,                 'stripe list — safe')
assert(classifyMoneyMovingVerb('STRIPE_RETRIEVE_CUSTOMER')    === null,                 'stripe retrieve customer — safe')

// ── classifyMoneyMovingVerb — Email / SMS ────────────────────────────────────
assert(classifyMoneyMovingVerb('GMAIL_SEND_EMAIL')          === 'send_message_to_human', 'gmail send')
assert(classifyMoneyMovingVerb('CONVERTKIT_SEND_EMAIL')     === 'send_message_to_human', 'convertkit send')
assert(classifyMoneyMovingVerb('TWILIO_SEND_SMS')           === 'send_message_to_human', 'twilio sms')
assert(classifyMoneyMovingVerb('SMS_SEND')                  === 'send_message_to_human', 'generic sms')
assert(classifyMoneyMovingVerb('GMAIL_LIST_THREADS')        === null,                    'gmail read — safe')
assert(classifyMoneyMovingVerb('CONVERTKIT_LIST_SUBSCRIBERS') === null,                  'convertkit read — safe')

// ── classifyMoneyMovingVerb — transfers / withdrawals ────────────────────────
assert(classifyMoneyMovingVerb('COINBASE_TRANSFER_CREATE')  === 'platform_money_move',   'coinbase transfer')
assert(classifyMoneyMovingVerb('MERCURY_WITHDRAW')          === 'platform_money_move',   'mercury withdraw')
assert(classifyMoneyMovingVerb('LIST_TRANSFERS')            === null,                    'list transfers — safe')

// ── classifyMoneyMovingVerb — commerce ──────────────────────────────────────
assert(classifyMoneyMovingVerb('SHOPIFY_CREATE_ORDER')       === 'create_customer_facing_artefact', 'shopify create order')
assert(classifyMoneyMovingVerb('STRIPE_CREATE_INVOICE')      === 'create_customer_facing_artefact', 'stripe invoice — caught by commerce rule (not the charge/payout list)')
assert(classifyMoneyMovingVerb('SHOPIFY_LIST_ORDERS')        === null,                    'shopify list — safe')

// ── classifyMoneyMovingVerb — Slack ─────────────────────────────────────────
assert(classifyMoneyMovingVerb('SLACK_POST_MESSAGE')         === 'slack_outbound',        'slack post message')
assert(classifyMoneyMovingVerb('SLACK_LIST_CHANNELS')        === null,                    'slack list — safe')

// ── SimulationGuardError shape ──────────────────────────────────────────────
{
  const err = new SimulationGuardError('STRIPE_CHARGE', 'sim-saas-01', 'stripe_money_move')
  assert(err instanceof Error,                              'SimulationGuardError extends Error')
  assert(err.name === 'SimulationGuardError',               'name is set correctly')
  assert(err.message.includes('STRIPE_CHARGE'),             'message includes action')
  assert(err.message.includes('sim-saas-01'),               'message includes slug')
  assert(err.message.includes('stripe_money_move'),         'message includes category')
  assert(err.message.includes('Flip simulation=false'),     'message tells operator how to disable the guard')
}

// ── clearSimulationCache exists (idempotent) ────────────────────────────────
clearSimulationCache()
clearSimulationCache()

console.log('OK — lib/simulation/check.ts safety tests pass')

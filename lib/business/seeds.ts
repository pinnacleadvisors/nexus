/**
 * Phase A — seed templates for initial businesses.
 *
 * These are presets the Settings UI offers as one-click inserts. Keeping the
 * JSON shape in TS rather than embedding it in the migration means:
 *   - No user_id placeholder rotting in SQL
 *   - Iteration on the JSONs doesn't need a migration
 *   - Type-checked at build time
 *
 * Seed via:
 *   POST /api/businesses (with body matching the seed) — Settings UI does this
 */

import type { BusinessRow } from './types'

export type BusinessSeed = Omit<BusinessRow,
  'user_id' | 'current_run_id' | 'last_operator_at' | 'created_at' | 'updated_at'
>

/**
 * Ledger Lane — tax organizers for solo accountants / bookkeepers / EAs.
 * Seasonal: peak Jan-Apr (US tax season). Pinterest content needs ~50d lead
 * time, so seasonal pinning starts in early November for Q1 sell-through.
 */
export const LEDGER_LANE_SEED: BusinessSeed = {
  slug:   'ledger-lane',
  name:   'Ledger Lane',
  status: 'active',
  brand_voice:
    'Professional, no-fluff, time-saving focus. Speaks to busy specialists ' +
    '(accountants, bookkeepers, EAs) who buy time. Value-led pricing language ' +
    '("save 10 hours" not "$29"). Zero hype, zero emoji.',
  timezone:               'Asia/Bangkok',
  daily_cron_local_hour:  11,

  niche: 'Tax organizers for solo accountants / bookkeepers / EAs',

  money_model: {
    thesis: 'boring-niche arbitrage — 3-5x higher prices, 1/10th competition vs creative printables',
    type:   'hybrid_funnel',
    channels: {
      discovery:    ['etsy', 'pinterest'],
      high_intent:  ['instagram_dm_automation'],
      validation:   ['reddit'],
      owned:        ['payhip'],
      list:         'kit',
    },
    pricing_ladder: {
      lead_magnet: { type: 'free_checklist',  target_opt_in_pct: 55 },
      tripwire:    { usd_min: 7,   usd_max: 27,  target_conv_pct: 5 },
      core:        { usd_min: 47,  usd_max: 197, target_conv_pct: 2 },
      bundle:      { usd_min: 297, target_aov_lift_pct: 25 },
      order_bump:  { expected_take_rate_pct: 35 },
    },
    affiliate: { launch_at_mrr_usd: 1000, commission_pct: 35 },
    traffic: {
      pinterest: { pins_per_day: 10, seasonal_lead_days: 50 },
      instagram: { dm_automation_tool: 'manychat', monthly_usd: 25 },
      reddit:    { rule: '90/10', karma_warmup_weeks: 2 },
    },
    tool_stack_max_monthly_usd: 150,
    seasonality: {
      peak_months:        [1, 2, 3, 4],
      content_lead_days:  50,
      counter_season_focus: 'list-building + evergreen pins',
    },
  },

  kpi_targets: {
    day_30:  { live_listings: 1, email_subs: 50,   sales: 1 },
    day_60:  { live_listings: 2, email_subs: 200,  monthly_revenue_usd_min: 100 },
    day_90:  { live_listings: 3, email_subs: 600,  monthly_revenue_usd_min: 500 },
    day_180: { live_listings: 5, email_subs: 2000, monthly_revenue_usd_min: 2000, monthly_revenue_usd_max: 5000 },
    annual:  { revenue_usd_min: 24000, revenue_usd_max: 60000 },
    margin_pct_min: 70,
    weekly_maintenance_hours_max: 2.5,
  },

  approval_gates: [
    'spend.',
    'publish.paid.',
    'publish.brand.',
    'strategic.',
    'finance.refund_over_50',
  ],

  slack_channel:     '#nexus-ledger-lane',
  slack_webhook_url: null,
}

/**
 * Inkbound — freelancer contract bundles for designer / dev / copywriter.
 * Non-seasonal. Steady year-round demand. Target: solo freelancers who've
 * been burned by clients (scope creep, late payments, IP disputes).
 */
export const INKBOUND_SEED: BusinessSeed = {
  slug:   'inkbound',
  name:   'Inkbound',
  status: 'active',
  brand_voice:
    'Direct, plain-language legal. Targets solo freelancers (designer / dev / ' +
    'copywriter) who know they need protection but hate legalese. Speaks to ' +
    'pain ("you got burned by scope creep"), positions docs as armor not bureaucracy. ' +
    'Confident, slightly wry. No emoji.',
  timezone:               'Asia/Bangkok',
  daily_cron_local_hour:  11,

  niche: 'Freelancer contract bundles (designer, dev, copywriter)',

  money_model: {
    thesis: 'high-pain niche with clear emotional hook (got-burned freelancers); ' +
            'evergreen demand, no seasonality',
    type:   'hybrid_funnel',
    channels: {
      discovery:    ['etsy', 'pinterest'],
      high_intent:  ['instagram_dm_automation'],
      validation:   ['reddit'],
      owned:        ['payhip'],
      list:         'kit',
    },
    pricing_ladder: {
      lead_magnet: { type: 'free_checklist',  target_opt_in_pct: 60 },
      tripwire:    { usd_min: 7,   usd_max: 27,  target_conv_pct: 6 },
      core:        { usd_min: 47,  usd_max: 197, target_conv_pct: 2 },
      bundle:      { usd_min: 297, target_aov_lift_pct: 25 },
      order_bump:  { expected_take_rate_pct: 35 },
    },
    affiliate: { launch_at_mrr_usd: 1000, commission_pct: 35 },
    traffic: {
      pinterest: { pins_per_day: 8,  seasonal_lead_days: 0 },
      instagram: { dm_automation_tool: 'manychat', monthly_usd: 25 },
      reddit:    { rule: '90/10', karma_warmup_weeks: 2,
                   subs: ['/r/freelance', '/r/designjobs', '/r/forhire', '/r/copywriting'] },
    },
    tool_stack_max_monthly_usd: 150,
    sub_niche_priority_order: ['designer', 'dev', 'copywriter'],
  },

  kpi_targets: {
    day_30:  { live_listings: 1, email_subs: 50,   sales: 2 },
    day_60:  { live_listings: 2, email_subs: 250,  monthly_revenue_usd_min: 150 },
    day_90:  { live_listings: 3, email_subs: 800,  monthly_revenue_usd_min: 700 },
    day_180: { live_listings: 5, email_subs: 2500, monthly_revenue_usd_min: 2500, monthly_revenue_usd_max: 5000 },
    annual:  { revenue_usd_min: 30000, revenue_usd_max: 60000 },
    margin_pct_min: 70,
    weekly_maintenance_hours_max: 2.5,
  },

  approval_gates: [
    'spend.',
    'publish.paid.',
    'publish.brand.',
    'strategic.',
    'finance.refund_over_50',
  ],

  slack_channel:     '#nexus-inkbound',
  slack_webhook_url: null,
}

export const BUSINESS_SEEDS: BusinessSeed[] = [
  LEDGER_LANE_SEED,
  INKBOUND_SEED,
]

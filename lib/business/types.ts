/**
 * Phase A — typed shape of a `businesses` row.
 *
 * The DB columns are JSONB for `money_model`, `kpi_targets`, and
 * `approval_gates` so we can iterate on the schema without migrations.
 * These TS interfaces describe the agreed shape today; the operator agent
 * spec at .claude/agents/business-operator.md is the canonical contract.
 */

export type BusinessStatus = 'active' | 'paused' | 'archived'

export interface PricingTier {
  usd_min?:           number
  usd_max?:           number
  type?:              string
  target_opt_in_pct?: number
  target_conv_pct?:   number
  target_aov_lift_pct?: number
  expected_take_rate_pct?: number
}

export interface MoneyModel {
  thesis?:                       string
  type?:                         string
  channels?:                     Record<string, string | string[]>
  pricing_ladder?:               Record<string, PricingTier>
  affiliate?:                    { launch_at_mrr_usd?: number; commission_pct?: number }
  traffic?:                      Record<string, Record<string, unknown>>
  tool_stack_max_monthly_usd?:   number
  [extra: string]: unknown
}

export interface KpiSnapshot {
  live_listings?:           number
  email_subs?:              number
  sales?:                   number
  monthly_revenue_usd_min?: number
  monthly_revenue_usd_max?: number
  margin_pct_min?:          number
  margin_pct_max?:          number
  [extra: string]: unknown
}

export interface KpiTargets {
  day_30?:  KpiSnapshot
  day_60?:  KpiSnapshot
  day_90?:  KpiSnapshot
  day_180?: KpiSnapshot
  annual?:  Record<string, number | undefined>
  [extra: string]: unknown
}

/**
 * `approval_gates` is a list of action keys that require human approval.
 * The operator emits action items with a `kind` field; if `kind` matches
 * any prefix in this list, the digest renders an Approve/Reject button
 * pair instead of treating the action as auto-go.
 */
export type ApprovalGate =
  | 'spend.'         // any paid spend (ads, domain, Stripe, hiring, contractor)
  | 'publish.paid.'  // paid content amplification (boost posts, sponsored)
  | 'publish.brand.' // anything touching brand voice, story, founder copy
  | 'strategic.'     // pivots, new niche, new SKU class
  | 'finance.'       // refunds, chargebacks > threshold
  | string

export interface BusinessRow {
  slug:                     string
  name:                     string
  status:                   BusinessStatus
  user_id:                  string

  brand_voice:              string | null
  timezone:                 string
  daily_cron_local_hour:    number

  niche:                    string
  money_model:              MoneyModel
  kpi_targets:              KpiTargets
  approval_gates:           ApprovalGate[]

  slack_channel:            string | null
  /** Plaintext webhook URL (resolved from `slack_webhook_url_enc` when present, else legacy column). */
  slack_webhook_url:        string | null
  /** ISO timestamp of the most recent successful webhook verification. Null = never verified. */
  webhook_last_verified_at: string | null
  /** Error from the most recent failed verification. Cleared (NULL) on the next successful verify. */
  webhook_last_error:       string | null

  current_run_id:           string | null
  last_operator_at:         string | null

  created_at:               string
  updated_at:               string
}

/**
 * The shape the `business-operator` agent sees in `inputs.business`.
 * Same as BusinessRow minus secrets (slack webhook is server-only).
 */
export type BusinessContext = Omit<BusinessRow, 'slack_webhook_url' | 'user_id'>

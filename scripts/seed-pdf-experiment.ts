/**
 * scripts/seed-pdf-experiment.ts
 *
 * Idempotent seed for the autonomous solopreneur experiment business row
 * (`business_operators.slug = 'pdf-experiment-01'`). Mirrors the shape of
 * `lib/business/seeds.ts` so the row is compatible with the rest of the
 * provisioning chain (`scripts/migrate-business.ts --auto`).
 *
 * Usage:
 *   doppler run -- npx --yes tsx scripts/seed-pdf-experiment.ts
 *
 * Idempotency:
 *   1. Connects with the service-role Supabase client (bypasses RLS — the row
 *      is owner-scoped via `user_id`, sourced from `ALLOWED_USER_IDS[0]`).
 *   2. Selects on slug='pdf-experiment-01'. If a row exists, log
 *      "already seeded" and exit 0. Otherwise insert and exit 0.
 *
 * Schema notes:
 *   `business_operators` (migration 024) has no `metadata` / `budget_usd` /
 *   `experiment_flag` columns. Per task A4 spec ("do not invent new columns —
 *   work within whatever BusinessRow already supports"), the experiment-
 *   specific knobs ride along inside the existing JSONB columns:
 *     - `money_model.budget_usd`, `money_model.experiment_flag`            (free-form per BusinessSeed.money_model `[extra: string]: unknown`)
 *     - `kpi_targets.revenue_usd_30d`, `kpi_targets.list_size_30d`         (free-form per KpiTargets `[extra: string]: unknown`)
 *     - `approval_gates`                                                   (direct column — already string[])
 *
 * The mcp-manifest resolver matches the `niche` substring `pdf` / `info-product`
 * → `digital-products` profile, so no extension to that file is needed for the
 * seed itself.
 */

import { createClient } from '@supabase/supabase-js'
import type { BusinessSeed } from '../lib/business/seeds'

const SLUG = 'pdf-experiment-01'

/**
 * Seed body — a `BusinessSeed` (omits user_id / created_at etc. so it stays a
 * pure config-by-value, the way the existing seeds in lib/business/seeds.ts
 * are shaped). user_id is stamped on at insert time from ALLOWED_USER_IDS[0].
 */
const PDF_EXPERIMENT_SEED: BusinessSeed = {
  slug:   SLUG,
  name:   'PDF Experiment 01',
  status: 'active',

  // brand_voice is intentionally blank — the solopreneur-loop agent picks
  // brand voice AFTER the niche-pick approval gate, then writes it back via
  // the same upsert path.
  brand_voice: null,

  timezone:               'Asia/Bangkok',
  daily_cron_local_hour:  9,

  niche: 'pdf-info-products',

  money_model: {
    type: 'hybrid_funnel',
    thesis:
      'Autonomous solopreneur experiment — single PDF info-product business ' +
      'inside its own per-business Coolify container. Strategic gates on ' +
      'irreversibles only. Amortizes Claude 20x Max + Codex Pro plans by ' +
      'producing real outputs continuously.',

    // Existing seeds use {discovery, high_intent, validation, owned, list}
    // here. The agent will tune these post niche-pick; sane defaults seed it.
    channels: {
      discovery:    ['pinterest', 'reddit'],
      high_intent:  ['twitter', 'linkedin'],
      validation:   ['reddit'],
      owned:        ['gumroad'],
      list:         'convertkit',
    },

    pricing_ladder: {
      lead_magnet: { type: 'free_pdf',    target_opt_in_pct: 50 },
      tripwire:    { usd_min: 7,   usd_max: 27,  target_conv_pct: 5 },
      core:        { usd_min: 27,  usd_max: 97,  target_conv_pct: 2 },
      bundle:      { usd_min: 197, target_aov_lift_pct: 25 },
      order_bump:  { expected_take_rate_pct: 30 },
    },

    tool_stack_max_monthly_usd: 100,

    // ── Experiment-specific knobs (free-form; see header) ────────────────
    /** Hard cumulative cash-spend kill-switch ($). */
    budget_usd: 100,
    /** Cron iteration filter — solopreneur-tick selects WHERE this is true. */
    experiment_flag: true,
  },

  kpi_targets: {
    // ── Experiment-specific knobs (free-form; see header) ────────────────
    /** Day-30 success criteria from task_plan-solopreneur-experiment.md */
    revenue_usd_30d: 50,
    list_size_30d:   100,
  },

  // The 5 strategic gates — irreversibles + cash spends. Differs from the
  // ledger-lane / inkbound action-prefix patterns ("spend.", "publish.brand.")
  // because the experiment is gated by named milestones, not action verbs.
  approval_gates: [
    'niche_pick',
    'domain_purchase',
    'first_n_posts',
    'paid_saas_signup',
    'pricing_change',
  ],

  slack_channel:     '#nexus-pdf-experiment-01',
  slack_webhook_url: null,
}

interface ExistingRow {
  slug: string
}

function getOwnerUserId(): string {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw || !raw.trim()) {
    throw new Error(
      'ALLOWED_USER_IDS env var is required (the script stamps the first id ' +
      'as the row owner). Run via `doppler run --` so secrets are loaded.',
    )
  }
  const first = raw.split(',').map(s => s.trim()).filter(Boolean)[0]
  if (!first) {
    throw new Error('ALLOWED_USER_IDS is set but empty after parsing.')
  }
  return first
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) {
    console.error('NEXT_PUBLIC_SUPABASE_URL missing — run via `doppler run --`.')
    process.exit(1)
  }
  if (!key) {
    console.error('SUPABASE_SERVICE_ROLE_KEY missing — run via `doppler run --`.')
    process.exit(1)
  }

  const userId = getOwnerUserId()
  // Service-role client (bypasses RLS so the script can insert the row even
  // though there is no Clerk session — same pattern as createServerClient()
  // in lib/supabase.ts when SUPABASE_SERVICE_ROLE_KEY is present).
  const db = createClient(url, key)

  // ── Idempotency check ─────────────────────────────────────────────────
  const existing = await db
    .from('business_operators')
    .select('slug')
    .eq('slug', SLUG)
    .maybeSingle<ExistingRow>()

  if (existing.error) {
    console.error(`select failed: ${existing.error.message}`)
    process.exit(1)
  }

  if (existing.data) {
    console.log(`✓ ${SLUG} already seeded (slug exists in business_operators). No-op.`)
    process.exit(0)
  }

  // ── Insert ────────────────────────────────────────────────────────────
  console.log(`▶ Inserting business_operators row: ${SLUG} …`)
  const insertRow = {
    slug:                  PDF_EXPERIMENT_SEED.slug,
    name:                  PDF_EXPERIMENT_SEED.name,
    status:                PDF_EXPERIMENT_SEED.status,
    user_id:               userId,
    brand_voice:           PDF_EXPERIMENT_SEED.brand_voice,
    timezone:              PDF_EXPERIMENT_SEED.timezone,
    daily_cron_local_hour: PDF_EXPERIMENT_SEED.daily_cron_local_hour,
    niche:                 PDF_EXPERIMENT_SEED.niche,
    money_model:           PDF_EXPERIMENT_SEED.money_model,
    kpi_targets:           PDF_EXPERIMENT_SEED.kpi_targets,
    approval_gates:        PDF_EXPERIMENT_SEED.approval_gates,
    slack_channel:         PDF_EXPERIMENT_SEED.slack_channel,
    slack_webhook_url:     PDF_EXPERIMENT_SEED.slack_webhook_url,
  }

  const inserted = await db
    .from('business_operators')
    .insert(insertRow)
    .select('slug')
    .single<ExistingRow>()

  if (inserted.error) {
    // Race-condition graceful path: a parallel run may have inserted between
    // our select and insert. unique_violation is 23505 in Postgres.
    if (inserted.error.code === '23505') {
      console.log(`✓ ${SLUG} already seeded (raced; unique-constraint hit). No-op.`)
      process.exit(0)
    }
    console.error(`insert failed: ${inserted.error.message}`)
    process.exit(1)
  }

  console.log(`✓ Seeded business_operators row: ${inserted.data?.slug ?? SLUG}`)
  console.log(`  user_id:        ${userId}`)
  console.log(`  niche:          ${PDF_EXPERIMENT_SEED.niche} (resolves to digital-products profile)`)
  console.log(`  money_model:    type=${PDF_EXPERIMENT_SEED.money_model.type}, budget_usd=${PDF_EXPERIMENT_SEED.money_model.budget_usd}, experiment_flag=${PDF_EXPERIMENT_SEED.money_model.experiment_flag}`)
  console.log(`  kpi_targets:    revenue_usd_30d=${(PDF_EXPERIMENT_SEED.kpi_targets as Record<string, unknown>).revenue_usd_30d}, list_size_30d=${(PDF_EXPERIMENT_SEED.kpi_targets as Record<string, unknown>).list_size_30d}`)
  console.log(`  approval_gates: ${PDF_EXPERIMENT_SEED.approval_gates.join(', ')}`)
  console.log('')
  console.log('Next: doppler run -- npx --yes tsx scripts/migrate-business.ts pdf-experiment-01 --auto')
  process.exit(0)
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

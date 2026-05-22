/**
 * upsertBusinessOperator — fail-soft upsert that gracefully handles the case
 * where migration 046_companies_promotion.sql has not yet been applied.
 *
 * The migration adds three columns: `mission`, `board_members`, `parent_org_id`.
 * When app code lands ahead of the migration in production, every upsert
 * touching those columns fails with "column \"X\" does not exist". Cron
 * services that auto-retry (Inngest, the seed flow, etc.) then storm.
 *
 * Pattern mirrors lib/board/insert-task.ts — detect once, cache per-process,
 * fall back to a column-stripped upsert. Cache resets on cold start so the
 * "operator forgot the migration" state self-heals after the migration is
 * applied + next deploy.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

export interface BusinessOperatorUpsert {
  slug:                  string
  name:                  string
  user_id:               string
  niche:                 string
  status?:               'active' | 'paused' | 'archived'
  brand_voice?:          string | null
  timezone?:             string
  daily_cron_local_hour?: number
  money_model?:          Record<string, unknown>
  kpi_targets?:          Record<string, unknown>
  approval_gates?:       unknown[]
  slack_channel?:        string | null
  slack_webhook_url?:    string | null

  // Promotion columns (migration 046) — stripped on fallback.
  mission?:              string | null
  board_members?:        Array<{ user_id: string; role: string }>
  parent_org_id?:        string | null
}

interface UpsertResult {
  error: { message: string } | null
}

let promotionColumnsAvailable: boolean | null = null

const PROMOTION_KEYS = ['mission', 'board_members', 'parent_org_id'] as const

function stripPromotion(row: BusinessOperatorUpsert): BusinessOperatorUpsert {
  const out = { ...row } as Record<string, unknown>
  for (const k of PROMOTION_KEYS) delete out[k]
  return out as unknown as BusinessOperatorUpsert
}

function isMissingPromotionColumn(message: string): boolean {
  if (!message) return false
  return /column .*(mission|board_members|parent_org_id).* does not exist/i.test(message)
}

export async function upsertBusinessOperator(
  db: SupabaseClient<Database>,
  row: BusinessOperatorUpsert,
): Promise<UpsertResult> {
  // Bypass Supabase's generated types — migration 046 columns aren't in the
  // shipped database.types.ts until the operator regenerates them.
  const from = (db as unknown as {
    from: (t: string) => {
      upsert: (r: BusinessOperatorUpsert, opts?: { onConflict: string }) => Promise<UpsertResult>
    }
  }).from('business_operators')

  if (promotionColumnsAvailable === false) {
    return await from.upsert(stripPromotion(row), { onConflict: 'slug' })
  }

  const first = await from.upsert(row, { onConflict: 'slug' })
  if (first.error && isMissingPromotionColumn(first.error.message)) {
    if (promotionColumnsAvailable === null) {
      console.warn(
        '[upsertBusinessOperator] business_operators.{mission,board_members,parent_org_id} missing — apply migration 046_companies_promotion. Falling back to stripped upserts for this process.',
      )
    }
    promotionColumnsAvailable = false
    return await from.upsert(stripPromotion(row), { onConflict: 'slug' })
  }

  if (!first.error && promotionColumnsAvailable === null) promotionColumnsAvailable = true
  return first
}

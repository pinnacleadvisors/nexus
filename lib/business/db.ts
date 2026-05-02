/**
 * Phase A — read/write helpers for the `business_operators` table.
 *
 * Note: the table is `business_operators` (not `businesses`) because migration
 * 003_businesses_milestones.sql already created a `businesses` table for the
 * legacy workspace concept used by lib/graph/builder.ts. This file owns the
 * orchestrator-config table — same per-business semantics, distinct schema.
 *
 * All writes use the service-role Supabase client (bypasses RLS) because
 * cron + dispatch routes need to operate without a Clerk session. Read paths
 * called from user routes should pass `userId` and filter explicitly.
 */

import { createServerClient } from '@/lib/supabase'
import { encryptIfConfigured, decryptIfNeeded } from '@/lib/crypto'
import type { BusinessRow, BusinessStatus } from './types'

interface DbRow {
  slug:                   string
  name:                   string
  status:                 BusinessStatus
  user_id:                string
  brand_voice:            string | null
  timezone:               string
  daily_cron_local_hour:  number
  niche:                  string
  money_model:            unknown
  kpi_targets:            unknown
  approval_gates:         unknown
  slack_channel:          string | null
  slack_webhook_url:      string | null
  slack_webhook_url_enc:  string | null
  current_run_id:         string | null
  last_operator_at:       string | null
  created_at:             string
  updated_at:             string
}

/** Resolve the readable webhook URL — prefer the encrypted column, fall back
 *  to plaintext for rows written before migration 026. */
function resolveWebhookUrl(row: DbRow): string | null {
  if (row.slack_webhook_url_enc) {
    const plain = decryptIfNeeded(row.slack_webhook_url_enc)
    return plain || null
  }
  return row.slack_webhook_url
}

function rowFromDb(row: DbRow): BusinessRow {
  return {
    slug:                   row.slug,
    name:                   row.name,
    status:                 row.status,
    user_id:                row.user_id,
    brand_voice:            row.brand_voice,
    timezone:               row.timezone,
    daily_cron_local_hour:  row.daily_cron_local_hour,
    niche:                  row.niche,
    money_model:            (row.money_model as BusinessRow['money_model']) ?? {},
    kpi_targets:            (row.kpi_targets as BusinessRow['kpi_targets']) ?? {},
    approval_gates:         (row.approval_gates as BusinessRow['approval_gates']) ?? [],
    slack_channel:          row.slack_channel,
    slack_webhook_url:      resolveWebhookUrl(row),
    current_run_id:         row.current_run_id,
    last_operator_at:       row.last_operator_at,
    created_at:             row.created_at,
    updated_at:             row.updated_at,
  }
}

export async function listActiveBusinesses(): Promise<BusinessRow[]> {
  const db = createServerClient()
  if (!db) return []
  const { data } = await (db.from('business_operators' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, opts: { ascending: boolean }) => Promise<{ data: DbRow[] | null }>
      }
    }
  })
    .select('*')
    .eq('status', 'active')
    .order('slug', { ascending: true })
  return (data ?? []).map(rowFromDb)
}

export async function getBusinessBySlug(slug: string): Promise<BusinessRow | null> {
  const db = createServerClient()
  if (!db) return null
  const { data } = await (db.from('business_operators' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        maybeSingle: () => Promise<{ data: DbRow | null }>
      }
    }
  })
    .select('*')
    .eq('slug', slug)
    .maybeSingle()
  return data ? rowFromDb(data) : null
}

export async function listBusinessesForUser(userId: string): Promise<BusinessRow[]> {
  const db = createServerClient()
  if (!db) return []
  const { data } = await (db.from('business_operators' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, opts: { ascending: boolean }) => Promise<{ data: DbRow[] | null }>
      }
    }
  })
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  return (data ?? []).map(rowFromDb)
}

export type BusinessUpsert = Omit<BusinessRow,
  'created_at' | 'updated_at' | 'current_run_id' | 'last_operator_at'
>

export async function upsertBusiness(row: BusinessUpsert): Promise<BusinessRow | null> {
  const db = createServerClient()
  if (!db) return null

  // Encrypt the Slack webhook URL at write time. After migration 026 every
  // new write lands in `slack_webhook_url_enc`; the plaintext column is
  // explicitly NULLed so legacy rows migrate forward on the first save.
  const writeRow: Record<string, unknown> = { ...row }
  const slackPlain = (row.slack_webhook_url ?? '').trim()
  if (slackPlain) {
    writeRow.slack_webhook_url_enc = encryptIfConfigured(slackPlain)
    writeRow.slack_webhook_url     = null
  } else {
    writeRow.slack_webhook_url_enc = null
    writeRow.slack_webhook_url     = null
  }

  const { data } = await (db.from('business_operators' as never) as unknown as {
    upsert: (rec: unknown, opts: { onConflict: string }) => {
      select: () => { single: () => Promise<{ data: DbRow | null }> }
    }
  })
    .upsert(writeRow as unknown, { onConflict: 'slug' })
    .select()
    .single()
  return data ? rowFromDb(data) : null
}

export async function setBusinessRun(slug: string, runId: string | null): Promise<void> {
  const db = createServerClient()
  if (!db) return
  await (db.from('business_operators' as never) as unknown as {
    update: (patch: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> }
  })
    .update({ current_run_id: runId, last_operator_at: new Date().toISOString() })
    .eq('slug', slug)
}

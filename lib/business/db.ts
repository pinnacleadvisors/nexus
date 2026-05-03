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
import { decryptIfNeeded, encryptIfConfigured, isEncrypted } from '@/lib/crypto'
import type { BusinessRow, BusinessStatus } from './types'

interface DbRow {
  slug:                       string
  name:                       string
  status:                     BusinessStatus
  user_id:                    string
  brand_voice:                string | null
  timezone:                   string
  daily_cron_local_hour:      number
  niche:                      string
  money_model:                unknown
  kpi_targets:                unknown
  approval_gates:             unknown
  slack_channel:              string | null
  slack_webhook_url:          string | null   // legacy plaintext (mig 026 keeps this for one release)
  slack_webhook_url_enc?:     string | null   // ciphertext (mig 026 — new write target)
  webhook_last_verified_at?:  string | null   // mig 026
  webhook_last_error?:        string | null   // mig 026
  current_run_id:             string | null
  last_operator_at:           string | null
  created_at:                 string
  updated_at:                 string
}

/**
 * Resolve the slack webhook URL for a business — prefers the encrypted
 * column (mig 026); falls back to the legacy plaintext column for rows
 * that haven't been re-encrypted yet. Returns null when neither is set.
 *
 * Decision Q1 in task_plan-ux-security-onboarding.md.
 */
export function resolveWebhookUrl(row: DbRow): string | null {
  if (row.slack_webhook_url_enc) {
    const plaintext = decryptIfNeeded(row.slack_webhook_url_enc)
    if (plaintext) return plaintext
  }
  return row.slack_webhook_url ?? null
}

function rowFromDb(row: DbRow): BusinessRow {
  return {
    slug:                     row.slug,
    name:                     row.name,
    status:                   row.status,
    user_id:                  row.user_id,
    brand_voice:              row.brand_voice,
    timezone:                 row.timezone,
    daily_cron_local_hour:    row.daily_cron_local_hour,
    niche:                    row.niche,
    money_model:              (row.money_model as BusinessRow['money_model']) ?? {},
    kpi_targets:              (row.kpi_targets as BusinessRow['kpi_targets']) ?? {},
    approval_gates:           (row.approval_gates as BusinessRow['approval_gates']) ?? [],
    slack_channel:            row.slack_channel,
    slack_webhook_url:        resolveWebhookUrl(row),
    webhook_last_verified_at: row.webhook_last_verified_at ?? null,
    webhook_last_error:       row.webhook_last_error ?? null,
    current_run_id:           row.current_run_id,
    last_operator_at:         row.last_operator_at,
    created_at:               row.created_at,
    updated_at:               row.updated_at,
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
  | 'webhook_last_verified_at' | 'webhook_last_error'
>

export async function upsertBusiness(row: BusinessUpsert): Promise<BusinessRow | null> {
  const db = createServerClient()
  if (!db) return null

  // Encrypt slack_webhook_url to slack_webhook_url_enc (mig 026). Keep the
  // plaintext column NULL going forward — the resolver still reads it for
  // pre-mig rows. encryptIfConfigured is a no-op when ENCRYPTION_KEY is
  // unset (dev), preserving plaintext fallback in development.
  type WriteRow = BusinessUpsert & {
    slack_webhook_url:     string | null
    slack_webhook_url_enc: string | null
  }
  const writeRow: WriteRow = {
    ...row,
    slack_webhook_url:     row.slack_webhook_url == null
      ? null
      : (isEncrypted(row.slack_webhook_url) ? null : row.slack_webhook_url),
    slack_webhook_url_enc: row.slack_webhook_url == null
      ? null
      : (isEncrypted(row.slack_webhook_url) ? row.slack_webhook_url : encryptIfConfigured(row.slack_webhook_url)),
  }
  // If encryption is configured, prefer cleartext-out-of-DB.
  if (writeRow.slack_webhook_url_enc && writeRow.slack_webhook_url_enc !== writeRow.slack_webhook_url) {
    writeRow.slack_webhook_url = null
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

/**
 * Patch the webhook health columns after a verify attempt. Used by
 * /api/businesses/verify-webhook (PR 4 of task_plan-ux-security-onboarding.md).
 */
export async function recordWebhookVerify(
  slug: string,
  result: { ok: boolean; error?: string },
): Promise<void> {
  const db = createServerClient()
  if (!db) return
  await (db.from('business_operators' as never) as unknown as {
    update: (patch: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> }
  })
    .update({
      webhook_last_verified_at: result.ok ? new Date().toISOString() : null,
      webhook_last_error:       result.ok ? null : (result.error ?? 'unknown_error'),
    })
    .eq('slug', slug)
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

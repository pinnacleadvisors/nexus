/**
 * Webhook idempotency helper.
 *
 * Backed by the `webhook_events` table from migration 027. Every webhook
 * handler that takes side-effecting actions (DB inserts, external calls)
 * should call this BEFORE the side effects. If `claimEvent` returns
 * `{ duplicate: true }`, the handler returns 200 immediately — the side
 * effects already happened on the first delivery.
 *
 * Pattern:
 *
 *   const claimed = await claimEvent('n8n', event.executionId)
 *   if (claimed.duplicate) {
 *     return NextResponse.json({ ok: true, duplicate: true })
 *   }
 *   // ...do side effects...
 *
 * Why a generic table instead of per-table columns: n8n, claw, stripe, slack,
 * github all need the same dedup logic. One table keeps the migration cost
 * flat as new webhooks are added.
 *
 * Failure modes — all return `{ duplicate: false, persisted: false }`:
 *   - Supabase not configured: skip dedup; let the side effects happen.
 *   - Network error talking to Supabase: skip dedup; log warning.
 * The handler still completes; we accept rare double-processing over hard
 * failure of the webhook itself (which would trigger upstream retries).
 */

import { createServerClient } from '@/lib/supabase'

interface ClaimResult {
  /** True if this event was already processed earlier — skip the side effects. */
  duplicate: boolean
  /** True if the row was actually written this call. False on dedup-skipped path. */
  persisted: boolean
}

export async function claimEvent(
  source:   'n8n' | 'claw' | 'stripe' | 'slack' | 'github' | string,
  eventId:  string | null | undefined,
  metadata?: Record<string, unknown>,
): Promise<ClaimResult> {
  if (!eventId) return { duplicate: false, persisted: false }
  const db = createServerClient()
  if (!db) return { duplicate: false, persisted: false }

  // INSERT ... ON CONFLICT DO NOTHING via upsert + ignoreDuplicates.
  // The PG row count tells us whether a new row was written.
  type LooseClient = {
    from: (t: string) => {
      insert: (rec: Record<string, unknown>) => Promise<{ error: { code?: string; message?: string } | null }>
    }
  }
  try {
    const res = await (db as unknown as LooseClient)
      .from('webhook_events')
      .insert({
        source,
        event_id: eventId,
        metadata: metadata ?? null,
      })
    if (!res.error) return { duplicate: false, persisted: true }
    // PG unique-violation = 23505. Some Supabase JS versions surface this as
    // .code, others as .message — check both.
    const isDuplicate =
      res.error.code === '23505' ||
      /duplicate key|already exists|webhook_events_pkey/i.test(res.error.message ?? '')
    if (isDuplicate) return { duplicate: true, persisted: false }
    // Unknown error — log but treat as not-deduped so the handler still runs.
    // Rare double-processing is preferable to hard webhook failure.
    console.warn('[webhook-idempotency] claim failed:', res.error.message)
    return { duplicate: false, persisted: false }
  } catch (err) {
    console.warn('[webhook-idempotency] claim threw:', err instanceof Error ? err.message : err)
    return { duplicate: false, persisted: false }
  }
}

'use server'

/**
 * /audit Server Actions — owner-gated, service-role table reads.
 *
 * The browser anon client can only see anon-readable tables (agents,
 * audit_log, approvals, tool_call_audit) and only those carry live Realtime
 * deltas. Initial loads, manual refreshes and the RLS-locked sources
 * (gateway_turns) all read through here with the service-role client, behind
 * the same owner gate as the page. On-demand RPC — NOT a polling endpoint, so
 * no Sentry-traces or retry-storm exposure.
 *
 * Returns {ok,rows,error} and NEVER throws — a failed read surfaces as a
 * non-fatal banner in the pane, not a 500.
 */

import { resolveUserIdSafe } from '@/lib/auth/resolve-user'
import { createServerClient } from '@/lib/supabase'
import { getSource, ROW_LIMIT } from '@/lib/audit/sources'
import type { AuditFetchResult } from '@/lib/audit/types'

function isOwner(userId: string): boolean {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return true
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean)).has(userId)
}

interface Query {
  eq:    (c: string, v: string) => Query
  in:    (c: string, v: string[]) => Query
  order: (c: string, o: { ascending: boolean }) => Query
  limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>
}

/** Fetch the latest rows for a table-backed source. Poll-backed sources
 *  (crons, heartbeats) return ok:true with no rows — the client polls their
 *  endpoint directly instead. */
export async function fetchAuditRows(sourceId: string): Promise<AuditFetchResult> {
  const userId = await resolveUserIdSafe()
  if (!userId || !isOwner(userId)) return { ok: false, rows: [], error: 'unauthorized' }

  const source = getSource(sourceId)
  if (!source) return { ok: false, rows: [], error: `unknown source: ${sourceId}` }
  if (!source.table) return { ok: true, rows: [] }

  const db = createServerClient()
  if (!db) return { ok: false, rows: [], error: 'supabase not configured' }

  let q = (db as unknown as {
    from: (t: string) => { select: (c: string) => Query }
  }).from(source.table).select('*') as Query

  if (source.read?.in) q = q.in(source.read.in.field, source.read.in.values)
  if (source.read?.eq) q = q.eq(source.read.eq.field, source.read.eq.value)

  const res = await q.order(source.tsField, { ascending: false }).limit(ROW_LIMIT)
  if (res.error) return { ok: false, rows: [], error: res.error.message }
  return { ok: true, rows: (res.data as AuditFetchResult['rows']) ?? [] }
}

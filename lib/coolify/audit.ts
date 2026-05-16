/**
 * lib/coolify/audit.ts — server-side helpers for the Coolify MCP's audit
 * table + kill switch.
 *
 * Three consumers:
 *   1. The MCP itself (services/mcp-coolify/) calls `logCoolifyAction`
 *      before AND after each tool invocation. The pre-call row records
 *      intent; the post-call PATCH records outcome.
 *   2. The MCP calls `isKillSwitchActive` on every tool call. Returns
 *      false → MCP refuses with a clear "operator revoked access" error.
 *   3. The /settings/accounts Coolify panel calls `listRecentAuditRows`
 *      to render the activity feed.
 *
 * Rate-limit math (also lives here so the MCP and the UI agree on the
 * threshold): max 5 writes per minute, 30 writes per hour, per user.
 * "Write" = anything that isn't `coolify_list_*` or `coolify_get_*`.
 */

import { createServerClient } from '@/lib/supabase'

export type CoolifyAuditResult = 'success' | 'error' | 'rate_limited' | 'protected_uuid' | 'kill_switch' | 'unauthorized_scope'

/** Scope under which a Coolify action was attempted.
 *   - 'admin'              → platform-copilot at /manage-platform
 *   - 'business:<slug>'    → business-copilot at /businesses/<slug>/chat
 *  Set on every audit insert by the MCP from its COOLIFY_SCOPE env. */
export type CoolifyScope = 'admin' | `business:${string}`

export interface CoolifyAuditRow {
  id:             string
  user_id:        string
  job_id:         string | null
  scope:          CoolifyScope
  action:         string
  target_uuid:    string | null
  args_redacted:  Record<string, unknown>
  result:         CoolifyAuditResult
  error_message:  string | null
  duration_ms:    number | null
  created_at:     string
}

export interface LogCoolifyActionInput {
  userId:       string
  jobId?:       string | null
  action:       string
  targetUuid?:  string | null
  argsRedacted: Record<string, unknown>
  result:       CoolifyAuditResult
  errorMessage?: string | null
  durationMs?:  number | null
}

/** Single-shot audit insert. Fire-and-forget — never throw on insert failure
 *  (an audit-log failure must not block the legitimate Coolify call from
 *  happening or surfacing its error). */
export async function logCoolifyAction(input: LogCoolifyActionInput): Promise<void> {
  const db = createServerClient()
  if (!db) return
  try {
    type InsertChain = { insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }> }
    await (db.from('coolify_audit_log' as never) as unknown as InsertChain).insert({
      user_id:       input.userId,
      job_id:        input.jobId ?? null,
      action:        input.action,
      target_uuid:   input.targetUuid ?? null,
      args_redacted: input.argsRedacted,
      result:        input.result,
      error_message: input.errorMessage ? input.errorMessage.slice(0, 1000) : null,
      duration_ms:   input.durationMs ?? null,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[coolify/audit] insert failed:', err instanceof Error ? err.message : err)
  }
}

/** Read the kill-switch row. Returns true when status='active', false when
 *  revoked OR when the read errors (fail-safe deny). */
export async function isKillSwitchActive(): Promise<boolean> {
  const db = createServerClient()
  if (!db) return false
  try {
    type Chain<T> = { eq: (c: string, v: unknown) => Chain<T>; single: () => Promise<{ data: T | null }> }
    const res = await (db.from('coolify_kill_switch' as never) as unknown as { select: (c: string) => Chain<{ status: string }> })
      .select('status')
      .eq('singleton', true)
      .single()
    return res.data?.status === 'active'
  } catch {
    return false
  }
}

/** Operator's "Disconnect" click in /settings/accounts. Flips the kill
 *  switch to 'revoked'. Returns the updated row's status. */
export async function revokeKillSwitch(input: { revokedBy: string; reason?: string }): Promise<'active' | 'revoked' | null> {
  const db = createServerClient()
  if (!db) return null
  try {
    type UpdateChain = { eq: (c: string, v: unknown) => { select: () => { single: () => Promise<{ data: { status: string } | null }> } } }
    const res = await (db.from('coolify_kill_switch' as never) as unknown as {
      update: (patch: Record<string, unknown>) => UpdateChain
    }).update({
      status:         'revoked',
      revoked_by:     input.revokedBy,
      revoked_reason: input.reason ?? null,
      revoked_at:     new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    }).eq('singleton', true).select().single()
    const s = res.data?.status
    return s === 'active' || s === 'revoked' ? s : null
  } catch {
    return null
  }
}

/** Restore access from the same surface. Clears the revoked_* fields. */
export async function reactivateKillSwitch(): Promise<'active' | 'revoked' | null> {
  const db = createServerClient()
  if (!db) return null
  try {
    type UpdateChain = { eq: (c: string, v: unknown) => { select: () => { single: () => Promise<{ data: { status: string } | null }> } } }
    const res = await (db.from('coolify_kill_switch' as never) as unknown as {
      update: (patch: Record<string, unknown>) => UpdateChain
    }).update({
      status:         'active',
      revoked_by:     null,
      revoked_reason: null,
      revoked_at:     null,
      updated_at:     new Date().toISOString(),
    }).eq('singleton', true).select().single()
    const s = res.data?.status
    return s === 'active' || s === 'revoked' ? s : null
  } catch {
    return null
  }
}

/** Count of "write" actions in the last N ms — used for rate-limit checks.
 *  "Write" excludes list_* and get_* actions. Optional scope filter scopes
 *  the count: a business-copilot's bursts shouldn't be blocked by a separate
 *  admin-side burst (they share the operator but operate independently). */
export async function recentWriteCount(input: { userId: string; sinceMs: number; scope?: CoolifyScope }): Promise<number> {
  const db = createServerClient()
  if (!db) return 0
  const cutoff = new Date(Date.now() - input.sinceMs).toISOString()
  try {
    // PostgREST/supabase-js: select with { count: 'exact', head: true }
    // returns { count, error } directly (Promise-like). We type the chain
    // as Promise-resolvable so the await yields the count surface.
    interface CountResp { count: number | null; error: { message: string } | null }
    interface CountChain {
      eq:  (c: string, v: unknown) => CountChain
      gte: (c: string, v: unknown) => CountChain
      not: (c: string, op: string, v: unknown) => CountChain
      then: Promise<CountResp>['then']
    }
    let q = (db.from('coolify_audit_log' as never) as unknown as { select: (c: string, opts?: { count: string; head: boolean }) => CountChain })
      .select('id', { count: 'exact', head: true })
      .eq('user_id', input.userId)
      .eq('result',  'success')
      .gte('created_at', cutoff)
      .not('action', 'like', 'coolify_list%')
      .not('action', 'like', 'coolify_get%')
    if (input.scope) q = q.eq('scope', input.scope)
    const res = await (q as unknown as Promise<CountResp>)
    return res.count ?? 0
  } catch {
    return 0
  }
}

export const RATE_LIMIT_WRITES_PER_MIN  = 5
export const RATE_LIMIT_WRITES_PER_HOUR = 30

/** List recent audit rows for the UI feed. Scope filter narrows the
 *  panel to admin-only or business-only activity — operator can switch
 *  via the BusinessSwitcher and the panel re-queries. */
export async function listRecentAuditRows(input: { userId: string; scope?: CoolifyScope; limit?: number }): Promise<CoolifyAuditRow[]> {
  const db = createServerClient()
  if (!db) return []
  try {
    type Chain<T> = { eq: (c: string, v: unknown) => Chain<T>; order: (c: string, o: { ascending: boolean }) => Chain<T>; limit: (n: number) => Promise<{ data: T[] | null }> }
    let q = (db.from('coolify_audit_log' as never) as unknown as { select: (c: string) => Chain<CoolifyAuditRow> })
      .select('*')
      .eq('user_id', input.userId)
    if (input.scope) q = q.eq('scope', input.scope)
    const res = await q
      .order('created_at', { ascending: false })
      .limit(input.limit ?? 50)
    return res.data ?? []
  } catch {
    return []
  }
}

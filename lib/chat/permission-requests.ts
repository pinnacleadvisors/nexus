/**
 * lib/chat/permission-requests.ts — server-side helpers for the
 * mcp-permission-broker flow (PR #189).
 *
 * Two consumers:
 *   1. The poll route (`app/api/platform-chat/poll/route.ts` +
 *      business-chat mirror) calls `listPendingForJob()` to surface
 *      pending requests in its response so the UI renders cards.
 *   2. The `/decide` route calls `decidePermissionRequest()` when the
 *      operator clicks Allow / Deny. That update is what the broker
 *      MCP is polling for — its tool returns once status flips.
 *
 * The broker MCP itself writes directly to Supabase (service role,
 * scoped via env vars). It doesn't go through these helpers — those
 * are Vercel-side only.
 */

import { createServerClient } from '@/lib/supabase'

export type PermissionStatus = 'pending' | 'allowed' | 'denied' | 'expired'

export interface PermissionDecision {
  reason?:               string
  /** JSON-encoded amended tool input. The MCP returns this as
   *  `updatedInput` so the CLI uses the operator's edits. */
  updated_input?:        Record<string, unknown>
  /** Operator's optional "auto-allow this exact tool for the rest of
   *  this chat session" flag. Phase-2 feature; persisted now so the UI
   *  can light up later without a migration. */
  remember_for_session?: boolean
}

export interface PermissionRequestRow {
  id:           string
  user_id:      string
  job_id:       string
  tool_name:    string
  tool_input:   Record<string, unknown>
  tool_use_id:  string | null
  status:       PermissionStatus
  decision:     PermissionDecision | null
  created_at:   string
  resolved_at:  string | null
}

type Chain<T> = {
  eq:     (c: string, v: unknown) => Chain<T>
  order:  (c: string, o: { ascending: boolean }) => Chain<T>
  limit:  (n: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
  single: () => Promise<{ data: T   | null; error: { message: string } | null }>
}

/**
 * List pending requests for a given job_id. Used by the poll route to
 * surface them inline with the running turn. user_id is checked so a
 * leaked jobId can't enumerate another operator's pending requests.
 */
export async function listPendingForJob(userId: string, jobId: string): Promise<PermissionRequestRow[]> {
  const db = createServerClient()
  if (!db) return []
  const res = await (db.from('chat_permission_requests' as never) as unknown as { select: (c: string) => Chain<PermissionRequestRow> })
    .select('*')
    .eq('user_id', userId)
    .eq('job_id', jobId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(20)
  return res.data ?? []
}

/**
 * Operator's decide-call lands here. Updates exactly one row by id,
 * with a defensive user_id match so a leaked id can't authorise
 * someone else's request. Returns the updated row, or null on failure
 * (most commonly: row not found OR already resolved).
 */
export async function decidePermissionRequest(input: {
  id:        string
  userId:    string
  status:    'allowed' | 'denied'
  decision?: PermissionDecision
}): Promise<PermissionRequestRow | null> {
  const db = createServerClient()
  if (!db) return null
  // Optimistic guard — only resolve rows that are still pending. This
  // prevents a stale tab from overwriting an earlier decision.
  const patch: Record<string, unknown> = {
    status:      input.status,
    decision:    input.decision ?? null,
    resolved_at: new Date().toISOString(),
  }
  const res = await (db.from('chat_permission_requests' as never) as unknown as {
    update: (u: typeof patch) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { select: () => { single: () => Promise<{ data: PermissionRequestRow | null }> } } } } }
  }).update(patch).eq('id', input.id).eq('user_id', input.userId).eq('status', 'pending').select().single()
  return res.data ?? null
}

/**
 * Get a single request by id (with user_id check). Used by the decide
 * route to look up tool_name + tool_input for audit logging when the
 * operator approves or denies a request.
 */
export async function getPermissionRequest(userId: string, id: string): Promise<PermissionRequestRow | null> {
  const db = createServerClient()
  if (!db) return null
  const res = await (db.from('chat_permission_requests' as never) as unknown as { select: (c: string) => Chain<PermissionRequestRow> })
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()
  return res.data ?? null
}

/**
 * Mark long-pending rows as expired so the chat UI's "Pending" list
 * doesn't accumulate stale cards. Called fire-and-forget from the poll
 * route — gateway will time out the MCP poll after ~10 min regardless,
 * so anything older than 15 min is definitely abandoned.
 */
export async function expireStaleRequests(jobId: string, cutoffMs = 15 * 60_000): Promise<void> {
  const db = createServerClient()
  if (!db) return
  const cutoff = new Date(Date.now() - cutoffMs).toISOString()
  type UpdateChain = { eq: (c: string, v: unknown) => { lt: (c: string, v: unknown) => { eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }> } } }
  await (db.from('chat_permission_requests' as never) as unknown as {
    update: (u: Record<string, unknown>) => UpdateChain
  }).update({ status: 'expired', resolved_at: new Date().toISOString() })
   .eq('job_id', jobId)
   .lt('created_at', cutoff)
   .eq('status', 'pending')
}

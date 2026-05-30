/**
 * Database helpers for chat_sessions + chat_messages (Phase 4 of
 * task_plan-chat.md). All routes go through these so the loose-typed
 * supabase-js chain only appears here, and route handlers stay clean.
 *
 * Service-role access only — these helpers assume the caller has already
 * authenticated via Clerk and is filtering by user_id. RLS on the tables
 * additionally enforces service-role-only at the DB layer.
 */

import { createServerClient } from '@/lib/supabase'

export interface ChatSessionRow {
  id:               string
  user_id:          string
  scope:            string
  agent_slug:       string
  title:            string | null
  created_at:       string
  last_message_at:  string
  /** R9 retrospective columns. Optional — populated by the daily
   *  /api/cron/chat-retrospectives cron 7d after last activity. Read
   *  on session reopen so the operator immediately sees "what we
   *  decided last time" instead of scrolling 50 messages back.
   *  Migration 092. Fail-soft: callers tolerate missing column when
   *  the migration hasn't been applied yet. */
  retrospective_md?:           string | null
  retrospective_generated_at?: string | null
  /** Durable-turn tracking (migration 099). The detached gateway job whose
   *  reply hasn't been persisted yet; drained=false means a turn is in flight. */
  inflight_job_id?:     string | null
  inflight_started_at?: string | null
  inflight_drained?:    boolean
}

export interface ChatMessageRow {
  id:          string
  session_id:  string
  role:        'user' | 'assistant' | 'system'
  content:     string
  metadata:    Record<string, unknown>
  created_at:  string
}

interface Chain<T> {
  eq:     (c: string, v: unknown) => Chain<T>
  order:  (c: string, o: { ascending: boolean }) => Chain<T>
  limit:  (n: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
  single: () => Promise<{ data: T   | null; error: { message: string } | null }>
}

interface InsertChain<T> {
  select: (c: string) => { single: () => Promise<{ data: T | null; error: { message: string } | null }> }
}

interface UpdateChain {
  eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>
}

interface DeleteChain {
  eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function table<T>(name: string) {
  const db = createServerClient()
  if (!db) return null
  return db.from(name as never) as unknown as {
    select: (cols: string) => Chain<T>
    insert: (row: Record<string, unknown>) => InsertChain<T>
    update: (patch: Record<string, unknown>) => UpdateChain
    delete: () => DeleteChain
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function listSessions(userId: string, scope = 'platform', limit = 50): Promise<ChatSessionRow[]> {
  const t = table<ChatSessionRow>('chat_sessions')
  if (!t) return []
  const res = await t.select('id, user_id, scope, agent_slug, title, created_at, last_message_at')
    .eq('user_id', userId)
    .eq('scope', scope)
    .order('last_message_at', { ascending: false })
    .limit(limit)
  return res.data ?? []
}

export async function createSession(input: {
  userId:     string
  scope?:     string
  agentSlug?: string
  title?:     string | null
}): Promise<ChatSessionRow | null> {
  const t = table<ChatSessionRow>('chat_sessions')
  if (!t) return null
  const res = await t.insert({
    user_id:    input.userId,
    scope:      input.scope     ?? 'platform',
    agent_slug: input.agentSlug ?? 'platform-copilot',
    title:      input.title     ?? null,
  }).select('id, user_id, scope, agent_slug, title, created_at, last_message_at').single()
  if (res.error || !res.data) return null
  return res.data
}

export async function getSession(userId: string, sessionId: string): Promise<ChatSessionRow | null> {
  const t = table<ChatSessionRow>('chat_sessions')
  if (!t) return null
  // Attempt to include the R9 retrospective columns. If migration 092
  // hasn't applied yet (e.g. local dev DB), Postgres errors with
  // "column ... does not exist" — we fall back to the legacy column set
  // so the chat view still renders. Once 092 has shipped everywhere,
  // the second-pass fallback becomes dead code.
  try {
    const res = await t.select('id, user_id, scope, agent_slug, title, created_at, last_message_at, retrospective_md, retrospective_generated_at')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .limit(1)
    if (res.error) {
      if (/column .*retrospective_md.* does not exist/i.test(res.error.message)) {
        const fallback = await t.select('id, user_id, scope, agent_slug, title, created_at, last_message_at')
          .eq('id', sessionId)
          .eq('user_id', userId)
          .limit(1)
        return fallback.data?.[0] ?? null
      }
      return null
    }
    return res.data?.[0] ?? null
  } catch {
    return null
  }
}

export async function deleteSession(userId: string, sessionId: string): Promise<boolean> {
  const t = table<ChatSessionRow>('chat_sessions')
  if (!t) return false
  // Verify ownership first — the DELETE chain doesn't expose double-eq
  // through this loose-typed wrapper, so we look it up then delete by id.
  const existing = await getSession(userId, sessionId)
  if (!existing) return false
  const res = await t.delete().eq('id', sessionId)
  return !res.error
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  const t = table<ChatSessionRow>('chat_sessions')
  if (!t) return
  await t.update({ title, last_message_at: new Date().toISOString() }).eq('id', sessionId)
}

export async function touchSession(sessionId: string): Promise<void> {
  const t = table<ChatSessionRow>('chat_sessions')
  if (!t) return
  await t.update({ last_message_at: new Date().toISOString() }).eq('id', sessionId)
}

// ── Durable-turn tracking (migration 099) ────────────────────────────────────

/** Mark a session's turn as in-flight — a detached gateway job is running. */
export async function setInflightTurn(sessionId: string, jobId: string): Promise<void> {
  const t = table<ChatSessionRow>('chat_sessions')
  if (!t) return
  await t.update({
    inflight_job_id:     jobId,
    inflight_started_at: new Date().toISOString(),
    inflight_drained:    false,
  }).eq('id', sessionId)
}

/**
 * Atomically claim a completed turn for persistence. Returns true if THIS
 * caller won (and must persist), false if another writer already drained it
 * (skip — avoid a double append). The `inflight_drained=false` predicate is
 * the concurrency gate between the server reconciler and a late browser poll.
 *
 * Fail-OPEN: a missing DB / claim error returns true so a reply is never
 * dropped — a rare double is recoverable; a drop is data loss.
 */
export async function claimInflightTurn(sessionId: string, jobId: string): Promise<boolean> {
  const sb = createServerClient()
  if (!sb) return true
  try {
    const res = await (sb.from('chat_sessions') as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            eq: (c: string, v: boolean) => {
              select: (c: string) => Promise<{ data: Array<{ id: string }> | null; error: unknown }>
            }
          }
        }
      }
    })
      .update({ inflight_drained: true, inflight_job_id: null })
      .eq('id', sessionId)
      .eq('inflight_job_id', jobId)
      .eq('inflight_drained', false)
      .select('id')
    if (res.error) return true
    return (res.data?.length ?? 0) > 0
  } catch {
    return true
  }
}

/**
 * Read the live in-flight turn for a session — returns the running gateway
 * jobId only when a turn is still detached (inflight_drained=false). Used by
 * the messages route so the chat UI can re-attach its poll on reopen (Phase C).
 *
 * Fail-soft: returns null on any error / missing column (migration 099 not
 * applied), so a stale schema never breaks history load — the UI simply
 * doesn't re-attach.
 */
export async function getInflightTurn(
  sessionId: string,
): Promise<{ jobId: string; startedAt: string | null } | null> {
  const t = table<ChatSessionRow>('chat_sessions')
  if (!t) return null
  try {
    const res = await t.select('inflight_job_id, inflight_started_at, inflight_drained')
      .eq('id', sessionId)
      .limit(1)
    if (res.error) return null
    const row = res.data?.[0]
    if (!row || row.inflight_drained !== false || !row.inflight_job_id) return null
    return { jobId: row.inflight_job_id, startedAt: row.inflight_started_at ?? null }
  } catch {
    return null
  }
}

// ── Messages ─────────────────────────────────────────────────────────────────

export async function listMessages(sessionId: string, limit = 200): Promise<ChatMessageRow[]> {
  const t = table<ChatMessageRow>('chat_messages')
  if (!t) return []
  const res = await t.select('id, session_id, role, content, metadata, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(limit)
  return res.data ?? []
}

export async function appendMessage(input: {
  sessionId:  string
  role:       'user' | 'assistant' | 'system'
  content:    string
  metadata?:  Record<string, unknown>
}): Promise<ChatMessageRow | null> {
  const t = table<ChatMessageRow>('chat_messages')
  if (!t) return null
  const res = await t.insert({
    session_id: input.sessionId,
    role:       input.role,
    content:    input.content,
    metadata:   input.metadata ?? {},
  }).select('id, session_id, role, content, metadata, created_at').single()
  if (res.error || !res.data) return null
  await touchSession(input.sessionId)
  return res.data
}

/**
 * Persist a turn-level error onto the most recent USER message of a session
 * (Phase D3). When the gateway enqueue fails, the operator's input is already
 * persisted (route.ts persists it pre-dispatch) but the failure lived only in
 * React state — lost on navigation. Stamping `metadata.turn_error` makes the
 * error survive a reload + surfaces it in /inbox (loadChatTurnAlerts).
 *
 * Fail-soft: never throws — a failed error-stamp must not mask the original
 * error the caller is already returning to the client.
 */
export async function markTurnError(
  sessionId: string,
  turnError: { code: string; message: string },
): Promise<void> {
  const t = table<ChatMessageRow>('chat_messages')
  if (!t) return
  try {
    const sel = await t.select('id, metadata')
      .eq('session_id', sessionId)
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .limit(1)
    const row = sel.data?.[0]
    if (!row) return
    await t.update({
      metadata: { ...(row.metadata ?? {}), turn_error: turnError },
    }).eq('id', row.id)
  } catch {
    /* fail-soft — the caller already surfaces the underlying error */
  }
}

/** Derive a session title from the first user message — truncated to a clean prefix. */
export function deriveTitleFromMessage(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  if (flat.length <= 60) return flat || 'New chat'
  return flat.slice(0, 57) + '…'
}

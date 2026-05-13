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
  const res = await t.select('id, user_id, scope, agent_slug, title, created_at, last_message_at')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .limit(1)
  return res.data?.[0] ?? null
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

/** Derive a session title from the first user message — truncated to a clean prefix. */
export function deriveTitleFromMessage(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  if (flat.length <= 60) return flat || 'New chat'
  return flat.slice(0, 57) + '…'
}

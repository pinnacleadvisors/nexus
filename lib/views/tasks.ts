/**
 * lib/views/tasks.ts — CRUD helpers for `operator_tasks` (migration 037).
 *
 * Backs the Tasks panel in the chat Views dropdown. All functions are
 * service-role writes; client-side API routes auth via Clerk and pass the
 * authenticated user_id, so RLS stays single-user.
 *
 * Sources of inserts:
 *   - Operator-driven: POST /api/views/tasks (UI "+ New task" click)
 *   - Agent-driven:    /api/platform-chat/poll + /api/businesses/<slug>/chat/poll
 *                       extract `manual-task` fenced blocks from the final
 *                       assistant message and call createTask() with
 *                       source='agent' + source_session_id.
 */

import { createServerClient } from '@/lib/supabase'

export interface OperatorTaskRow {
  id:                string
  user_id:           string
  scope:             string
  title:             string
  description:       string | null
  done:              boolean
  source:            'operator' | 'agent'
  source_session_id: string | null
  due_at:            string | null
  created_at:        string
  completed_at:      string | null
}

export interface CreateTaskInput {
  userId:            string
  scope:             string         // 'admin' or 'business:<slug>'
  title:             string
  description?:      string | null
  source?:           'operator' | 'agent'
  sourceSessionId?:  string | null
  dueAt?:            string | null   // ISO 8601
}

interface Chain<T> {
  eq:      (c: string, v: unknown) => Chain<T>
  is:      (c: string, v: unknown) => Chain<T>
  order:   (c: string, opts: { ascending: boolean }) => Chain<T>
  limit:   (n: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
}

export async function listTasks(userId: string, scope: string, opts?: { done?: boolean; limit?: number }): Promise<OperatorTaskRow[]> {
  const db = createServerClient()
  if (!db) return []
  let q = (db.from('operator_tasks' as never) as unknown as { select: (c: string) => Chain<OperatorTaskRow> })
    .select('*')
    .eq('user_id', userId)
    .eq('scope', scope)
  if (typeof opts?.done === 'boolean') q = q.eq('done', opts.done)
  const res = await q.order('done', { ascending: true }).order('created_at', { ascending: false }).limit(opts?.limit ?? 200)
  return res.data ?? []
}

export async function createTask(input: CreateTaskInput): Promise<OperatorTaskRow | null> {
  const db = createServerClient()
  if (!db) return null
  const row = {
    user_id:           input.userId,
    scope:             input.scope,
    title:             input.title.trim().slice(0, 500),
    description:       input.description?.trim() ?? null,
    source:            input.source ?? 'operator',
    source_session_id: input.sourceSessionId ?? null,
    due_at:            input.dueAt ?? null,
  }
  const res = await (db.from('operator_tasks' as never) as unknown as {
    insert: (r: typeof row) => { select: () => { single: () => Promise<{ data: OperatorTaskRow | null }> } }
  }).insert(row).select().single()
  return res.data ?? null
}

export async function updateTask(userId: string, id: string, patch: { done?: boolean; title?: string; description?: string | null; due_at?: string | null }): Promise<OperatorTaskRow | null> {
  const db = createServerClient()
  if (!db) return null
  const updates: Record<string, unknown> = {}
  if (typeof patch.done === 'boolean') {
    updates.done = patch.done
    updates.completed_at = patch.done ? new Date().toISOString() : null
  }
  if (typeof patch.title       === 'string') updates.title       = patch.title.trim().slice(0, 500)
  if (patch.description !== undefined)       updates.description = patch.description?.trim() ?? null
  if (patch.due_at      !== undefined)       updates.due_at      = patch.due_at ?? null
  if (Object.keys(updates).length === 0) return null
  const res = await (db.from('operator_tasks' as never) as unknown as {
    update: (u: typeof updates) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { select: () => { single: () => Promise<{ data: OperatorTaskRow | null }> } } } }
  }).update(updates).eq('id', id).eq('user_id', userId).select().single()
  return res.data ?? null
}

export async function deleteTask(userId: string, id: string): Promise<boolean> {
  const db = createServerClient()
  if (!db) return false
  const res = await (db.from('operator_tasks' as never) as unknown as {
    delete: () => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ error: unknown }> } }
  }).delete().eq('id', id).eq('user_id', userId)
  return !res.error
}

/** Count of incomplete tasks per scope — used to badge the Views button. */
export async function countOpenTasks(userId: string, scope: string): Promise<number> {
  const tasks = await listTasks(userId, scope, { done: false, limit: 100 })
  return tasks.length
}

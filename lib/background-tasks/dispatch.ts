/**
 * lib/background-tasks/dispatch.ts — CRUD + lifecycle helpers for the
 * `background_tasks` table (migration 053).
 *
 * Phase 4 of task_plan-collaborative-chat.md. v1 ships the visible surface
 * (rows created, listed, cancelled) without autonomous execution; v2 wires
 * Inngest handlers per `kind` to actually drive `status` pending → running
 * → done/error.
 *
 * Two sources of inserts:
 *   - Agent-driven: chat poll route extracts `background-task` blocks
 *     and calls createBackgroundTask() with source='agent'.
 *   - Operator-driven: explicit "+ New background task" click in the view
 *     UI (deferred — v1 view is read-only).
 *
 * Identical scope partitioning to operator_tasks ('admin' or
 * 'business:<slug>') so cross-business pollution stays structurally
 * impossible.
 */

import { createServerClient } from '@/lib/supabase'

export type BackgroundTaskStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled'

export type BackgroundTaskKind =
  | 'playwright-run'
  | 'firecrawl-crawl'
  | 'codex-dispatch'
  | 'n8n-workflow'
  | 'custom'

export interface BackgroundTaskRow {
  id:                string
  user_id:           string
  scope:             string
  chat_session_id:   string | null
  /** Phase 5: parent swarm row when this is a child sub-task. Null otherwise. */
  parent_id?:        string | null
  kind:              BackgroundTaskKind | string
  title:             string
  description:       string | null
  payload:           unknown
  status:            BackgroundTaskStatus
  result:            unknown
  error:             string | null
  started_at:        string | null
  finished_at:       string | null
  cancelled_at:      string | null
  created_at:        string
}

export interface CreateBackgroundTaskInput {
  userId:          string
  scope:           string
  chatSessionId?:  string | null
  /** Phase 5: when set, this row is a child of a swarm parent. */
  parentId?:       string | null
  kind:            string
  title:           string
  description?:    string | null
  payload?:        unknown
}

interface InsertChain<T> {
  insert: (row: Record<string, unknown>) => { select: () => { single: () => Promise<{ data: T | null; error: unknown }> } }
}
interface SelectChain<T> {
  select: (c: string) => Chain<T>
}
interface Chain<T> {
  eq:    (c: string, v: unknown) => Chain<T>
  in:    (c: string, v: unknown[]) => Chain<T>
  order: (c: string, opts: { ascending: boolean }) => Chain<T>
  limit: (n: number) => Promise<{ data: T[] | null; error: unknown }>
}
interface UpdateChain<T> {
  update: (patch: Record<string, unknown>) => { eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => { select: () => { single: () => Promise<{ data: T | null; error: unknown }> } } } }
}

export async function createBackgroundTask(input: CreateBackgroundTaskInput): Promise<BackgroundTaskRow | null> {
  const db = createServerClient()
  if (!db) return null
  const res = await (db.from('background_tasks' as never) as unknown as InsertChain<BackgroundTaskRow>)
    .insert({
      user_id:         input.userId,
      scope:           input.scope,
      chat_session_id: input.chatSessionId ?? null,
      parent_id:       input.parentId ?? null,
      kind:            input.kind.trim().slice(0, 80),
      title:           input.title.trim().slice(0, 500),
      description:     input.description?.trim() ?? null,
      payload:         input.payload ?? {},
    })
    .select()
    .single()
  return res.data ?? null
}

export async function listBackgroundTasks(userId: string, scope: string, opts?: { statuses?: BackgroundTaskStatus[]; limit?: number }): Promise<BackgroundTaskRow[]> {
  const db = createServerClient()
  if (!db) return []
  let chain = (db.from('background_tasks' as never) as unknown as SelectChain<BackgroundTaskRow>)
    .select('*')
    .eq('user_id', userId)
    .eq('scope', scope)
  if (opts?.statuses && opts.statuses.length > 0) {
    chain = chain.in('status', opts.statuses)
  }
  const res = await chain
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 50)
  return res.data ?? []
}

export async function cancelBackgroundTask(userId: string, id: string): Promise<BackgroundTaskRow | null> {
  const db = createServerClient()
  if (!db) return null
  const res = await (db.from('background_tasks' as never) as unknown as UpdateChain<BackgroundTaskRow>)
    .update({
      status:       'cancelled',
      cancelled_at: new Date().toISOString(),
      finished_at:  new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()
  return res.data ?? null
}

/** Count of pending OR running tasks for the badge on the Views button. */
export async function countActiveBackgroundTasks(userId: string, scope: string): Promise<number> {
  const tasks = await listBackgroundTasks(userId, scope, { statuses: ['pending', 'running'], limit: 100 })
  return tasks.length
}

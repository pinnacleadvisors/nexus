/**
 * lib/bug-hunt/sessions.ts — CRUD for bug_hunt_sessions + bug_hunt_findings.
 *
 * Wraps the migration-040 tables. All writes go through service-role; the
 * Vercel API routes call these after Clerk-auth + ownership checks.
 */

import { createServerClient } from '@/lib/supabase'

export type BugHuntStatus     = 'active' | 'paused' | 'stopped' | 'done'
export type FindingStatus     = 'open' | 'pr-opened' | 'merged' | 'wont-fix'

export interface BugHuntSessionRow {
  id:                      string
  user_id:                 string
  scope:                   string
  status:                  BugHuntStatus
  plan_window_share_pct:   number
  codex_window_share_pct:  number
  force_plan_window:       boolean
  budget_usd:              number
  spent_usd:               number
  max_iterations:          number
  iteration_count:         number
  created_at:              string
  ended_at:                string | null
}

export interface BugHuntFindingRow {
  id:           string
  session_id:   string
  iteration:    number
  severity:     'p0' | 'p1' | 'p2' | 'p3'
  category:     'static' | 'smoke' | 'semantic'
  title:        string
  detail:       string | null
  source_path:  string | null
  status:       FindingStatus
  pr_url:       string | null
  branch:       string | null
  created_at:   string
  resolved_at:  string | null
}

interface Chain<T> {
  eq:     (c: string, v: unknown) => Chain<T>
  in:     (c: string, v: string[]) => Chain<T>
  order:  (c: string, o: { ascending: boolean }) => Chain<T>
  limit:  (n: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
  single: () => Promise<{ data: T | null; error: { message: string } | null }>
}

function sessionId(scope: string): string {
  const date = new Date().toISOString().slice(0, 10)   // YYYY-MM-DD
  const scopeSlug = scope === 'admin' ? 'admin' : scope.replace(/^business:/, 'biz-')
  const seq  = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `bh-${date}-${scopeSlug}-${seq}`
}

export interface CreateSessionInput {
  userId:                 string
  scope:                  string
  planWindowSharePct?:    number
  codexWindowSharePct?:   number
  forcePlanWindow?:       boolean
  budgetUsd?:             number
  maxIterations?:         number
}

export async function createSession(input: CreateSessionInput): Promise<BugHuntSessionRow | null> {
  const db = createServerClient()
  if (!db) return null
  const row = {
    id:                      sessionId(input.scope),
    user_id:                 input.userId,
    scope:                   input.scope,
    status:                  'active' as const,
    plan_window_share_pct:   input.planWindowSharePct  ?? 33,
    codex_window_share_pct:  input.codexWindowSharePct ?? 33,
    force_plan_window:       input.forcePlanWindow     ?? true,
    budget_usd:              input.budgetUsd           ?? 5,
    max_iterations:          input.maxIterations       ?? 20,
  }
  const res = await (db.from('bug_hunt_sessions' as never) as unknown as {
    insert: (r: typeof row) => { select: () => { single: () => Promise<{ data: BugHuntSessionRow | null }> } }
  }).insert(row).select().single()
  return res.data ?? null
}

export async function getActiveSession(userId: string, scope: string): Promise<BugHuntSessionRow | null> {
  const db = createServerClient()
  if (!db) return null
  const res = await (db.from('bug_hunt_sessions' as never) as unknown as { select: (c: string) => Chain<BugHuntSessionRow> })
    .select('*')
    .eq('user_id', userId)
    .eq('scope', scope)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
  return res.data?.[0] ?? null
}

export async function getSession(userId: string, id: string): Promise<BugHuntSessionRow | null> {
  const db = createServerClient()
  if (!db) return null
  const res = await (db.from('bug_hunt_sessions' as never) as unknown as { select: (c: string) => Chain<BugHuntSessionRow> })
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .limit(1)
  return res.data?.[0] ?? null
}

export async function updateSessionStatus(userId: string, id: string, status: BugHuntStatus): Promise<BugHuntSessionRow | null> {
  const db = createServerClient()
  if (!db) return null
  const patch: Record<string, unknown> = { status }
  if (status === 'stopped' || status === 'done') patch.ended_at = new Date().toISOString()
  const res = await (db.from('bug_hunt_sessions' as never) as unknown as {
    update: (u: typeof patch) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { select: () => { single: () => Promise<{ data: BugHuntSessionRow | null }> } } } }
  }).update(patch).eq('id', id).eq('user_id', userId).select().single()
  return res.data ?? null
}

export async function bumpIteration(userId: string, id: string): Promise<BugHuntSessionRow | null> {
  const db = createServerClient()
  if (!db) return null
  const current = await getSession(userId, id)
  if (!current) return null
  const next = (current.iteration_count ?? 0) + 1
  const res = await (db.from('bug_hunt_sessions' as never) as unknown as {
    update: (u: Record<string, unknown>) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { select: () => { single: () => Promise<{ data: BugHuntSessionRow | null }> } } } }
  }).update({ iteration_count: next }).eq('id', id).eq('user_id', userId).select().single()
  return res.data ?? null
}

export async function listFindings(sessionId: string): Promise<BugHuntFindingRow[]> {
  const db = createServerClient()
  if (!db) return []
  const res = await (db.from('bug_hunt_findings' as never) as unknown as { select: (c: string) => Chain<BugHuntFindingRow> })
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(500)
  return res.data ?? []
}

export interface InsertFindingInput {
  sessionId:   string
  iteration:   number
  severity:    'p0' | 'p1' | 'p2' | 'p3'
  category:    'static' | 'smoke' | 'semantic'
  title:       string
  detail?:     string | null
  sourcePath?: string | null
}

export async function insertFinding(input: InsertFindingInput): Promise<BugHuntFindingRow | null> {
  const db = createServerClient()
  if (!db) return null
  const row = {
    session_id:  input.sessionId,
    iteration:   input.iteration,
    severity:    input.severity,
    category:    input.category,
    title:       input.title.trim().slice(0, 500),
    detail:      input.detail?.trim() ?? null,
    source_path: input.sourcePath?.trim().slice(0, 500) ?? null,
  }
  const res = await (db.from('bug_hunt_findings' as never) as unknown as {
    insert: (r: typeof row) => { select: () => { single: () => Promise<{ data: BugHuntFindingRow | null }> } }
  }).insert(row).select().single()
  return res.data ?? null
}

export async function updateFinding(sessionUserId: string, findingId: string, patch: Partial<{ status: FindingStatus; pr_url: string | null; branch: string | null }>): Promise<BugHuntFindingRow | null> {
  const db = createServerClient()
  if (!db) return null
  const updates: Record<string, unknown> = { ...patch }
  if (patch.status === 'merged' || patch.status === 'wont-fix') updates.resolved_at = new Date().toISOString()
  // Ownership check via session_id → session.user_id.
  const finding = await (db.from('bug_hunt_findings' as never) as unknown as { select: (c: string) => Chain<BugHuntFindingRow> })
    .select('*')
    .eq('id', findingId)
    .limit(1)
  const row = finding.data?.[0]
  if (!row) return null
  const sess = await getSession(sessionUserId, row.session_id)
  if (!sess) return null
  const res = await (db.from('bug_hunt_findings' as never) as unknown as {
    update: (u: Record<string, unknown>) => { eq: (c: string, v: string) => { select: () => { single: () => Promise<{ data: BugHuntFindingRow | null }> } } }
  }).update(updates).eq('id', findingId).select().single()
  return res.data ?? null
}

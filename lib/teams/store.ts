/**
 * lib/teams/store.ts — CRUD for `teams` + `team_members` (migration 060).
 *
 * Service-role only. API routes auth via Clerk and pass user_id through
 * for the explicit ownership check (mirrors lib/views/tasks.ts).
 */

import { createServerClient } from '@/lib/supabase'
import type { DepartmentSlug } from './departments'

export type TeamStatus = 'active' | 'paused' | 'archived'

export interface TeamRow {
  id:                 string
  user_id:            string
  business_slug:      string | null   // null = admin-scope teams (rare)
  department_slug:    DepartmentSlug
  status:             TeamStatus
  ecosystem_bindings: Record<string, string>
  created_at:         string
  updated_at:         string
  /** Org-chart parent (migration 063). null = root reporter. */
  parent_team_id:     string | null
  /** Time-bounded teams auto-archive when expires_at passes (cron, future). */
  expires_at:         string | null
  /** Saved-arrangement provenance. Null when spawned manually. */
  template_id:        string | null
}

export interface TeamMemberRow {
  id:              string
  team_id:         string
  role_slug:       string
  agent_spec_path: string | null     // .claude/agents/departments/<dept>/<role>.md
  ecosystem_overrides: Record<string, string>
  tool_budget:     string[]          // ≥ 2 entries per the AGENTS.md rule
  created_at:      string
}

export interface CreateTeamInput {
  userId:            string
  businessSlug:      string | null
  departmentSlug:    DepartmentSlug
  ecosystemBindings: Record<string, string>
  members:           Array<{ roleSlug: string; agentSpecPath: string | null; toolBudget: string[] }>
}

interface Chain<T> {
  eq:    (c: string, v: unknown) => Chain<T>
  is:    (c: string, v: unknown) => Chain<T>
  order: (c: string, opts: { ascending: boolean }) => Chain<T>
  limit: (n: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
}

/** List teams for an operator, optionally scoped to one business. */
export async function listTeams(userId: string, businessSlug?: string | null): Promise<TeamRow[]> {
  const db = createServerClient()
  if (!db) return []
  let q = (db.from('teams' as never) as unknown as { select: (c: string) => Chain<TeamRow> })
    .select('*')
    .eq('user_id', userId)
  if (businessSlug !== undefined && businessSlug !== null) q = q.eq('business_slug', businessSlug)
  const res = await q.order('created_at', { ascending: false }).limit(200)
  return res.data ?? []
}

/** List members of one team. */
export async function listTeamMembers(teamId: string): Promise<TeamMemberRow[]> {
  const db = createServerClient()
  if (!db) return []
  const res = await (db.from('team_members' as never) as unknown as { select: (c: string) => Chain<TeamMemberRow> })
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: true })
    .limit(50)
  return res.data ?? []
}

/** Spawn a team with its members. Single statement per row so a partial
 *  failure leaves a coherent state — the caller can re-run safely. */
export async function createTeam(input: CreateTeamInput): Promise<TeamRow | null> {
  const db = createServerClient()
  if (!db) return null
  const teamRow = {
    user_id:            input.userId,
    business_slug:      input.businessSlug,
    department_slug:    input.departmentSlug,
    status:             'active' as TeamStatus,
    ecosystem_bindings: input.ecosystemBindings,
  }
  const teamRes = await (db.from('teams' as never) as unknown as {
    insert: (r: typeof teamRow) => { select: () => { single: () => Promise<{ data: TeamRow | null }> } }
  }).insert(teamRow).select().single()
  const team = teamRes.data
  if (!team) return null

  for (const m of input.members) {
    const memberRow = {
      team_id:             team.id,
      role_slug:           m.roleSlug,
      agent_spec_path:     m.agentSpecPath,
      ecosystem_overrides: {},
      tool_budget:         m.toolBudget,
    }
    await (db.from('team_members' as never) as unknown as {
      insert: (r: typeof memberRow) => Promise<{ error: unknown }>
    }).insert(memberRow)
  }
  return team
}

/** Update team status (active / paused / archived) and / or rebind one
 *  ecosystem. Both knobs in one call so the operator can pause-and-rebind
 *  atomically. Org-chart fields (parent_team_id) live here too — same
 *  PATCH route, same shape. */
export async function updateTeam(
  userId: string,
  teamId: string,
  patch: {
    status?:            TeamStatus
    ecosystemBindings?: Record<string, string>
    parentTeamId?:      string | null
  },
): Promise<TeamRow | null> {
  const db = createServerClient()
  if (!db) return null
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.status)                 updates.status             = patch.status
  if (patch.ecosystemBindings)      updates.ecosystem_bindings = patch.ecosystemBindings
  if (patch.parentTeamId !== undefined) updates.parent_team_id = patch.parentTeamId
  if (Object.keys(updates).length === 1) return null  // only updated_at — no-op
  const res = await (db.from('teams' as never) as unknown as {
    update: (u: typeof updates) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { select: () => { single: () => Promise<{ data: TeamRow | null }> } } } }
  }).update(updates).eq('id', teamId).eq('user_id', userId).select().single()
  return res.data ?? null
}

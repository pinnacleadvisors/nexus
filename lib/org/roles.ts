/**
 * lib/org/roles.ts — org-chart data layer.
 *
 * Reads + writes `agent_roles` (migration 057). Gracefully degrades when the
 * migration hasn't been applied yet (returns empty lists / null) so the /org
 * page can render an empty-state CTA without throwing.
 *
 * See: supabase/migrations/057_agent_roles.sql
 *      app/(protected)/org/page.tsx
 *      task_plan-platform-expansion.md (Task C)
 */

import { createServerClient } from '@/lib/supabase'

export interface AgentRole {
  id:                   string
  business_slug:        string | null
  role_title:           string
  parent_role_id:       string | null
  assigned_agent_slug:  string | null
  assigned_user_id:     string | null
  responsibilities:     string | null
  reports_to_summary:   string | null
  sort_order:           number
  created_at:           string
  updated_at:           string
}

export interface RoleNode extends AgentRole {
  children: RoleNode[]
}

let tableAvailable: boolean | null = null

function isMissingTable(message: string): boolean {
  if (!message) return false
  return /relation .*agent_roles.* does not exist|Could not find the table .*agent_roles/i.test(message)
}

interface BasicChain {
  eq:    (c: string, v: unknown) => BasicChain
  is:    (c: string, v: null) => BasicChain
  order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: { message: string } | null }>
}

export async function listRoles(opts?: { businessSlug?: string | null }): Promise<AgentRole[]> {
  if (tableAvailable === false) return []
  const db = createServerClient()
  if (!db) return []

  let chain = (db as unknown as {
    from: (t: string) => { select: (cols: string) => BasicChain }
  }).from('agent_roles')
    .select('id,business_slug,role_title,parent_role_id,assigned_agent_slug,assigned_user_id,responsibilities,reports_to_summary,sort_order,created_at,updated_at') as BasicChain

  if (opts?.businessSlug !== undefined) {
    if (opts.businessSlug === null) chain = chain.is('business_slug', null)
    else                            chain = chain.eq('business_slug', opts.businessSlug)
  }

  const res = await chain.order('sort_order', { ascending: true })
  if (res.error) {
    if (isMissingTable(res.error.message)) {
      if (tableAvailable === null) {
        console.warn('[listRoles] agent_roles table missing — apply migration 057_agent_roles. Returning empty list.')
      }
      tableAvailable = false
      return []
    }
    console.warn('[listRoles] error:', res.error.message)
    return []
  }

  if (tableAvailable === null) tableAvailable = true
  return ((res.data ?? []) as AgentRole[]) || []
}

/**
 * Build a tree of roles. Multiple top-level roots are allowed
 * (e.g. CEO + a parallel "Advisor" role). Sort_order is honoured at each level.
 */
export function buildRoleTree(roles: AgentRole[]): RoleNode[] {
  const byId   = new Map<string, RoleNode>()
  const roots: RoleNode[] = []
  for (const r of roles) byId.set(r.id, { ...r, children: [] })
  for (const node of byId.values()) {
    if (node.parent_role_id && byId.has(node.parent_role_id)) {
      byId.get(node.parent_role_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortChildren = (n: RoleNode) => {
    n.children.sort((a, b) => a.sort_order - b.sort_order)
    n.children.forEach(sortChildren)
  }
  roots.sort((a, b) => a.sort_order - b.sort_order)
  roots.forEach(sortChildren)
  return roots
}

export async function getRoleTree(opts?: { businessSlug?: string | null }): Promise<RoleNode[]> {
  const roles = await listRoles(opts)
  return buildRoleTree(roles)
}

export interface UpsertRoleInput {
  id?:                   string
  business_slug?:        string | null
  role_title:            string
  parent_role_id?:       string | null
  assigned_agent_slug?:  string | null
  assigned_user_id?:     string | null
  responsibilities?:     string | null
  reports_to_summary?:   string | null
  sort_order?:           number
}

export async function upsertRole(input: UpsertRoleInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (tableAvailable === false) return { ok: false, error: 'agent_roles table missing — apply migration 057' }
  const db = createServerClient()
  if (!db) return { ok: false, error: 'database not configured' }

  if (input.assigned_agent_slug && input.assigned_user_id) {
    return { ok: false, error: 'single-assignee invariant — provide assigned_agent_slug OR assigned_user_id, not both' }
  }

  const row: Record<string, unknown> = {
    role_title:           input.role_title,
    business_slug:        input.business_slug ?? null,
    parent_role_id:       input.parent_role_id ?? null,
    assigned_agent_slug:  input.assigned_agent_slug ?? null,
    assigned_user_id:     input.assigned_user_id ?? null,
    responsibilities:     input.responsibilities ?? null,
    reports_to_summary:   input.reports_to_summary ?? null,
    sort_order:           input.sort_order ?? 0,
  }
  if (input.id) row.id = input.id

  const res = await ((db.from('agent_roles' as never) as unknown as {
    upsert: (r: Record<string, unknown>) => { select: (cols: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } }
  }).upsert(row).select('id').single())

  if (res.error) {
    if (isMissingTable(res.error.message)) {
      tableAvailable = false
      return { ok: false, error: 'agent_roles table missing — apply migration 057' }
    }
    return { ok: false, error: res.error.message }
  }
  return { ok: true, id: res.data!.id }
}

/**
 * Default role seed used by the empty-state CTA on /org. Conservative — one
 * CEO + three direct reports. The operator can edit/extend from the UI once
 * the seed lands.
 */
export const DEFAULT_ROLES: ReadonlyArray<Omit<UpsertRoleInput, 'id'>> = [
  { role_title: 'CEO',       sort_order: 0, responsibilities: 'Sets vision, allocates capital, owns final go/no-go on strategic moves.' },
  { role_title: 'CTO',       sort_order: 1, responsibilities: 'Owns codebase, infra, and platform reliability. Reports to CEO.', reports_to_summary: 'CEO' },
  { role_title: 'Engineer',  sort_order: 2, responsibilities: 'Implements features per the active task plan. Reports to CTO.', reports_to_summary: 'CTO' },
  { role_title: 'Designer',  sort_order: 3, responsibilities: 'Owns UI/UX, brand voice, frontend polish. Reports to CEO.', reports_to_summary: 'CEO' },
]

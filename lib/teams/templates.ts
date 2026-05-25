/**
 * lib/teams/templates.ts — save-as-template + spawn-from-template helpers.
 *
 * A template captures an org-chart arrangement as a portable blueprint:
 *   {
 *     teams: [
 *       { department, ecosystem_bindings, parent_idx | null },
 *       ...
 *     ]
 *   }
 *
 * `parent_idx` is an integer index into the teams array (so the blueprint
 * stays self-contained — no UUIDs that wouldn't survive a re-spawn).
 */

import { createServerClient } from '@/lib/supabase'
import { createTeam, listTeams, listTeamMembers, type TeamRow } from './store'
import { materialiseTeam } from './template'
import type { DepartmentSlug } from './departments'

export interface OrgTemplateRow {
  id:         string
  user_id:    string
  name:       string
  niche:      string | null
  blueprint:  TemplateBlueprint
  created_at: string
  updated_at: string
}

export interface TemplateBlueprint {
  teams: Array<{
    department:         string
    ecosystem_bindings: Record<string, string>
    parent_idx:         number | null
  }>
}

/**
 * Capture the current arrangement for ONE business as a template.
 * Walks teams of (userId, businessSlug), builds a parent_idx-encoded
 * blueprint, persists in org_templates.
 */
export async function captureTemplate(userId: string, businessSlug: string, name: string, niche: string | null): Promise<OrgTemplateRow | null> {
  const db = createServerClient()
  if (!db) return null
  const teams = (await listTeams(userId, businessSlug)).filter(t => t.status !== 'archived')
  if (teams.length === 0) return null
  // Stable ordering so the index is reproducible.
  teams.sort((a, b) => a.created_at.localeCompare(b.created_at))

  const idIndex = new Map<string, number>()
  teams.forEach((t, i) => idIndex.set(t.id, i))

  const blueprint: TemplateBlueprint = {
    teams: teams.map(t => ({
      department:         t.department_slug,
      ecosystem_bindings: t.ecosystem_bindings,
      parent_idx:         t.parent_team_id ? (idIndex.get(t.parent_team_id) ?? null) : null,
    })),
  }

  const row = { user_id: userId, name: name.slice(0, 120), niche, blueprint }
  const res = await (db.from('org_templates' as never) as unknown as {
    insert: (r: typeof row) => { select: () => { single: () => Promise<{ data: OrgTemplateRow | null }> } }
  }).insert(row).select().single()
  return res.data ?? null
}

export async function listTemplates(userId: string): Promise<OrgTemplateRow[]> {
  const db = createServerClient()
  if (!db) return []
  type Chain<T> = { eq: (c: string, v: string) => Chain<T>; order: (c: string, opts: { ascending: boolean }) => Chain<T>; limit: (n: number) => Promise<{ data: T[] | null }> }
  const res = await (db.from('org_templates' as never) as unknown as { select: (c: string) => Chain<OrgTemplateRow> })
    .select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100)
  return res.data ?? []
}

export async function getTemplate(userId: string, templateId: string): Promise<OrgTemplateRow | null> {
  const db = createServerClient()
  if (!db) return null
  type Chain<T> = { eq: (c: string, v: string) => Chain<T>; single: () => Promise<{ data: T | null }> }
  const res = await (db.from('org_templates' as never) as unknown as { select: (c: string) => Chain<OrgTemplateRow> })
    .select('*').eq('id', templateId).eq('user_id', userId).single()
  return res.data ?? null
}

/**
 * Spawn every team in the template's blueprint against `businessSlug`.
 * Two passes:
 *   1. Spawn each team (materialise + insert)
 *   2. Re-link parent_team_id using parent_idx + the newly-issued ids
 *
 * Returns the list of newly-created TeamRow.
 */
export async function spawnFromTemplate(userId: string, templateId: string, businessSlug: string, niche: string | null): Promise<TeamRow[]> {
  const tmpl = await getTemplate(userId, templateId)
  if (!tmpl) return []

  const newTeams: TeamRow[] = []
  // Pass 1: spawn each.
  for (const spec of tmpl.blueprint.teams) {
    const mat = materialiseTeam({
      userId,
      businessSlug,
      departmentSlug:     spec.department as DepartmentSlug,
      niche,
      ecosystemOverrides: spec.ecosystem_bindings,
    })
    if (!mat.ok || !mat.payload) continue
    const team = await createTeam(mat.payload)
    if (team) newTeams.push(team)
    else      newTeams.push(null as unknown as TeamRow)  // placeholder so indices stay aligned for pass 2
  }

  // Pass 2: assign parents.
  const db = createServerClient()
  if (db) {
    for (let i = 0; i < tmpl.blueprint.teams.length; i++) {
      const spec = tmpl.blueprint.teams[i]
      const self = newTeams[i]
      if (!self || spec.parent_idx === null || spec.parent_idx === undefined) continue
      const parent = newTeams[spec.parent_idx]
      if (!parent) continue
      await (db.from('teams' as never) as unknown as {
        update: (u: Record<string, unknown>) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ error?: unknown }> } }
      }).update({ parent_team_id: parent.id, template_id: tmpl.id })
       .eq('id', self.id).eq('user_id', userId)
    }
  }

  return newTeams.filter((t): t is TeamRow => t !== null)
}

/** Unused-member-list helper — listTeamMembers is re-exported so the
 *  API route doesn't need to import from both places. */
export { listTeamMembers }

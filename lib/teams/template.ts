/**
 * lib/teams/template.ts — materialise a department roster for a business.
 *
 * Called by /api/teams/spawn. Given (userId, businessSlug, deptSlug, niche)
 * it picks the right default ecosystem bindings, builds the member list
 * from the department's role registry, and returns a fully-populated
 * CreateTeamInput ready to insert via lib/teams/store.ts.
 */

import type { CreateTeamInput } from './store'
import { getDepartment, type DepartmentSlug } from './departments'
import { defaultBindingsFor } from './default-bindings'

export interface MaterialiseInput {
  userId:        string
  businessSlug:  string | null
  departmentSlug: DepartmentSlug
  niche?:        string | null
  /** Operator-supplied override that wins over the niche/default chain. */
  ecosystemOverrides?: Record<string, string>
}

export interface MaterialiseResult {
  ok:     boolean
  reason?: string
  payload?: CreateTeamInput
}

/** Build the agent-spec path convention used across all departments. The
 *  spawn route uses this when wiring per-business container mounts. */
function agentSpecPath(dept: DepartmentSlug, role: string): string {
  return `.claude/agents/departments/${dept}/${role}.md`
}

/** Default tool budget for a role — the registry enforces ≥ 2 entries
 *  per the AGENTS.md tool-budget rule. v1 hands every role the
 *  ecosystem-as-tool list; later versions can refine per-role. */
function defaultToolBudget(bindings: Record<string, string>): string[] {
  const tools = Object.values(bindings)
  // The ≥ 2 invariant: if a dept only binds one ecosystem (executive does
  // exactly this — just `llm`), pad with `memory-hq` so the runtime can
  // always do at least one knowledge-lookup.
  if (tools.length < 2) tools.push('memory-hq')
  return tools
}

export function materialiseTeam(input: MaterialiseInput): MaterialiseResult {
  const dept = getDepartment(input.departmentSlug)
  if (!dept) return { ok: false, reason: `unknown department: ${input.departmentSlug}` }

  // 1. Compute the binding map for the dept's ecosystem kinds.
  const baseBindings = defaultBindingsFor(dept.slug, input.niche ?? null, dept.defaultEcosystemKinds)
  const bindings    = { ...baseBindings, ...(input.ecosystemOverrides ?? {}) }

  // 2. Build member list — one per role in the dept's roster.
  const members = dept.roles.map(roleSlug => ({
    roleSlug,
    agentSpecPath: agentSpecPath(dept.slug, roleSlug),
    toolBudget:    defaultToolBudget(bindings),
  }))

  return {
    ok: true,
    payload: {
      userId:            input.userId,
      businessSlug:      input.businessSlug,
      departmentSlug:    dept.slug,
      ecosystemBindings: bindings,
      members,
    },
  }
}

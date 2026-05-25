/**
 * lib/teams/departments.ts — starter registry of the 7 default departments.
 *
 * A department is a named bundle of (purpose, roles, default ecosystem set,
 * approval gates). A "team" is a department instantiated for a business —
 * stored in the `teams` table.
 *
 * See task_plan-departments-and-ecosystems.md for the full architecture,
 * the future "custom departments" plan, and how this registry interacts
 * with the ecosystem adapter layer.
 */

import type { EcosystemKind } from '@/lib/ecosystems/types'

export type DepartmentSlug =
  | 'executive'
  | 'engineering'
  | 'design'
  | 'content'
  | 'sales-cs'
  | 'operations'
  | 'research'

export interface DepartmentDefinition {
  slug:          DepartmentSlug
  label:         string
  purpose:       string
  /** Slugs of the role specs under .claude/agents/departments/<slug>/. The
   *  spawn route inserts one `team_members` row per entry. */
  roles:         readonly string[]
  /** Which ecosystem kinds this dept routinely calls. Used by the spawn
   *  route to pre-pick adapters from `lib/teams/default-bindings.ts`. */
  defaultEcosystemKinds: readonly EcosystemKind[]
  /** Approval gate enums this dept owns. The Board surface badges any
   *  pending approval with its dept of origin. */
  approvalGates: readonly string[]
  /** When true, the dept appears in the "minimum viable business" preset
   *  on the /teams spawn screen — operator can one-click create the
   *  smallest workable org. */
  inMinimum:     boolean
}

export const DEPARTMENTS: Readonly<Record<DepartmentSlug, DepartmentDefinition>> = {
  executive: {
    slug:                  'executive',
    label:                 'Executive',
    purpose:               'Set direction, pivot, own KPIs. Routes high-leverage requests to the right operational dept.',
    roles:                 ['strategist', 'decision-maker', 'board-secretary'],
    defaultEcosystemKinds: ['llm', 'memory'],
    approvalGates:         ['pivot', 'pricing_change', 'niche_pick'],
    inMinimum:             true,
  },
  engineering: {
    slug:                  'engineering',
    label:                 'Engineering',
    purpose:               'Build the product / service. PRs, reviews, deploys, on-call.',
    roles:                 ['architect', 'builder', 'reviewer', 'tester', 'deployer', 'oncall'],
    defaultEcosystemKinds: ['code', 'llm', 'memory', 'search'],
    approvalGates:         ['merge_to_main', 'deploy_to_prod', 'add_dependency'],
    inMinimum:             false,
  },
  design: {
    slug:                  'design',
    label:                 'Design',
    purpose:               'Visual identity, UI/UX, brand. Lives off persistent brand-as-memory entities.',
    roles:                 ['brand-strategist', 'system-builder', 'layout-architect', 'visual-renderer', 'critic', 'publisher'],
    defaultEcosystemKinds: ['design', 'image', 'llm'],
    approvalGates:         ['design_brand_direction', 'design_publish'],
    inMinimum:             false,
  },
  content: {
    slug:                  'content',
    label:                 'Content',
    purpose:               'Trend → concept → script → render → edit → publish → perf-analyse.',
    roles:                 ['trend-scout', 'concept-writer', 'script-writer', 'asset-builder', 'edit-publisher', 'perf-analyst'],
    defaultEcosystemKinds: ['video', 'image', 'voice', 'music', 'llm', 'search'],
    approvalGates:         ['content_concept', 'content_publish', 'content_creative_brief_change'],
    inMinimum:             true,
  },
  'sales-cs': {
    slug:                  'sales-cs',
    label:                 'Sales & CS',
    purpose:               'Lead → outreach → close → onboard → retain → support.',
    roles:                 ['lead-scorer', 'outreach-writer', 'scheduler', 'account-manager', 'support'],
    defaultEcosystemKinds: ['voice-agent', 'llm', 'search'],
    approvalGates:         ['outbound_campaign_start', 'refund_above_threshold'],
    inMinimum:             false,
  },
  operations: {
    slug:                  'operations',
    label:                 'Operations',
    purpose:               'Finance, compliance, infra health, secret rotation.',
    roles:                 ['accountant', 'compliance-checker', 'infra-monitor', 'secret-rotator'],
    defaultEcosystemKinds: ['workflow', 'llm'],
    approvalGates:         ['secret_rotation', 'infra_resize'],
    inMinimum:             true,
  },
  research: {
    slug:                  'research',
    label:                 'Research',
    purpose:               'Competitive intel, customer research, market sensing. Feeds Executive.',
    roles:                 ['scout', 'analyst', 'summariser'],
    defaultEcosystemKinds: ['search', 'llm', 'memory'],
    approvalGates:         [],
    inMinimum:             false,
  },
}

/** Ordered list (useful for UI rendering — keeps the spawn-screen consistent). */
export const DEPARTMENT_ORDER: readonly DepartmentSlug[] = [
  'executive',
  'engineering',
  'design',
  'content',
  'sales-cs',
  'operations',
  'research',
]

/** Lookup helper with a stable null for unknown slugs (custom departments
 *  shipped via the future plan use a separate query path). */
export function getDepartment(slug: string): DepartmentDefinition | null {
  return (DEPARTMENTS as Record<string, DepartmentDefinition>)[slug] ?? null
}

/** Convenience for the "minimum viable business" CTA on /teams. */
export function minimumDepartments(): readonly DepartmentDefinition[] {
  return DEPARTMENT_ORDER.map(slug => DEPARTMENTS[slug]).filter(d => d.inMinimum)
}

/**
 * getIssueAncestry + renderAncestryPrompt — Paperclip absorption Task 4d.
 *
 * Walks the full "why" chain for an issue (issue → parent issues → goal →
 * parent goals → business) in one round trip via the stored function from
 * migration 052_goal_ancestry_fn.sql.
 *
 * The renderAncestryPrompt helper formats the chain as a markdown block
 * suitable for injection at the top of an agent's dispatch prompt — matches
 * the example in Paperclip's PRODUCT.md:
 *
 *   I am researching X (current task)
 *     because → I need to do Y (parent)
 *       because → I need to grow Z (parent)
 *         ... → company mission
 *
 * Fail-soft: missing function returns null; renderAncestryPrompt(null) is
 * the empty string so the prompt still composes cleanly.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

interface IssueNode {
  id: string
  title: string
  status_category?: string | null
}

interface GoalNode {
  id: string
  title: string
  status?: string | null
}

interface BusinessNode {
  slug:    string
  name:    string
  niche?:  string | null
  mission?: string | null
}

export interface Ancestry {
  issue:         IssueNode & { goal_id?: string | null; parent_id?: string | null }
  parent_issues: IssueNode[]      // closest parent first
  goal:          GoalNode | null
  parent_goals:  GoalNode[]
  business:      BusinessNode
}

let ancestryFnAvailable: boolean | null = null

function isMissingFunction(message: string): boolean {
  if (!message) return false
  return /(function .*get_issue_ancestry.*does not exist|Could not find the function .*get_issue_ancestry)/i.test(message)
}

export async function getIssueAncestry(
  db: SupabaseClient<Database>,
  issueId: string,
): Promise<Ancestry | null> {
  if (ancestryFnAvailable === false) return null

  const rpc = (db as unknown as {
    rpc: (
      fn: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: Ancestry | null; error: { message: string } | null }>
  }).rpc

  const res = await rpc('get_issue_ancestry', { p_issue_id: issueId })
  if (res.error) {
    if (isMissingFunction(res.error.message)) {
      if (ancestryFnAvailable === null) {
        console.warn(
          '[getIssueAncestry] get_issue_ancestry function missing — apply migration 052_goal_ancestry_fn. Returning null.',
        )
      }
      ancestryFnAvailable = false
      return null
    }
    console.warn('[getIssueAncestry] error:', res.error.message)
    return null
  }

  if (ancestryFnAvailable === null) ancestryFnAvailable = true
  return res.data ?? null
}

/**
 * Render an ancestry block as markdown for injection into an agent prompt.
 * Empty string when ancestry is null so the prompt still composes cleanly.
 */
export function renderAncestryPrompt(a: Ancestry | null): string {
  if (!a) return ''

  const lines: string[] = []
  lines.push('## Ancestry — why this work matters')
  lines.push('')

  // Issue + parent issue chain, indented
  lines.push(`- **${a.issue.title}** (this issue)`)
  let indent = '  '
  for (const p of a.parent_issues) {
    lines.push(`${indent}↳ part of: **${p.title}**`)
    indent += '  '
  }

  // Goal chain
  if (a.goal) {
    lines.push(`${indent}↳ serves goal: **${a.goal.title}**`)
    indent += '  '
    for (const pg of a.parent_goals) {
      lines.push(`${indent}↳ serves: **${pg.title}**`)
      indent += '  '
    }
  }

  // Business mission
  lines.push(`${indent}↳ for business: **${a.business.name}** (${a.business.niche ?? 'no niche'})`)
  if (a.business.mission) {
    lines.push(`${indent}  mission: ${a.business.mission}`)
  }
  lines.push('')
  return lines.join('\n')
}

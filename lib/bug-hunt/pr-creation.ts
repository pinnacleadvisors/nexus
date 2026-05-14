/**
 * lib/bug-hunt/pr-creation.ts — helpers for the bug-hunt-loop agent's
 * draft-PR-opening flow (Phase B7).
 *
 * The agent calls these from inside its turn (via Bash / Edit tools or
 * via the mcp-composio-admin wrapper). This module's job is to provide:
 *
 *   1. A stable branch-name shape so PRs can be cross-referenced to the
 *      bug-hunt session + iteration + finding that produced them.
 *   2. A PR-body template that captures the iteration context for the
 *      operator's reviewer eye.
 *   3. A LOC-counting helper so the agent can self-check "is my diff
 *      under 50 LOC — am I allowed to open a PR, or does this need to
 *      route to manual-task instead?"
 *
 * The agent does NOT use this module's functions directly — it imports
 * the formats for its prompt. The runtime PR-opening is via Composio
 * (GITHUB_CREATE_A_BRANCH, GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS,
 * GITHUB_CREATE_A_PULL_REQUEST). This module exists for the Nexus-side
 * code that displays / cross-references those PRs.
 */

export const MAX_AUTOFIX_LOC = 50

export interface BranchNameInput {
  sessionId:  string         // 'bh-2026-05-15-admin-001'
  iteration:  number
  shortSlug:  string         // kebab-case description of the fix
}

export function branchName(input: BranchNameInput): string {
  const slug = input.shortSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `fix/bug-hunt-${input.sessionId}-i${input.iteration}-${slug}`
}

export interface PrBodyInput {
  sessionId:    string
  iteration:    number
  finding: {
    title:        string
    detail?:      string | null
    source_path?: string | null
    severity:     string
    category:     string
  }
  /** Total net-new + changed lines across all files in the diff. */
  locDelta?:    number
}

/**
 * Markdown body for a bug-hunt PR. Includes back-references the operator
 * needs to triage the PR in the Bug-hunt panel.
 */
export function prBody(input: PrBodyInput): string {
  const { sessionId, iteration, finding, locDelta } = input
  const lines: Array<string | null> = [
    '## Bug-hunt finding',
    '',
    `**Severity**: \`${finding.severity}\`  **Category**: \`${finding.category}\``,
    finding.source_path ? `**Source**: \`${finding.source_path}\`` : null,
    '',
    finding.detail ?? '_No additional detail provided by the audit._',
    '',
    '## Provenance',
    '',
    `- Bug-hunt session: \`${sessionId}\``,
    `- Iteration: ${iteration}`,
    locDelta != null ? `- Diff size: ${locDelta} LOC (cap is ${MAX_AUTOFIX_LOC})` : null,
    '- Opened by: `bug-hunt-loop` agent via `mcp-composio-admin`',
    '',
    '## Review checklist',
    '',
    '- [ ] Fix actually addresses the finding',
    '- [ ] No unrelated changes',
    '- [ ] Tests / typecheck would pass',
    '- [ ] No security implications I missed',
    '',
    '> This PR was opened as a **draft** by the bug-hunt-loop agent.',
    '> The agent CANNOT merge — manual review and merge are required.',
    '> Marking this PR closed will update the finding to `wont-fix`.',
    '',
  ]
  return lines.filter((l): l is string => l !== null).join('\n')
}

export function prTitle(input: { finding: { title: string }; sessionId: string }): string {
  // Cap title at 70 chars — GitHub's recommendation.
  const titlePart = input.finding.title.slice(0, 50).replace(/\s+$/, '')
  return `bug-hunt(${input.sessionId}): ${titlePart}`.slice(0, 70)
}

/** Returns true if a diff is too large for autofix — agent should
 *  abandon the PR path and emit a `manual-task` block instead. */
export function exceedsAutofixCap(locDelta: number): boolean {
  return locDelta > MAX_AUTOFIX_LOC
}

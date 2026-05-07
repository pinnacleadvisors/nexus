/**
 * Workflow test runner — combines structural validation with an optional
 * n8n "schema dry-run" (create + immediately delete to confirm n8n itself
 * accepts the schema beyond what our static validator can see).
 *
 * The n8n public REST API does not expose ad-hoc test execution with mock
 * inputs (that's an internal-API feature). This is the most we can verify
 * server-side without the Strategist's MCP session.
 *
 * Used by:
 *   - /api/n8n/debug — runs this after each debugger pass to decide whether
 *     to loop again or accept the patched workflow
 *   - lib/n8n/finalize.ts — already runs validateWorkflow inline; this is
 *     the heavier check the debug endpoint uses
 */

import type { N8nWorkflow } from './types'
import { validateWorkflow } from './validate'
import { createWorkflow, deleteWorkflow, isConfigured } from './client'

export interface TestResult {
  ok:       boolean
  /** Static validation phase. */
  structural: { ok: boolean; errors: string[]; warnings: string[] }
  /** n8n schema phase — only attempted when n8n is configured AND structural passes. */
  schema?:  { ok: boolean; error?: string; createdAndDeleted?: boolean }
  /** True iff caller should attempt a debugger pass. */
  shouldDebug: boolean
}

/**
 * Run static validation first (cheap, deterministic). If it fails, return
 * immediately — the schema check is more expensive and would just surface
 * the same errors. Otherwise create+delete the workflow against the live
 * n8n API to flush out node-type / parameter mismatches our static check
 * doesn't know about.
 */
export async function runWorkflowTest(workflow: N8nWorkflow): Promise<TestResult> {
  const structural = validateWorkflow(workflow)

  if (!structural.ok) {
    return {
      ok:          false,
      structural:  { ok: false, errors: structural.errors, warnings: structural.warnings },
      shouldDebug: true,
    }
  }

  if (!isConfigured()) {
    // Static-only — return structural pass without a schema verdict.
    return {
      ok:          true,
      structural:  { ok: true, errors: [], warnings: structural.warnings },
      shouldDebug: false,
    }
  }

  // Schema dry-run: create with active=false, then delete. n8n's POST returns
  // 4xx with the actual schema error if the workflow doesn't conform.
  let createdId: string | undefined
  try {
    const created = await createWorkflow({ ...workflow, active: false })
    createdId = created.id
  } catch (err) {
    return {
      ok:           false,
      structural:   { ok: true, errors: [], warnings: structural.warnings },
      schema:       { ok: false, error: err instanceof Error ? err.message : 'n8n create failed' },
      shouldDebug:  true,
    }
  }

  // Cleanup — best effort; if it fails the workflow stays in n8n as inactive
  // and a human can clean up. We don't error the caller for the cleanup.
  if (createdId) {
    try { await deleteWorkflow(createdId) } catch { /* leave behind */ }
  }

  return {
    ok:          true,
    structural:  { ok: true, errors: [], warnings: structural.warnings },
    schema:      { ok: true, createdAndDeleted: Boolean(createdId) },
    shouldDebug: false,
  }
}

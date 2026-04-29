/**
 * Post-AI finalisation pipeline for /api/n8n/generate.
 *
 * Both the synchronous POST path AND the async GET-status path need to do the
 * same work after they have AI text in hand:
 *   1. Parse the workflow JSON (or build a deterministic scaffold if invalid).
 *   2. Inject runId into every dispatch-node body.
 *   3. Run gap analysis (which steps need OpenClaw browser automation).
 *   4. Optionally write the workflow into the live n8n instance.
 *   5. Persist a SavedAutomation row.
 *   6. Insert a Board card.
 *   7. Build the final response payload.
 *
 * This module owns step 1–7. The route handlers feed it `aiText` (or null when
 * the AI failed) and the original request body.
 */
import { createWorkflow, getBaseUrl, isConfigured as isN8nConfigured } from './client'
import { analyzeWorkflow } from './gap-detector'
import type { N8nWorkflow } from './types'
import { parseGeneratedOutput } from './parse-output'
import { buildFallbackWorkflow } from './scaffold'
import { createServerClient } from '@/lib/supabase'
import { automationToRow, rowToAutomation, type AutomationRow } from '@/lib/idea-db'
import type { SavedAutomation } from '@/lib/types'

export interface GenerateBody {
  description:           string
  businessContext?:      string
  templateId?:           string
  projectId?:            string
  ideaId?:               string
  workflowType?:         'build' | 'maintain'
  availableCapabilities?: string[]
  steps?:                { title: string; automatable: boolean; phase?: 'build' | 'maintain'; tools?: string[] }[]
  tools?:                { name: string; purpose?: string }[]
  howItMakesMoney?:      string
  /** A5 — persistent Run id; threaded into every dispatch node so run_events attribute. */
  runId?:                string
}

export interface FinalisedResponse {
  workflow:       N8nWorkflow
  workflowType:   'build' | 'maintain'
  checklist:      string[]
  explanation:    string
  importUrl?:     string
  importedId?:    string
  importError?:   string
  gapAnalysis:    ReturnType<typeof analyzeWorkflow>
  automation?:    SavedAutomation
  fallbackUsed:   boolean
  fallbackReason?: string
  aiRaw?:         string
}

export interface FinaliseArgs {
  /** AI-generated text or null when no provider returned anything. */
  aiText:        string | null
  body:          GenerateBody
  /** Clerk user id — required to persist a SavedAutomation row. */
  clerkUserId?:  string | null
  /** Available capability IDs (already validated upstream). */
  capabilityIds: string[]
  /** Pre-existing failure reason from the upstream call (gateway error, AI error). */
  fallbackReason?: string
}

export async function finaliseGeneration(args: FinaliseArgs): Promise<FinalisedResponse> {
  const { aiText, body, clerkUserId, capabilityIds } = args
  const workflowType = body.workflowType ?? 'build'

  // 1. Parse (or scaffold)
  let workflow:    N8nWorkflow | null = null
  let checklist:   string[] = []
  let explanation  = ''
  let fallbackUsed = false
  let fallbackReason = args.fallbackReason
  let aiRaw: string | undefined

  if (aiText) {
    aiRaw = aiText
    const parsed = parseGeneratedOutput(aiText)
    if (parsed.workflow) {
      workflow    = parsed.workflow
      checklist   = parsed.checklist
      explanation = parsed.explanation
    } else {
      fallbackUsed   = true
      fallbackReason = fallbackReason ?? 'Failed to parse workflow JSON from AI response'
    }
  } else {
    fallbackUsed   = true
    fallbackReason = fallbackReason ?? 'No Claude provider available'
  }

  if (!workflow) {
    const scaffold = buildFallbackWorkflow({
      description:     body.description,
      workflowType,
      steps:           body.steps,
      tools:           body.tools,
      howItMakesMoney: body.howItMakesMoney,
      capabilityIds,
      runId:           body.runId,
    })
    workflow    = scaffold.workflow
    checklist   = scaffold.checklist
    explanation = [
      scaffold.explanation,
      fallbackReason ? `\nFallback reason: ${fallbackReason}` : '',
    ].filter(Boolean).join('')
  }

  // 2. Inject runId into dispatch-node bodies (belt-and-braces — scaffold
  //    already does this; AI-generated workflows might not).
  if (body.runId && workflow.nodes) {
    for (const node of workflow.nodes) {
      const params = node.parameters as Record<string, unknown> | undefined
      const url    = params?.url
      if (typeof url !== 'string' || !url.includes('/api/claude-session/dispatch')) continue
      const rawBody = params?.jsonBody
      if (typeof rawBody !== 'string') continue
      try {
        const parsed = JSON.parse(rawBody) as Record<string, unknown>
        if (!parsed.runId) parsed.runId = body.runId
        ;(params as Record<string, unknown>).jsonBody = JSON.stringify(parsed, null, 2)
      } catch {
        // Non-JSON body — leave as-is.
      }
    }
  }

  // 3. Gap analysis
  const gapAnalysis = analyzeWorkflow(workflow)

  // 4. Live n8n write
  let importedId:  string | undefined
  let importError: string | undefined
  if (isN8nConfigured()) {
    try {
      const created = await createWorkflow(workflow)
      importedId = created.id
    } catch (err) {
      importError = err instanceof Error ? err.message : 'n8n write failed'
    }
  } else {
    importError = 'N8N_BASE_URL / N8N_API_KEY not configured'
  }

  // 5. Board card (fire-and-forget)
  const db = createServerClient()
  if (db) {
    await (db as ReturnType<typeof createServerClient> & { from: Function })
      .from('tasks')
      .insert({
        title:       `[n8n ${workflowType}] ${workflow.name}`,
        description: `${explanation}\n\nSetup checklist:\n${checklist.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
        column_id:   'backlog',
        priority:    'medium',
        project_id:  body.projectId ?? null,
        position:    0,
      })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error('[n8n/generate] board card:', error.message)
      })
  }

  // 6. Persist SavedAutomation
  let savedAutomation: SavedAutomation | undefined
  if (clerkUserId && db) {
    const draft: Omit<SavedAutomation, 'id' | 'createdAt'> = {
      ideaId:       body.ideaId,
      name:         workflow.name ?? `${workflowType === 'build' ? 'Build' : 'Maintain & Profit'}: ${body.description.slice(0, 40)}`,
      workflowType,
      workflowJson: JSON.stringify(workflow, null, 2),
      checklist,
      explanation,
      importedId,
      importError,
    }
    const { data, error } = await db
      .from('automations')
      .insert(automationToRow(draft, clerkUserId) as never)
      .select()
      .single()
    if (!error && data) {
      savedAutomation = rowToAutomation(data as unknown as AutomationRow)
    } else if (error) {
      console.error('[n8n/generate] persist failed:', error.message)
    }
  }

  // 7. Build importUrl
  const n8nBase   = getBaseUrl()
  const importUrl = importedId && n8nBase
    ? `${n8nBase}/workflow/${importedId}`
    : n8nBase
      ? `${n8nBase}/workflow/new?workflow=${encodeURIComponent(JSON.stringify(workflow))}`
      : undefined

  return {
    workflow,
    workflowType,
    checklist,
    explanation,
    importUrl,
    importedId,
    importError,
    gapAnalysis,
    automation:    savedAutomation,
    fallbackUsed,
    fallbackReason,
    aiRaw:         fallbackUsed ? aiRaw : undefined,
  }
}

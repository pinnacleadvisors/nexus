/**
 * POST /api/n8n/generate
 *
 * Generates a valid n8n v1 workflow using Claude as the architect. Now supports
 * two workflow shapes per idea:
 *   - workflowType: 'build'    — one-shot pipeline that stands the project up
 *   - workflowType: 'maintain' — recurring pipeline that runs the project &
 *                                generates profit after launch
 *
 * Nodes the system prompt will use:
 *   - Claude Opus "mastermind" node (httpRequest → /api/chat) for orchestration
 *   - Claude managed-agent nodes (httpRequest → /api/agent) for complex tasks
 *     tied to a specific capability (research, content, code, seo, social, …)
 *   - Manual trigger nodes for side-effects the owner must do themselves
 *     (create API key, sign up for a service, authenticate social account)
 *   - Evaluation / review nodes at every significant milestone
 *     (website live → review, first 3 posts scheduled → review, revenue check → review)
 *
 * Body:
 *   {
 *     description:     string
 *     businessContext?: string
 *     templateId?:     string
 *     projectId?:      string
 *     workflowType?:   'build' | 'maintain'   — default 'build'
 *     availableCapabilities?: string[]        — defaults to full list
 *   }
 *
 * Response:
 *   {
 *     workflow:      N8nWorkflow
 *     workflowType:  'build' | 'maintain'
 *     checklist:     string[]
 *     explanation:   string
 *     importUrl?:    string
 *     importedId?:   string    — present when the workflow was written to n8n via API
 *     importError?:  string    — present when the API write failed
 *     gapAnalysis?:  object
 *   }
 */

import { NextRequest } from 'next/server'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { audit } from '@/lib/audit'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getTemplate } from '@/lib/n8n/templates'
import { getBaseUrl, isConfigured as isN8nConfigured, createWorkflow } from '@/lib/n8n/client'
import { analyzeWorkflow } from '@/lib/n8n/gap-detector'
import { AGENT_CAPABILITIES } from '@/lib/agent-capabilities'
import { automationToRow, rowToAutomation, type AutomationRow } from '@/lib/idea-db'
import type { N8nWorkflow } from '@/lib/n8n/types'
import type { SavedAutomation } from '@/lib/types'

export const maxDuration = 90
export const runtime = 'nodejs'

// ── System prompts, keyed by workflow type ────────────────────────────────────
const SHARED_RULES = `Output format:
1. Output ONLY valid JSON for the workflow object — no markdown fences, no preamble before or after.
2. Use n8n v1 shape: { "name": string, "nodes": [...], "connections": { ... }, "active": false, "settings": { "executionOrder": "v1" }, "tags": ["nexus"] }
3. Every node needs: id (unique string), name (unique — used as connection key), type, typeVersion, position ([x,y] spaced 240 px apart horizontally and 200 px vertically for branches), parameters.
4. connections format: { "NodeName": { "main": [[{ "node": "NextNode", "type": "main", "index": 0 }]] } }
5. After the workflow JSON, on a new line write "---CHECKLIST---" followed by a numbered setup checklist (6–12 steps).
6. After the checklist, on a new line write "---EXPLANATION---" followed by a 2–3 sentence plain-English explanation.

Node palette you MUST use:
- Mastermind orchestrator (one per workflow, runs first after trigger):
    type:        "n8n-nodes-base.httpRequest"
    typeVersion: 4
    parameters: {
      method: "POST",
      url: "={{$vars.NEXUS_BASE_URL}}/api/chat",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      bodyContentType: "json",
      jsonBody: "={\\"model\\":\\"claude-opus-4-6\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"<task prompt referencing $json fields>\\"}]}"
    }
- Claude managed-agent node — use n8n-nodes-base.httpRequest pointing at {{$vars.NEXUS_BASE_URL}}/api/agent with body { "capabilityId": "<ONE OF: CAPABILITY_IDS>", "inputs": { ... } }. Each managed-agent node MUST be named "Agent: <capabilityId>" so the owner can recognise it.
- Evaluation / review node at each significant milestone — use n8n-nodes-base.manualTrigger (typeVersion 1) named "Review: <milestone>" with parameters.notes explaining what to verify.
- Manual-action node for side-effects the owner must do themselves (create API key, set up account, authenticate social, fund Stripe) — use n8n-nodes-base.manualTrigger named "Manual: <what the owner must do>" with parameters.notes spelling out the steps.
- Other nodes allowed: n8n-nodes-base.scheduleTrigger (typeVersion 1), n8n-nodes-base.webhook, n8n-nodes-base.set, n8n-nodes-base.code, n8n-nodes-base.wait, n8n-nodes-base.notion, n8n-nodes-base.slack, n8n-nodes-base.gmail, n8n-nodes-base.stripe.

Hard rules:
- Reference env vars as ={{$vars.VAR_NAME}}. Common ones: NEXUS_BASE_URL, NEXUS_API_KEY, ANTHROPIC_API_KEY, NOTION_TOKEN.
- Every side-effect the owner must do MUST be its own "Manual: ..." node with clear notes.
- Every workflow MUST include at least one "Review: ..." evaluation node before the final step.
- The mastermind runs first after the trigger and delegates to managed-agent nodes via downstream connections.
- Keep workflows focused — 8–14 nodes is ideal. Do not exceed 16 nodes.`

function buildSystemPrompt(workflowType: 'build' | 'maintain', capabilityIds: string[]): string {
  const intro = workflowType === 'build'
    ? `You are an expert n8n workflow architect. You design a BUILD workflow: a one-shot pipeline that stands the user's project up from nothing. It runs once when triggered, completes milestone-by-milestone (scaffold → domain → site → content → launch), pauses at Review nodes after each milestone, and prompts the owner via Manual nodes for any side-effects (buying a domain, creating social accounts, adding API keys). Use the mastermind orchestrator to plan the sequence and delegate to managed-agent nodes.`
    : `You are an expert n8n workflow architect. You design a MAINTAIN & PROFIT workflow: a recurring pipeline that runs AFTER the project is launched. It fires on a schedule (scheduleTrigger, typically daily or weekly), uses the mastermind orchestrator to decide what to do that cycle, delegates content/marketing/ops to managed-agent nodes, pauses at Review nodes whenever it publishes or spends money, and only uses Manual nodes for auth refresh / emergency interventions. Focus on the activities that actually generate revenue: content publishing, audience engagement, paid promotion, affiliate link rotation, A/B experiment analysis.`

  return `${intro}\n\n${SHARED_RULES}\n\nCAPABILITY_IDS (pick the right one per Agent node): ${capabilityIds.join(', ')}`
}

// ── JSON + checklist parser ───────────────────────────────────────────────────
interface ParsedOutput {
  workflow:    N8nWorkflow | null
  checklist:   string[]
  explanation: string
}

function parseGeneratedOutput(text: string): ParsedOutput {
  const checklistSep   = text.indexOf('---CHECKLIST---')
  const explanationSep = text.indexOf('---EXPLANATION---')

  const jsonPart  = checklistSep > 0 ? text.slice(0, checklistSep).trim() : text
  const clPart    = checklistSep > 0 && explanationSep > 0
    ? text.slice(checklistSep + 15, explanationSep).trim()
    : ''
  const exPart    = explanationSep > 0
    ? text.slice(explanationSep + 17).trim()
    : ''

  let workflow: N8nWorkflow | null = null
  try {
    workflow = JSON.parse(jsonPart) as N8nWorkflow
  } catch {
    const match = jsonPart.match(/\{[\s\S]*\}/)
    if (match) {
      try { workflow = JSON.parse(match[0]) as N8nWorkflow } catch { /* ignore */ }
    }
  }

  const checklist = clPart
    .split('\n')
    .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter(Boolean)

  return { workflow, checklist, explanation: exPart }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 5, window: '1 m', prefix: 'n8n-gen' })
  if (!rl.success) return rateLimitResponse(rl)

  const body = await req.json() as {
    description:     string
    businessContext?: string
    templateId?:     string
    projectId?:      string
    ideaId?:         string
    workflowType?:   'build' | 'maintain'
    availableCapabilities?: string[]
  }

  if (!body.description?.trim()) {
    return Response.json({ error: 'description is required' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })
  }

  const workflowType = body.workflowType ?? 'build'
  const capabilityIds = (body.availableCapabilities?.length
    ? body.availableCapabilities
    : AGENT_CAPABILITIES.map(c => c.id))

  const baseTemplate = body.templateId ? getTemplate(body.templateId) : undefined
  const userPrompt = [
    `Workflow type: ${workflowType.toUpperCase()}`,
    '',
    `Create an n8n workflow that does the following:`,
    body.description.trim(),
    body.businessContext?.trim()
      ? `\nBusiness context:\n${body.businessContext.trim()}`
      : '',
    baseTemplate
      ? `\nBase it on this template structure (adapt as needed): ${baseTemplate.name} — ${baseTemplate.description}`
      : '',
    workflowType === 'build'
      ? `\nEmphasise: clear milestone sequence, Review node after every milestone, Manual nodes for every owner side-effect. Mastermind should read the idea description and plan each milestone before delegating.`
      : `\nEmphasise: scheduleTrigger cadence, content/marketing cadence, profit instrumentation, Review nodes before anything is published or spent, managed-agent nodes for research/content/seo/social.`,
  ].filter(Boolean).join('\n')

  audit(req, {
    action:     'n8n.generate',
    resource:   'workflow',
    resourceId: workflowType,
    metadata:   { description: body.description.slice(0, 100), workflowType },
  })

  const { text } = await generateText({
    model:           anthropic('claude-sonnet-4-6'),
    system:          buildSystemPrompt(workflowType, capabilityIds),
    messages:        [{ role: 'user', content: userPrompt }],
    maxOutputTokens: 4000,
  })

  const { workflow, checklist, explanation } = parseGeneratedOutput(text)
  const gapAnalysis = workflow ? analyzeWorkflow(workflow) : null

  if (!workflow) {
    return Response.json(
      { error: 'Failed to parse workflow JSON from AI response', raw: text },
      { status: 500 },
    )
  }

  // ── Attempt live n8n write; if it fails, caller will show JSON to paste ──
  let importedId: string | undefined
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

  // Board card (fire-and-forget)
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

  const n8nBase  = getBaseUrl()
  const importUrl = importedId && n8nBase
    ? `${n8nBase}/workflow/${importedId}`
    : n8nBase
      ? `${n8nBase}/workflow/new?workflow=${encodeURIComponent(JSON.stringify(workflow))}`
      : undefined

  // Persist automation for the signed-in user when Supabase is configured.
  let savedAutomation: SavedAutomation | undefined
  const { userId } = await auth()
  if (userId && db) {
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
      .insert(automationToRow(draft, userId) as never)
      .select()
      .single()
    if (!error && data) {
      savedAutomation = rowToAutomation(data as unknown as AutomationRow)
    } else if (error) {
      console.error('[n8n/generate] persist failed:', error.message)
    }
  }

  return Response.json({
    workflow,
    workflowType,
    checklist,
    explanation,
    importUrl,
    importedId,
    importError,
    gapAnalysis,
    automation: savedAutomation,
  })
}

/**
 * POST /api/n8n/bridge
 *
 * OpenClaw Fallback Bridge — Phase 13c
 *
 * Priority routing (n8n first, OpenClaw only for gaps):
 *   1. Use Claude to analyse the description and split steps into
 *      API-native (n8n) vs browser-automation (OpenClaw) categories.
 *   2. Generate an n8n v1 workflow for the API-native steps.
 *   3. If OpenClaw steps exist AND OPENCLAW_GATEWAY_URL is configured,
 *      dispatch those steps to the OpenClaw agent.
 *   4. Return a unified plan so the client can track both halves.
 *
 * Body:
 *   {
 *     description:      string   — plain-English description of the full automation
 *     businessContext?: string   — optional context (industry, tools, etc.)
 *     projectId?:       string   — Kanban project to attach board card to
 *   }
 *
 * Response:
 *   {
 *     plan:                GapAnalysis
 *     n8nWorkflow?:        N8nWorkflow      — for the API-native steps
 *     openClawDispatched:  boolean
 *     openClawSessionId?:  string
 *     importUrl?:          string           — deep-link to import n8n workflow
 *     note?:               string           — informational message
 *   }
 */

import { NextRequest } from 'next/server'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { audit } from '@/lib/audit'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { analyzeDescription } from '@/lib/n8n/gap-detector'
import { getBaseUrl } from '@/lib/n8n/client'
import { tryGateway } from '@/lib/claw/llm'
import type { N8nWorkflow } from '@/lib/n8n/types'
import type { GapAnalysis, WorkflowStep } from '@/lib/n8n/gap-detector'

export const maxDuration = 60
export const runtime     = 'nodejs'

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert automation architect specialising in hybrid n8n + OpenClaw workflows.

Given a workflow description, you must:
1. Identify which steps can be handled by n8n (public REST/GraphQL APIs, webhooks, scheduled triggers)
2. Identify which steps require OpenClaw (browser automation: scraping, login forms, 2FA, JS-rendered pages, LinkedIn/Instagram DM/scraping)
3. Generate a valid n8n v1 workflow JSON for the API-native steps only
4. If OpenClaw steps exist, include a Webhook trigger node named "OpenClaw Result Receiver" so results flow back into the n8n workflow

OUTPUT FORMAT (use these exact separators — no extra text before or after):

---ANALYSIS---
{
  "apiNativeSteps": [
    { "id": "step-1", "description": "What this step does", "nodeType": "n8n-nodes-base.webhook" }
  ],
  "openClawSteps": [
    { "id": "step-2", "description": "What this step does", "openClawReason": "Why n8n cannot do it" }
  ],
  "hybridRequired": true,
  "routingExplanation": "1-2 sentences explaining the routing decision",
  "summary": "Hybrid: 2 n8n + 1 OpenClaw"
}
---WORKFLOW---
{ n8n v1 workflow JSON for the API-native steps only }
---OPENCLAW---
Plain-English task description for the OpenClaw browser-automation steps (or the word "none" if not needed)

n8n workflow rules:
- Output valid JSON, no markdown fences
- Format: { name, nodes[], connections{}, active: false, settings: { executionOrder: "v1" }, tags: ["nexus-bridge"] }
- Every node: id (unique), name, type, typeVersion, position ([x, y] 220px apart horizontally), parameters
- 4–8 nodes maximum
- Include a Webhook trigger node if OpenClaw steps exist (for result callback)
- Use typeVersion: 2 for most nodes, typeVersion: 4 for httpRequest, typeVersion: 1 for triggers`

// ── Response parser ───────────────────────────────────────────────────────────

interface BridgeAnalysisShape {
  apiNativeSteps:     Array<{ id: string; description: string; nodeType?: string }>
  openClawSteps:      Array<{ id: string; description: string; openClawReason?: string }>
  hybridRequired:     boolean
  routingExplanation: string
  summary:            string
}

interface ParsedBridge {
  analysis:     GapAnalysis | null
  n8nWorkflow:  N8nWorkflow | null
  openClawTask: string | null
}

function parseBridgeOutput(text: string): ParsedBridge {
  const aSep = text.indexOf('---ANALYSIS---')
  const wSep = text.indexOf('---WORKFLOW---')
  const oSep = text.indexOf('---OPENCLAW---')

  if (aSep === -1) return { analysis: null, n8nWorkflow: null, openClawTask: null }

  const analysisStr  = wSep > 0 ? text.slice(aSep + 14, wSep).trim() : text.slice(aSep + 14).trim()
  const workflowStr  = wSep > 0 && oSep > 0 ? text.slice(wSep + 14, oSep).trim()
                     : wSep > 0              ? text.slice(wSep + 14).trim()
                     : ''
  const openClawStr  = oSep > 0 ? text.slice(oSep + 13).trim() : ''

  // Parse analysis JSON
  let raw: BridgeAnalysisShape | null = null
  try {
    raw = JSON.parse(analysisStr) as BridgeAnalysisShape
  } catch {
    const m = analysisStr.match(/\{[\s\S]*\}/)
    if (m) try { raw = JSON.parse(m[0]) as BridgeAnalysisShape } catch { /* ignore */ }
  }

  const analysis: GapAnalysis | null = raw
    ? {
        apiNativeSteps: (raw.apiNativeSteps ?? []).map(s => ({
          id:          s.id,
          description: s.description,
          nodeType:    s.nodeType,
          canUseN8n:   true,
        } satisfies WorkflowStep)),
        openClawSteps: (raw.openClawSteps ?? []).map(s => ({
          id:             s.id,
          description:    s.description,
          canUseN8n:      false,
          openClawReason: s.openClawReason,
        } satisfies WorkflowStep)),
        hybridRequired:     raw.hybridRequired     ?? false,
        routingExplanation: raw.routingExplanation ?? '',
        summary:            raw.summary            ?? '',
      }
    : null

  // Parse n8n workflow JSON
  let n8nWorkflow: N8nWorkflow | null = null
  if (workflowStr && workflowStr.toLowerCase() !== 'null') {
    try {
      n8nWorkflow = JSON.parse(workflowStr) as N8nWorkflow
    } catch {
      const m = workflowStr.match(/\{[\s\S]*\}/)
      if (m) try { n8nWorkflow = JSON.parse(m[0]) as N8nWorkflow } catch { /* ignore */ }
    }
  }

  const openClawTask = openClawStr && openClawStr.toLowerCase() !== 'none'
    ? openClawStr
    : null

  return { analysis, n8nWorkflow, openClawTask }
}

// ── OpenClaw dispatch helper ──────────────────────────────────────────────────

async function dispatchToOpenClaw(
  task:       string,
  sessionId:  string,
  callbackUrl: string,
): Promise<boolean> {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL
  const bearerToken = process.env.OPENCLAW_BEARER_TOKEN
  if (!gatewayUrl || !bearerToken) return false

  const base = gatewayUrl.replace(/\/$/, '')
  const message = [
    'OpenClaw Bridge Task dispatched from Nexus (Phase 13c Hybrid Workflow).',
    '',
    task,
    '',
    `When complete, POST your result JSON to: ${callbackUrl}`,
    'Include fields: { workflowId, executionId, status: "success"|"error", summary }',
  ].join('\n')

  try {
    const res = await fetch(
      `${base}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bearerToken}`,
        },
        body:   JSON.stringify({ role: 'user', content: message }),
        signal: AbortSignal.timeout(15_000),
      },
    )
    return res.ok
  } catch {
    return false
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 5, window: '1 m', prefix: 'n8n-bridge' })
  if (!rl.success) return rateLimitResponse(rl)

  const body = await req.json() as {
    description:      string
    businessContext?: string
    projectId?:       string
    // Lineage (PR 3 of task_plan-ux-security-onboarding.md). Optional.
    ideaId?:          string
    runId?:           string
    businessSlug?:    string
  }

  if (!body.description?.trim()) {
    return new Response(
      JSON.stringify({ error: 'description is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  audit(req, {
    action:   'n8n.bridge',
    resource: 'workflow',
    metadata: { description: body.description.slice(0, 100) },
  })

  const apiKey = process.env.ANTHROPIC_API_KEY

  // ── Fast path: no API key → heuristic analysis only ──────────────────────
  if (!apiKey) {
    const plan = analyzeDescription(body.description)
    return new Response(
      JSON.stringify({
        plan,
        n8nWorkflow:       null,
        openClawDispatched: false,
        note: 'Heuristic gap analysis only — set ANTHROPIC_API_KEY in Doppler for AI-powered routing and workflow generation.',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  // ── Step 1: AI analysis + workflow generation ─────────────────────────────
  const userPrompt = [
    body.description.trim(),
    body.businessContext?.trim()
      ? `\nBusiness context: ${body.businessContext.trim()}`
      : '',
  ].filter(Boolean).join('\n')

  // Try gateway first (plan-billed), fall through to API key.
  const { userId: clerkUserId } = await auth().catch(() => ({ userId: null }))
  let text = ''
  if (clerkUserId) {
    const gw = await tryGateway({
      userId:     clerkUserId,
      system:     SYSTEM_PROMPT,
      prompt:     userPrompt,
      sessionTag: 'n8n-bridge',
      timeoutMs:  55_000,
    })
    if (gw.ok) text = gw.text
  }
  if (!text) {
    const result = await generateText({
      model:           anthropic('claude-sonnet-4-6'),
      system:          SYSTEM_PROMPT,
      messages:        [{ role: 'user', content: userPrompt }],
      maxOutputTokens: 3500,
    })
    text = result.text
  }

  const { analysis, n8nWorkflow, openClawTask } = parseBridgeOutput(text)

  // Fall back to heuristic if AI parsing failed
  const plan: GapAnalysis = analysis ?? analyzeDescription(body.description)

  // ── Step 2: Dispatch OpenClaw steps if needed + configured ───────────────
  let openClawDispatched = false
  let openClawSessionId: string | undefined

  if (plan.hybridRequired && openClawTask) {
    const sessionId    = `nexus-bridge-${Date.now()}`
    const origin       = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? ''
    const callbackUrl  = `${origin}/api/webhooks/n8n`

    openClawDispatched = await dispatchToOpenClaw(openClawTask, sessionId, callbackUrl)
    if (openClawDispatched) openClawSessionId = sessionId
  }

  // ── Step 3: Create board card ─────────────────────────────────────────────
  const db = createServerClient()
  if (db) {
    const cardTitle = `[Bridge] ${n8nWorkflow?.name ?? body.description.slice(0, 50)}`
    const details = [
      plan.routingExplanation,
      openClawDispatched
        ? `\nOpenClaw session: ${openClawSessionId}`
        : plan.hybridRequired
          ? '\nOpenClaw not configured — configure OPENCLAW_GATEWAY_URL + OPENCLAW_BEARER_TOKEN in Doppler to auto-dispatch.'
          : '',
    ].filter(Boolean).join('\n')

    await (db as unknown as {
      from: (t: string) => {
        insert: (row: object) => Promise<{ error: { message: string } | null }>
      }
    })
      .from('tasks')
      .insert({
        title:         cardTitle,
        description:   details,
        column_id:     'backlog',
        priority:      plan.hybridRequired ? 'high' : 'medium',
        project_id:    body.projectId    ?? null,
        idea_id:       body.ideaId       ?? null,
        run_id:        body.runId        ?? null,
        business_slug: body.businessSlug ?? null,
        position:      0,
      })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error('[n8n/bridge] board card:', error.message)
      })
  }

  // ── Step 4: Build n8n import URL ──────────────────────────────────────────
  const n8nBase  = getBaseUrl()
  const importUrl = n8nBase && n8nWorkflow
    ? `${n8nBase}/workflow/new?workflow=${encodeURIComponent(JSON.stringify(n8nWorkflow))}`
    : undefined

  return new Response(
    JSON.stringify({
      plan,
      n8nWorkflow:        n8nWorkflow ?? null,
      openClawDispatched,
      openClawSessionId,
      importUrl,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}

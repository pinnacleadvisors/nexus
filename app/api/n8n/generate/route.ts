/**
 * POST /api/n8n/generate
 *
 * Uses Claude to generate a valid n8n v1 workflow JSON from a plain-English
 * description. Also returns a setup checklist and optional board card.
 *
 * Body:
 *   {
 *     description:     string   — plain-English description of what the workflow should do
 *     businessContext: string   — additional context (industry, tools used, etc.)
 *     templateId?:     string   — base on an existing template
 *     projectId?:      string   — attach board card to this project
 *   }
 *
 * Response:
 *   {
 *     workflow:      N8nWorkflow
 *     checklist:     string[]
 *     explanation:   string
 *     importUrl?:    string   — deep-link to import into n8n instance
 *   }
 */

import { NextRequest } from 'next/server'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase'
import { audit } from '@/lib/audit'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getTemplate } from '@/lib/n8n/templates'
import { getBaseUrl } from '@/lib/n8n/client'
import type { N8nWorkflow } from '@/lib/n8n/types'

export const maxDuration = 60
export const runtime = 'nodejs'

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert n8n workflow architect. You design production-ready n8n v1 automation workflows in valid JSON.

Rules:
1. Output ONLY valid JSON — no markdown fences, no explanation before or after the JSON object.
2. Use n8n v1 format: { name, nodes[], connections{}, active: false, settings: { executionOrder: "v1" }, tags[] }
3. Every node needs: id (unique string), name, type, typeVersion, position ([x,y] 220px apart horizontally), parameters
4. connections format: { "NodeName": { "main": [[{ "node": "NextNode", "type": "main", "index": 0 }]] } }
5. Use real n8n node types: n8n-nodes-base.scheduleTrigger, n8n-nodes-base.webhook, n8n-nodes-base.httpRequest, n8n-nodes-base.slack, n8n-nodes-base.notion, n8n-nodes-base.hubspot, n8n-nodes-base.code, n8n-nodes-base.set, n8n-nodes-base.wait, n8n-nodes-base.gmail, n8n-nodes-base.stripe, n8n-nodes-base.twitter, n8n-nodes-base.linkedIn, n8n-nodes-base.rssFeedRead
6. For external API calls without a dedicated node, use n8n-nodes-base.httpRequest
7. Use typeVersion: 2 for most nodes, typeVersion: 4 for httpRequest, typeVersion: 1 for triggers
8. Reference env vars as ={{$vars.VAR_NAME}} in parameters
9. Keep workflows focused — 4-8 nodes is ideal
10. After the workflow JSON, on a new line write "---CHECKLIST---" followed by a numbered setup checklist (5-8 steps)
11. After the checklist, on a new line write "---EXPLANATION---" followed by a 2-3 sentence plain-English explanation`

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
    // Try to extract JSON object if extra text slipped in
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
  }

  if (!body.description?.trim()) {
    return new Response(
      JSON.stringify({ error: 'description is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Build user prompt
  const baseTemplate = body.templateId ? getTemplate(body.templateId) : undefined
  const userPrompt = [
    `Create an n8n workflow that does the following:`,
    body.description.trim(),
    body.businessContext?.trim()
      ? `\nBusiness context: ${body.businessContext.trim()}`
      : '',
    baseTemplate
      ? `\nBase it on this template structure (adapt as needed): ${baseTemplate.name} — ${baseTemplate.description}`
      : '',
  ].filter(Boolean).join('\n')

  audit(req, {
    action:     'n8n.generate',
    resource:   'workflow',
    resourceId: 'generated',
    metadata:   { description: body.description.slice(0, 100) },
  })

  const { text } = await generateText({
    model:           anthropic('claude-sonnet-4-6'),
    system:          SYSTEM_PROMPT,
    messages:        [{ role: 'user', content: userPrompt }],
    maxOutputTokens: 3000,
  })

  const { workflow, checklist, explanation } = parseGeneratedOutput(text)

  if (!workflow) {
    return new Response(
      JSON.stringify({ error: 'Failed to parse workflow JSON from AI response', raw: text }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Create a board card for the generated workflow
  const db = createServerClient()
  if (db) {
    await (db as ReturnType<typeof createServerClient> & { from: Function })
      .from('tasks')
      .insert({
        title:       `[n8n Workflow] ${workflow.name}`,
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

  // Build optional n8n import deep-link
  const n8nBase  = getBaseUrl()
  const importUrl = n8nBase
    ? `${n8nBase}/workflow/new?workflow=${encodeURIComponent(JSON.stringify(workflow))}`
    : undefined

  return new Response(
    JSON.stringify({ workflow, checklist, explanation, importUrl }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}

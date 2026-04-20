/**
 * POST /api/idea/analyse
 *
 * Takes either a description-mode or remodel-mode submission and returns a
 * structured IdeaCard (profitability, automation %, steps, tools, costs).
 *
 * Body:
 *   {
 *     mode: 'description' | 'remodel'
 *     description?:   string   — description mode
 *     inspirationUrl?: string  — remodel mode
 *     twist?:          string  — remodel mode (optional)
 *     setupBudgetUsd?: number
 *   }
 *
 * Response: IdeaCard (without id/createdAt — client assigns those)
 */

import { NextRequest } from 'next/server'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import type { IdeaCard, IdeaMode } from '@/lib/types'

export const maxDuration = 60
export const runtime = 'nodejs'

const SYSTEM_PROMPT = `You are a business-idea analyst for the Nexus platform.
Given either (a) a fresh idea description, or (b) an inspiration link the user wants to remodel, you return a STRICT JSON object with this shape:

{
  "description": string,                          // short plain-English summary of the idea
  "howItMakesMoney": string,                      // e.g. "Affiliate links", "TikTok Shop commissions", "Subscriptions"
  "approxMonthlyRevenueUsd": number,
  "approxSetupCostUsd": number,
  "approxMonthlyCostUsd": number,
  "automationPercent": number,                    // 0-100
  "profitableVerdict": "likely" | "unlikely" | "uncertain",
  "profitableReasoning": string,
  "steps": [                                      // steps to build AND maintain
    { "title": string, "automatable": boolean, "phase": "build" | "maintain", "tools": [string] }
  ],
  "tools": [
    { "name": string, "purpose": string, "url": string }
  ]
}

Rules:
- Prioritise tools that allow rapid execution but are high-quality, battle-tested, and well-reviewed.
- If the user gives a setup budget, keep total "approxSetupCostUsd" at or below that number.
- For remodel mode: use the inspiration URL and any stated twist; estimate revenue using niche statistical averages.
- Include both BUILD-phase and MAINTAIN-phase steps.
- Output ONLY the JSON — no markdown, no prose.`

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'idea-analyse' })
  if (!rl.success) return rateLimitResponse(rl)

  const body = await req.json() as {
    mode: IdeaMode
    description?: string
    inspirationUrl?: string
    twist?: string
    setupBudgetUsd?: number
  }

  if (body.mode === 'description' && !body.description?.trim()) {
    return Response.json({ error: 'description is required in description mode' }, { status: 400 })
  }
  if (body.mode === 'remodel' && !body.inspirationUrl?.trim()) {
    return Response.json({ error: 'inspirationUrl is required in remodel mode' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })
  }

  const userPrompt = body.mode === 'description'
    ? [
        `Mode: idea-from-description`,
        `Description: ${body.description!.trim()}`,
        body.setupBudgetUsd ? `Setup budget: $${body.setupBudgetUsd}` : '',
      ].filter(Boolean).join('\n')
    : [
        `Mode: remodel`,
        `Inspiration link: ${body.inspirationUrl!.trim()}`,
        body.twist?.trim() ? `Twist: ${body.twist.trim()}` : '',
        body.setupBudgetUsd ? `Setup budget: $${body.setupBudgetUsd}` : '',
      ].filter(Boolean).join('\n')

  audit(req, {
    action: 'idea.analyse',
    resource: 'idea',
    resourceId: body.mode,
    metadata: { mode: body.mode },
  })

  const { text } = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    maxOutputTokens: 2500,
  })

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return Response.json({ error: 'Agent did not return JSON', raw: text }, { status: 502 })
  }

  let parsed: Omit<IdeaCard, 'id' | 'createdAt' | 'mode' | 'inspirationUrl' | 'twist' | 'setupBudgetUsd'>
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return Response.json({ error: 'Failed to parse agent JSON', raw: text }, { status: 502 })
  }

  const card: Omit<IdeaCard, 'id' | 'createdAt'> = {
    mode: body.mode,
    inspirationUrl: body.mode === 'remodel' ? body.inspirationUrl : undefined,
    twist: body.mode === 'remodel' ? body.twist : undefined,
    setupBudgetUsd: body.setupBudgetUsd,
    ...parsed,
  }

  return Response.json({ card })
}

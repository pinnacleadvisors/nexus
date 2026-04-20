/**
 * POST /api/idea/analyse
 *
 * Takes either a description-mode or remodel-mode submission and returns a
 * structured IdeaCard (profitability, automation %, steps, tools, costs).
 *
 * Remodel mode is grounded in live data:
 *   1. Firecrawl scrapes the inspiration URL and up to 3 same-domain links.
 *   2. Tavily searches the niche for revenue benchmarks + automation examples.
 * The scraped + searched context is injected into the system prompt so the
 * agent reasons from real text instead of guessing from the URL string.
 *
 * Body:
 *   {
 *     mode: 'description' | 'remodel'
 *     description?:   string
 *     inspirationUrl?: string
 *     twist?:          string
 *     setupBudgetUsd?: number
 *   }
 *
 * Response: { card: IdeaCard (minus id/createdAt), sources: {url,title}[] }
 */

import { NextRequest } from 'next/server'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { scrapeWithConnected, formatScrapesForContext } from '@/lib/tools/firecrawl'
import { searchWeb, formatResultsAsContext } from '@/lib/tools/tavily'
import { createServerClient } from '@/lib/supabase'
import { ideaCardToRow, rowToIdeaCard, type IdeaRow } from '@/lib/idea-db'
import type { IdeaCard, IdeaMode } from '@/lib/types'

export const maxDuration = 90
export const runtime = 'nodejs'

const SYSTEM_PROMPT = `You are a business-idea analyst for the Nexus platform.
Given either (a) a fresh idea description, or (b) an inspiration link (with scraped page contents + niche web-search results), you return a STRICT JSON object with this shape:

{
  "description": string,
  "howItMakesMoney": string,
  "approxMonthlyRevenueUsd": number,
  "approxSetupCostUsd": number,
  "approxMonthlyCostUsd": number,
  "automationPercent": number,
  "profitableVerdict": "likely" | "unlikely" | "uncertain",
  "profitableReasoning": string,
  "steps": [
    { "title": string, "automatable": boolean, "phase": "build" | "maintain", "tools": [string] }
  ],
  "tools": [
    { "name": string, "purpose": string, "url": string }
  ]
}

Rules:
- Prioritise tools that allow rapid execution but are high-quality, battle-tested, and well-reviewed.
- If the user gives a setup budget, keep total "approxSetupCostUsd" at or below that number.
- For remodel mode: ground every estimate (revenue, automation %, verdict) in the scraped page text and web-search benchmarks supplied below. If the sources contradict a guess, trust the sources.
- Include both BUILD-phase and MAINTAIN-phase steps. Flag ANYTHING that requires a human action (account creation, API key generation, payment setup, social media authentication) as automatable=false.
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

  // ── Gather research for remodel mode ───────────────────────────────────────
  const sources: Array<{ url: string; title: string }> = []
  let researchContext = ''

  if (body.mode === 'remodel' && body.inspirationUrl) {
    const [scrapeResult, searchResults] = await Promise.all([
      scrapeWithConnected(body.inspirationUrl, { maxConnected: 3, totalCharBudget: 15_000 }),
      searchWeb(`${body.inspirationUrl} niche revenue monetisation how they make money`, {
        maxResults: 5,
        maxTokens: 3000,
      }),
    ])

    const { root, connected } = scrapeResult
    if (!root.failed) sources.push({ url: root.url, title: root.title })
    for (const c of connected) sources.push({ url: c.url, title: c.title })
    for (const s of searchResults) sources.push({ url: s.url, title: s.title })

    const scrapedText  = formatScrapesForContext(root, connected)
    const searchedText = formatResultsAsContext(searchResults)

    researchContext = [
      scrapedText,
      searchedText,
      root.failed
        ? `(Firecrawl scrape failed: ${root.error}. Rely on the search results and URL alone.)`
        : '',
    ].filter(Boolean).join('\n\n')
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
        '',
        '--- RESEARCH CONTEXT ---',
        researchContext || '(No live research available. Reason from the URL and domain knowledge.)',
      ].filter(Boolean).join('\n')

  audit(req, {
    action: 'idea.analyse',
    resource: 'idea',
    resourceId: body.mode,
    metadata: { mode: body.mode, sourceCount: sources.length },
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

  const draft: Omit<IdeaCard, 'id' | 'createdAt'> = {
    mode: body.mode,
    inspirationUrl: body.mode === 'remodel' ? body.inspirationUrl : undefined,
    twist: body.mode === 'remodel' ? body.twist : undefined,
    setupBudgetUsd: body.setupBudgetUsd,
    ...parsed,
  }

  // Persist for the signed-in user when Supabase is configured. Pages fall
  // back to localStorage when persistence isn't available.
  const { userId } = await auth()
  const supabase = createServerClient()
  if (userId && supabase) {
    const { data, error } = await supabase
      .from('ideas')
      .insert(ideaCardToRow({ ...draft, sources }, userId) as never)
      .select()
      .single()

    if (!error && data) {
      return Response.json({ card: rowToIdeaCard(data as unknown as IdeaRow), sources })
    }
    if (error) console.error('[idea/analyse] persist failed:', error.message)
  }

  return Response.json({ card: draft, sources })
}

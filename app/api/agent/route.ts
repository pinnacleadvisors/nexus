/**
 * POST /api/agent
 *
 * Dispatch a one-shot agent capability run (not multi-turn chat).
 * Streams the response as plain text (UTF-8 chunks).
 * On completion: creates a board card in Review + appends to Notion (fire-and-forget).
 *
 * Body:
 *   {
 *     capabilityId: string          — one of AGENT_CAPABILITIES[].id
 *     inputs: Record<string,string> — keyed form values
 *     projectId?: string
 *     notionPageId?: string
 *     model?: string                — defaults to claude-sonnet-4-6
 *   }
 */

import { NextRequest } from 'next/server'
import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { auth } from '@clerk/nextjs/server'
import { getCapability } from '@/lib/agent-capabilities'
import { createServerClient } from '@/lib/supabase'
import { resolveNotionToken, appendBlocks } from '@/lib/notion'
import { writeAgentRun, searchPages as searchMemory, isMemoryConfigured } from '@/lib/memory/github'
import { audit } from '@/lib/audit'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createEntry, extractCodeBlocksFromOutput } from '@/lib/library/client'
import type { CodeLanguage } from '@/lib/library/types'
import {
  searchWebMulti,
  formatResultsAsContext,
  formatCitations,
  buildResearchQueries,
  SEARCH_ENABLED_CAPABILITIES,
} from '@/lib/tools/tavily'

export const maxDuration = 60
export const runtime = 'nodejs'

// ── Build the user prompt from capability inputs ──────────────────────────────
function buildUserPrompt(inputs: Record<string, string>): string {
  const lines: string[] = ['## Business Context\n']
  const labels: Record<string, string> = {
    businessName:        'Business Name',
    businessDescription: 'Business Description',
    targetMarket:        'Target Market',
    researchFocus:       'Research Focus',
    contentType:         'Content Type',
    tone:                'Brand Tone',
    keywords:            'Target Keywords',
    appDescription:      'App Description',
    techPreferences:     'Tech Preferences',
    websiteUrl:          'Website URL',
    seedKeywords:        'Seed Keywords',
    platforms:           'Platforms',
    brandVoice:          'Brand Voice',
    productType:         'Product Type',
    commonIssues:        'Common Issues',
    icp:                 'Ideal Customer Profile',
    valueProp:           'Value Proposition',
    caseStudy:           'Case Study',
    brandAdjectives:     'Brand Adjectives',
    competitorRefs:      'Competitor References',
    industry:            'Industry',
    pricingModel:        'Pricing Model',
    targetArr:           'Target ARR',
    startingCapital:     'Starting Capital',
    businessType:        'Business Type',
    dataCollected:       'Data Collected',
    jurisdiction:        'Jurisdiction',
    // Consultant inputs
    currentTools:        'Current Tools',
    painPoints:          'Pain Points',
    budget:              'Monthly Automation Budget',
    // Neuro-content inputs
    topic:               'Topic',
    format:              'Content Format',
  }
  for (const [key, value] of Object.entries(inputs)) {
    if (value?.trim()) {
      const label = labels[key] ?? key
      lines.push(`**${label}:** ${value.trim()}`)
    }
  }
  lines.push('\n---\n\nPlease produce the full deliverable based on the context above.')
  return lines.join('\n')
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Rate limit: 10 agent runs per minute per IP
  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'agent' })
  if (!rl.success) return rateLimitResponse(rl)

  const body = await req.json() as {
    capabilityId: string
    inputs: Record<string, string>
    projectId?: string
    notionPageId?: string
    model?: string
  }

  const capability = getCapability(body.capabilityId)
  if (!capability) {
    return new Response(
      JSON.stringify({ error: `Unknown capability: ${body.capabilityId}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured — add it to Doppler.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const model  = body.model ?? 'claude-sonnet-4-6'
  const system = capability.systemPrompt.replace(
    /\{\{businessName\}\}/g,
    body.inputs.businessName ?? 'this business',
  )

  // ── Tavily live web search (fire before streaming, non-blocking on failure) ──
  let tavilyContext = ''
  let tavilyResults: Awaited<ReturnType<typeof searchWebMulti>> = []
  if (SEARCH_ENABLED_CAPABILITIES.has(body.capabilityId) && process.env.TAVILY_API_KEY) {
    const queries = buildResearchQueries(body.capabilityId, body.inputs)
    if (queries.length > 0) {
      tavilyResults = await searchWebMulti(queries, { maxResults: 4, searchDepth: 'basic', maxTokens: 3500 })
      if (tavilyResults.length > 0) {
        tavilyContext = formatResultsAsContext(tavilyResults)
      }
    }
  }

  // ── GitHub memory context injection ─────────────────────────────────────────
  let memoryContext = ''
  if (isMemoryConfigured() && body.inputs.businessName) {
    try {
      const memResults = await searchMemory(body.inputs.businessName, 5)
      if (memResults.length > 0) {
        const excerpts = memResults
          .filter(r => r.excerpt)
          .map(r => `- [${r.path}]: ${r.excerpt}`)
          .join('\n')
        if (excerpts) {
          memoryContext = `## Prior Agent Memory (from nexus-memory)\n${excerpts}\n\nUse the above prior context to avoid repeating work and build on previous research.\n\n`
        }
      }
    } catch { /* non-fatal — agent still runs without memory */ }
  }

  const userPrompt = [memoryContext, tavilyContext, buildUserPrompt(body.inputs)]
    .filter(Boolean)
    .join('\n\n')

  audit(req, {
    action:     `agent.${body.capabilityId}`,
    resource:   'agent',
    resourceId: body.capabilityId,
    metadata:   { model, projectId: body.projectId, businessName: body.inputs.businessName },
  })

  // Resolve user ID once (best-effort — agent routes are not always authed)
  const { userId: clerkUserId } = await auth().catch(() => ({ userId: null }))

  const result = streamText({
    model: anthropic(model),
    system,
    messages: [{ role: 'user', content: userPrompt }],

    onFinish: async ({ text }) => {
      const db = createServerClient()

      // ── Consultant: create one board card per recommendation ───────────────
      if (body.capabilityId === 'consultant' && db) {
        try {
          const jsonMatch = text.match(/^\s*\{[\s\S]*?\}(?=\s*#)/m)
          if (jsonMatch) {
            const report = JSON.parse(jsonMatch[0]) as {
              automationOpportunities?: Array<{
                priority:    number
                title:       string
                description: string
                tools:       string[]
                estimatedSetupMinutes: number
                requiresOpenClaw: boolean
                complexity:  string
              }>
            }
            const opps = report.automationOpportunities ?? []
            for (const opp of opps.slice(0, 8)) {
              const toolList = opp.tools.join(', ')
              await db.from('tasks').insert({
                title:       `[Automation] ${opp.title}`,
                description: `${opp.description}\n\nTools: ${toolList}\nSetup: ~${opp.estimatedSetupMinutes} min\nOpenClaw needed: ${opp.requiresOpenClaw ? 'Yes' : 'No'}`,
                column_id:   'backlog',
                priority:    opp.priority <= 2 ? 'high' : opp.priority <= 4 ? 'medium' : 'low',
                project_id:  body.projectId ?? null,
                position:    opp.priority,
              }).then(({ error }) => {
                if (error) console.error('[agent/consultant] card insert:', error.message)
              })
            }
          }
        } catch (err) {
          console.error('[agent/consultant] failed to parse recommendations:', err)
        }

        // Also create a single summary card in Review
        if (db) {
          await db.from('tasks').insert({
            title:       `Automation Strategy: ${body.inputs.businessName ?? 'Your Business'}`,
            description: 'Full consultant report — approve to proceed with implementation.',
            column_id:   'review',
            priority:    'high',
            project_id:  body.projectId ?? null,
            position:    0,
          }).then(({ error }) => {
            if (error) console.error('[agent/consultant] summary card:', error.message)
          })
        }
        // Skip the generic card below for consultant
      } else if (db) {
        // ── Default: create one board card in Review column ─────────────────
        const title = `${capability.name}: ${body.inputs.businessName ?? 'Untitled'}`
        await db.from('tasks').insert({
          title,
          description: `Agent-generated ${capability.name} document.`,
          column_id:   'review',
          priority:    'medium',
          project_id:  body.projectId ?? null,
          position:    0,
        }).then(({ error }) => {
          if (error) console.error('[agent] board card insert failed:', error.message)
        })
      }

      // ── Auto-extract code snippets into library ─────────────────────────────
      if (clerkUserId) {
        const VALID_LANGS: CodeLanguage[] = [
          'typescript', 'javascript', 'python', 'sql', 'bash', 'json', 'yaml',
        ]
        const blocks = extractCodeBlocksFromOutput(text)
        for (const block of blocks.slice(0, 3)) {  // max 3 snippets per run
          const lang = VALID_LANGS.includes(block.language as CodeLanguage)
            ? (block.language as CodeLanguage)
            : 'typescript'
          await createEntry('code', clerkUserId, {
            title:          `${capability.name} — auto-extracted snippet`,
            description:    `Auto-extracted from agent run: ${capability.name}`,
            language:       lang,
            purpose:        capability.category,
            code:           block.code,
            tags:           [capability.category, lang, 'auto-extracted'],
            dependencies:   [],
            source_agent_run: body.capabilityId,
          }).catch(err => {
            console.error('[agent] library auto-extract failed:', err)
          })
        }
      }

      // ── Write to GitHub memory repo ────────────────────────────────────────
      if (isMemoryConfigured()) {
        const citations = tavilyResults.length > 0 ? formatCitations(tavilyResults) : undefined
        await writeAgentRun(
          body.capabilityId,
          body.inputs.businessName ?? 'unknown',
          text,
          citations,
        ).catch(err => {
          console.error('[agent] memory write failed:', err)
        })
      }

      // ── Append to Notion (optional secondary sink) ─────────────────────────
      if (body.notionPageId && capability.savesToNotion) {
        const notionToken = resolveNotionToken(
          req.cookies.get('oauth_token_notion')?.value,
        )
        if (notionToken) {
          const heading   = `🤖 ${capability.name}: ${body.inputs.businessName ?? ''}`
          const citations = tavilyResults.length > 0 ? formatCitations(tavilyResults) : ''
          const trimmed   = (text + citations).slice(0, 2000)
          await appendBlocks(notionToken, body.notionPageId, [
            { type: 'heading_2', text: heading },
            { type: 'paragraph', text: trimmed },
          ]).catch(err => {
            console.error('[agent] notion append failed:', err)
          })
        }
      }
    },
  })

  // Stream plain text back to client
  return new Response(result.textStream.pipeThrough(new TextEncoderStream()), {
    headers: {
      'Content-Type':   'text/plain; charset=utf-8',
      'X-Capability':   capability.id,
      'X-Model':        model,
      'X-Tavily-Count': String(tavilyResults.length),
      'Cache-Control': 'no-cache',
    },
  })
}

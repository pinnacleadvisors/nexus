/**
 * POST /api/content/generate
 *
 * Generates neuro-optimised content with a server-side revision loop.
 * Streams the final content as plain text once the target score is reached.
 *
 * Body: GenerateContentRequest
 * Response: text/plain stream — final content
 * Headers: X-Neuro-Score, X-Neuro-Grade, X-Neuro-Iterations
 */

import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { assertUnderCostCap } from '@/lib/cost-guard'
import {
  buildScoringPrompt,
  buildRevisionPrompt,
  getTemplate,
  getToneProfile,
} from '@/lib/neuro-content'
import { callClaude } from '@/lib/claw/llm'
import type { GenerateContentRequest, PrincipleScore } from '@/lib/neuro-content'

export const runtime    = 'nodejs'
export const maxDuration = 120

function buildGenerationPrompt(
  topic:           string,
  businessContext: string,
  formatId:        string,
  toneId:          string,
): string {
  const template = getTemplate(formatId as never)
  const tone     = getToneProfile(toneId)

  const formatSection = template
    ? `## Format: ${template.name}
Structure:
${template.structure}

Neuro Guidelines for this format:
${template.neuroGuidelines}

${template.maxCharacters ? `Character limit: ${template.maxCharacters}` : ''}`
    : `## Format: ${formatId}`

  const toneSection = tone
    ? `## Tone: ${tone.name} — ${tone.tagline}
${tone.voice}

DO:
${tone.doList.map(d => `- ${d}`).join('\n')}

DON'T:
${tone.dontList.map(d => `- ${d}`).join('\n')}`
    : `## Tone: ${toneId}`

  return `You are a master conversion copywriter who applies cognitive neuroscience to every sentence.

## Task
Write high-performing content about the following topic. Apply as many of the 12 neuro-engagement principles as naturally as possible: curiosity gap, open loops, social proof, contrast effect, loss aversion framing, specificity anchoring, future pacing, micro-tension, identity mirroring, pattern interrupts, sensory language, and progressive disclosure.

## Topic
${topic}

## Business Context
${businessContext}

${formatSection}

${toneSection}

## Output
Write ONLY the final content — no preamble, no meta-commentary, no explanations. Output only what should be published.`
}

async function scoreContent(userId: string, content: string): Promise<{
  overallScore: number
  weaknesses:   string[]
  improvements: string[]
}> {
  const prompt = buildScoringPrompt(content)

  const llm = await callClaude({
    userId,
    prompt,
    model:           'claude-haiku-4-5-20251001',
    sessionTag:      'content-score-internal',
    maxOutputTokens: 1200,
    temperature:     0.1,
  })
  const text = llm.text

  try {
    let parsed: {
      principles:    PrincipleScore[]
      topWeaknesses: string[]
    }

    try {
      parsed = JSON.parse(text.trim())
    } catch {
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('parse failed')
      parsed = JSON.parse(match[0])
    }

    const overallScore = Math.round(
      parsed.principles.reduce((sum: number, p: PrincipleScore) => sum + p.score, 0) /
      parsed.principles.length
    )

    const weakPrinciples = parsed.principles
      .filter((p: PrincipleScore) => p.score < 75)
      .sort((a: PrincipleScore, b: PrincipleScore) => a.score - b.score)
      .slice(0, 3)

    return {
      overallScore,
      weaknesses:   weakPrinciples.map((p: PrincipleScore) => p.principleName),
      improvements: weakPrinciples.map((p: PrincipleScore) => p.improvement),
    }
  } catch {
    return { overallScore: 60, weaknesses: [], improvements: [] }
  }
}

export async function POST(req: NextRequest) {
  // B2 — auth + per-user rate limit + audit
  const { userId } = await auth()
  if (!userId) return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401, headers: { 'Content-Type': 'application/json' },
  })

  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'content-gen', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  // B9 — daily cost cap
  const cap = await assertUnderCostCap(userId)
  if (!cap.ok) return new Response(
    JSON.stringify({ error: 'daily cost cap exceeded', spentUsd: cap.spentUsd, capUsd: cap.capUsd }),
    { status: 402, headers: { 'Content-Type': 'application/json' } },
  )

  const body = await req.json() as GenerateContentRequest

  if (!body.topic?.trim()) {
    return new Response(JSON.stringify({ error: 'topic is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const targetScore   = body.targetScore   ?? 75
  const maxIterations = body.maxIterations  ?? 3
  const formatId      = body.format         ?? 'linkedin-post'
  const toneId        = body.tone           ?? 'authority'

  audit(req, {
    action: 'content.generate',
    resource: 'content',
    userId,
    metadata: { formatId, toneId, targetScore, maxIterations },
  })

  let draft      = ''
  let bestScore  = 0
  let iterations = 0

  // ── Generation + revision loop ────────────────────────────────────────────
  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1

    if (i === 0) {
      // Initial generation
      const genPrompt = buildGenerationPrompt(
        body.topic,
        body.businessContext ?? '',
        formatId,
        toneId,
      )
      const llm = await callClaude({
        userId,
        prompt:          genPrompt,
        model:           'claude-sonnet-4-6',
        sessionTag:      'content-gen',
        maxOutputTokens: 2000,
        temperature:     0.8,
      })
      if (llm.error || !llm.text) {
        return new Response(
          JSON.stringify({ error: llm.error ?? 'Generation failed' }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        )
      }
      draft = llm.text.trim()
    } else {
      // Revision pass
      const template = getTemplate(formatId as never)
      const tone     = getToneProfile(toneId)

      const { score, weaknesses, improvements } = await scoreContent(userId, draft).then(s => ({
        score:        s.overallScore,
        weaknesses:   s.weaknesses,
        improvements: s.improvements,
      }))

      bestScore = score
      if (score >= targetScore || weaknesses.length === 0) break

      const revisionPrompt = buildRevisionPrompt(
        draft,
        weaknesses,
        improvements,
        template?.structure ?? formatId,
        tone?.voice        ?? toneId,
      )

      const llm = await callClaude({
        userId,
        prompt:          revisionPrompt,
        model:           'claude-sonnet-4-6',
        sessionTag:      'content-revise',
        maxOutputTokens: 2000,
        temperature:     0.7,
      })
      if (!llm.error && llm.text) {
        draft = llm.text.trim()
      }
    }
  }

  // Final score of the last draft
  const { overallScore } = await scoreContent(userId, draft)
  bestScore = overallScore

  // If we only did one iteration, still do a score pass
  if (iterations === 1 && bestScore === 0) {
    const s = await scoreContent(userId, draft)
    bestScore = s.overallScore
  }

  // Build response headers
  const headers: Record<string, string> = {
    'Content-Type':        'text/plain; charset=utf-8',
    'X-Neuro-Score':       String(bestScore),
    'X-Neuro-Grade':       bestScore >= 85 ? 'A' : bestScore >= 70 ? 'B' : bestScore >= 55 ? 'C' : bestScore >= 40 ? 'D' : 'F',
    'X-Neuro-Iterations':  String(iterations),
  }

  // Actually just return the draft directly as a stream (avoid double-LLM)
  const encoder = new TextEncoder()
  const stream  = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(draft))
      controller.close()
    },
  })

  return new Response(stream, { headers })
}

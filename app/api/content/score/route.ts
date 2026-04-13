/**
 * POST /api/content/score
 *
 * Scores content against 12 neuro-engagement principles using Claude.
 *
 * Body: { content: string }
 * Response: ContentScore JSON
 */

import { NextRequest } from 'next/server'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { buildScoringPrompt, NEURO_PRINCIPLES } from '@/lib/neuro-content'
import type { ContentScore, PrincipleScore } from '@/lib/neuro-content'

export const runtime = 'nodejs'

function computeGrade(score: number): ContentScore['grade'] {
  if (score >= 85) return 'A'
  if (score >= 70) return 'B'
  if (score >= 55) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 20, window: '1 m', prefix: 'content-score' })
  if (!rl.success) return rateLimitResponse(rl)

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json() as { content?: string }

  if (!body.content?.trim()) {
    return new Response(JSON.stringify({ error: 'content is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const prompt = buildScoringPrompt(body.content)

  try {
    const { text } = await generateText({
      model:            anthropic('claude-sonnet-4-6'),
      prompt,
      maxOutputTokens:  1200,
      temperature:      0.2,
    })

    // Parse JSON response
    let parsed: {
      principles: Array<{
        principleId:   string
        principleName: string
        score:         number
        rationale:     string
        improvement:   string
      }>
      topStrengths:  string[]
      topWeaknesses: string[]
      suggestions:   string[]
    }

    try {
      parsed = JSON.parse(text.trim())
    } catch {
      // Try to extract JSON from response
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('Could not parse scoring response')
      parsed = JSON.parse(match[0])
    }

    // Validate and fill in any missing principles
    const principleMap = new Map(parsed.principles.map(p => [p.principleId, p]))

    const principles: PrincipleScore[] = NEURO_PRINCIPLES.map(np => {
      const scored = principleMap.get(np.id)
      return {
        principleId:   np.id,
        principleName: np.name,
        score:         scored?.score         ?? 0,
        rationale:     scored?.rationale     ?? 'Not scored',
        improvement:   scored?.improvement   ?? '',
      }
    })

    const overallScore = Math.round(
      principles.reduce((sum, p) => sum + p.score, 0) / principles.length
    )

    const score: ContentScore = {
      overallScore,
      grade:        computeGrade(overallScore),
      principles,
      topStrengths:  parsed.topStrengths  ?? [],
      topWeaknesses: parsed.topWeaknesses ?? [],
      suggestions:   parsed.suggestions   ?? [],
      wordCount:     body.content.trim().split(/\s+/).length,
    }

    return new Response(JSON.stringify(score), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[content/score]', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? 'Scoring failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

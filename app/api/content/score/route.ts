/**
 * POST /api/content/score
 *
 * Scores content against 12 neuro-engagement principles using Claude.
 *
 * Body: { content: string }
 * Response: ContentScore JSON
 */

import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { buildScoringPrompt, NEURO_PRINCIPLES } from '@/lib/neuro-content'
import { callClaude } from '@/lib/claw/llm'
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
  // B2 — auth + per-user rate limit + audit
  const { userId } = await auth()
  if (!userId) return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401, headers: { 'Content-Type': 'application/json' },
  })

  const rl = await rateLimit(req, { limit: 20, window: '1 m', prefix: 'content-score', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  audit(req, { action: 'content.score', resource: 'content', userId })

  const body = await req.json() as { content?: string }

  if (!body.content?.trim()) {
    return new Response(JSON.stringify({ error: 'content is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const prompt = buildScoringPrompt(body.content)

  try {
    const llm = await callClaude({
      userId,
      prompt,
      model:           'claude-sonnet-4-6',
      sessionTag:      'content-score',
      maxOutputTokens: 1200,
      temperature:     0.2,
    })
    if (llm.error || !llm.text) {
      throw new Error(llm.error ?? 'Claude returned empty text')
    }
    const text = llm.text

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

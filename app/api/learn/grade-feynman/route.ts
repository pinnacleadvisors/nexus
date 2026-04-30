/**
 * POST /api/learn/grade-feynman
 * Body: { cardId, explanation }
 *
 * Asks Claude Haiku to grade the user's free-text explanation against the
 * source atom. Returns a 0–100 score, qualitative feedback, and a suggested
 * ReviewRating the UI can pre-fill on the rating bar. Rate-limited 1 / minute
 * per user — Feynman cards are the only Claude call in the hot path.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import type { ReviewRating } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 30

interface Body {
  cardId: string
  explanation: string
}

interface GraderResponse {
  score: number
  feedback: string
  suggestedRating: ReviewRating
}

const SYSTEM_PROMPT = `You grade flashcard explanations for the Feynman Technique.
Score 0–100 based on:
- Accuracy (50%) — does the explanation match the reference?
- Completeness (25%) — does it cover the key claims?
- Clarity (25%) — is it concrete and self-contained?

Output STRICT JSON only:
{"score": <0-100>, "feedback": "<one or two sentences>", "suggestedRating": "again"|"hard"|"good"|"easy"}

Rating mapping:
- score >= 85 -> "easy"
- score >= 70 -> "good"
- score >= 50 -> "hard"
- score <  50 -> "again"`

function fallback(): GraderResponse {
  return { score: 50, feedback: 'Grader unavailable; rate yourself manually.', suggestedRating: 'good' }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const result = await rateLimit(req, { limit: 1, window: '1 m' })
  if (!result.success) return rateLimitResponse(result)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 })
  }
  if (!body.cardId || typeof body.explanation !== 'string' || body.explanation.trim().length < 10) {
    return NextResponse.json({ error: 'explanation-too-short' }, { status: 400 })
  }

  const sb = createServerClient()
  if (!sb) return NextResponse.json(fallback())

  type Loose = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  const db = sb as unknown as Loose

  const cardResp = await db.from('flashcards')
    .select('id, atom_slug, front, back, reference_context')
    .eq('id', body.cardId)
    .eq('user_id', userId)
    .maybeSingle()
  const card = cardResp.data as null | {
    id: string
    atom_slug: string
    front: string
    back: string
    reference_context: string | null
  }
  if (!card) return NextResponse.json({ error: 'card-not-found' }, { status: 404 })

  // Pull neighbouring atoms from the molecular mirror for richer context.
  const neighborsResp = await db.from('mol_atoms')
    .select('title, body_md')
    .neq('slug', card.atom_slug)
    .limit(3)
  const neighbors = (neighborsResp.data ?? []) as Array<{ title: string; body_md: string }>

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json(fallback())

  try {
    const { generateText } = await import('ai')
    const { anthropic } = await import('@ai-sdk/anthropic')

    const reference = card.reference_context ?? card.back
    const neighborText = neighbors
      .map(n => `- ${n.title}: ${n.body_md.split('\n').filter(Boolean)[1] ?? ''}`)
      .join('\n')

    const prompt = `Card front: ${card.front}\n\nReference fact:\n${reference}\n\nRelated context:\n${neighborText}\n\nUser's explanation:\n${body.explanation}\n\nReturn JSON only.`

    const res = await generateText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 300,
    })

    const text = (res.text ?? '').trim()
    const json = text.match(/\{[\s\S]*\}/)?.[0]
    if (!json) return NextResponse.json(fallback())
    const parsed = JSON.parse(json) as Partial<GraderResponse>
    if (typeof parsed.score !== 'number' || !parsed.suggestedRating) return NextResponse.json(fallback())
    return NextResponse.json({
      score: Math.max(0, Math.min(100, Math.round(parsed.score))),
      feedback: parsed.feedback ?? '',
      suggestedRating: parsed.suggestedRating,
    } satisfies GraderResponse)
  } catch (err) {
    console.error('[grade-feynman]', err)
    return NextResponse.json(fallback())
  }
}

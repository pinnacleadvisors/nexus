/**
 * POST /api/models/recommend-skill — model recommendation for a skill.
 *
 * Body: { slug, name, description, status }
 *
 * Re-uses the existing recommender machinery but with a skill-shaped
 * prompt: instead of "given this agent's mission, pick a model",
 * "given this skill's job, pick a model that's good at executing it
 * cheaply and reliably".
 *
 * Cost is the same as agent-recommend (~$0.0008 at sonnet, ~$0.0002
 * at haiku via RECOMMENDER_MODEL_ID override). Operator-only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { recommendModelForAgent } from '@/lib/models/recommender'
import { detectAvailableProviders } from '@/lib/models/providers'
import type { AiProviderKey } from '@/lib/models/types'

export const runtime = 'nodejs'
export const maxDuration = 30

interface RecommendBody {
  slug?:        string
  name?:        string
  description?: string
  status?:      string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 10, window: '1 m', prefix: 'models:recommend-skill' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as RecommendBody
  const slug = String(body.slug ?? '').trim()
  if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid_slug' })
  }
  const name        = String(body.name ?? slug).trim()
  const description = String(body.description ?? '').trim()

  // Synthesise the recommender's expected agent-shape from the skill.
  // Skills are scoped to one job; describe that job as the agent's
  // mission. capabilities + tools are blank; the LLM judges from the
  // description.
  let availableProviders: AiProviderKey[] = []
  try {
    availableProviders = await detectAvailableProviders(g.userId)
  } catch {
    // Fall through with empty; recommender's static fallback handles
    // zero-providers gracefully via getAvailableModels.
  }

  try {
    const rec = await recommendModelForAgent(g.userId, {
      agent: {
        slug,
        name:         `skill: ${name}`,
        description:  description || `Reusable skill at .claude/skills/${slug}/SKILL.md`,
        tools:        [],
        currentModel: '',
      },
      availableProviders,
    })
    return NextResponse.json({ ok: true, recommendation: rec })
  } catch (err) {
    return NextResponse.json({
      ok:    false,
      error: err instanceof Error ? err.message : 'recommendation failed',
    })
  }
}

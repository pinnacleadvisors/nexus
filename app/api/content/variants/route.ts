/**
 * POST /api/content/variants
 *
 * Generates 3 A/B variants of existing content, each emphasising a different
 * cognitive trigger (curiosity gap, loss aversion, social proof).
 *
 * Body: { content: string; format: FormatId; tone: ToneId }
 * Response: VariantsResponse JSON
 */

import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { getTemplate, getToneProfile } from '@/lib/neuro-content'
import { callClaude } from '@/lib/claw/llm'
import type { VariantsResponse, ContentVariant, FormatId, ToneId } from '@/lib/neuro-content'

export const runtime    = 'nodejs'
export const maxDuration = 120

const VARIANT_TRIGGERS = [
  {
    id:           'curiosity-gap',
    triggerFocus: 'Curiosity Gap',
    instruction:  'Rewrite this content to maximise curiosity gap. Every headline, hook, and transition should open an information gap the reader is compelled to close. Delay resolution. Make the reader feel like they\'re missing something crucial.',
  },
  {
    id:           'loss-aversion',
    triggerFocus: 'Loss Aversion',
    instruction:  'Rewrite this content framing everything as preventing loss rather than achieving gain. "Stop leaving X on the table." "Every day you wait, Y is happening." Make the cost of inaction vivid and specific.',
  },
  {
    id:           'social-proof',
    triggerFocus: 'Social Proof',
    instruction:  'Rewrite this content leading with specific social proof: named companies, precise numbers, real timeframes. Every claim should be anchored in what real people or organisations have achieved. Replace vague claims with "4,200 founders", "companies like X and Y", "$2.3M in 90 days".',
  },
]

export async function POST(req: NextRequest) {
  // B2 — auth + per-user rate limit + audit
  const { userId } = await auth()
  if (!userId) return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401, headers: { 'Content-Type': 'application/json' },
  })

  const rl = await rateLimit(req, { limit: 5, window: '1 m', prefix: 'content-variants', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  audit(req, { action: 'content.variants', resource: 'content', userId })

  const body = await req.json() as { content?: string; format?: FormatId; tone?: ToneId }

  if (!body.content?.trim()) {
    return new Response(JSON.stringify({ error: 'content is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const template = body.format ? getTemplate(body.format) : null
  const tone     = body.tone   ? getToneProfile(body.tone)  : null

  const formatContext = template
    ? `Format: ${template.name}\n${template.neuroGuidelines}`
    : ''

  const toneContext = tone
    ? `Tone: ${tone.name} — ${tone.tagline}\n${tone.voice.slice(0, 300)}`
    : ''

  // Generate all 3 variants in parallel
  const variantPromises = VARIANT_TRIGGERS.map(async (trigger) => {
    const prompt = `You are a master conversion copywriter specialising in cognitive neuroscience.

## Original Content
${body.content}

## Your Task
${trigger.instruction}

Preserve all key facts, messages, and the approximate length. Do NOT add meta-commentary.
Output ONLY the rewritten content, ready to publish.

${formatContext}
${toneContext}`

    const llm = await callClaude({
      userId,
      prompt,
      model:           'claude-sonnet-4-6',
      sessionTag:      `content-variants-${trigger.id}`,
      maxOutputTokens: 2000,
      temperature:     0.85,
    })
    if (llm.error || !llm.text) {
      throw new Error(llm.error ?? 'Claude returned empty text')
    }

    return {
      id:           trigger.id,
      triggerFocus: trigger.triggerFocus,
      content:      llm.text.trim(),
    } satisfies ContentVariant
  })

  try {
    const variants = await Promise.all(variantPromises)

    const response: VariantsResponse = {
      variants,
      original: body.content,
    }

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[content/variants]', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? 'Variant generation failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

/**
 * POST /api/skills/describe — classify a free-form "create a skill" request.
 *
 * Settings → Skills has a Connectors-style "Create" card. The operator types
 * e.g. "a skill that computes MRR from a Stripe export". We classify the prose
 * and file an operator_tasks row that hands the brief to the skill-trainer flow
 * (which proposes code, runs it in the sandbox, grades it, and writes a
 * .claude/skills/<name>/SKILL.md with status: draft for operator promotion).
 * We never auto-write SKILL.md here — the draft→verified gate stays intact.
 *
 * Retry-storm safe: always 200 + {ok:false} on classification failure.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { generateText } from 'ai'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getLlm } from '@/lib/llm/provider'
import { createTask } from '@/lib/views/tasks'
import { cacheWrap } from '@/lib/agents/cache'

export const runtime     = 'nodejs'
export const maxDuration = 20

interface DescribeBody { description?: string }
interface Classified {
  kind:       'skill' | 'manual'
  name?:      string
  slug?:      string
  intent?:    string
  reasoning?: string
}

const SYSTEM_PROMPT = `You classify an operator's request to create a new reusable SKILL for an automation platform. A skill is a small, evaluable procedure the agent layer can invoke as /<slug> (e.g. "compute MRR from a Stripe export", "scrape a Shopify product page").

Reply with a single JSON object, no markdown fences:
  { "kind": "skill" | "manual", "name": "<Title Case skill name>" | null, "slug": "<kebab-case-slug>" | null, "intent": "<one sentence success criteria>" | null, "reasoning": "<short>" }

Rules:
- kind="skill" when the request describes a concrete, testable procedure.
- kind="manual" when vague, not a procedure, or needs operator clarification.
- slug: lowercase, hyphens only, derived from the name.
- Never include backticks or markdown fences.`

function parseJson(text: string): Classified {
  // Extract the first balanced {...} object — tolerant of ```json fences,
  // trailing newlines, and any prose the model adds around the JSON.
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in model output')
  const obj = JSON.parse(text.slice(start, end + 1)) as Classified
  if (obj.kind !== 'skill' && obj.kind !== 'manual') obj.kind = 'manual'
  return obj
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = await rateLimit(req, { limit: 15, window: '1 m', prefix: 'skills:describe' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: DescribeBody = {}
  try { body = await req.json() } catch { /* validated below */ }
  const description = (body.description ?? '').trim()
  if (description.length < 4) return NextResponse.json({ ok: false, error: 'description too short' }, { status: 400 })

  let classified: Classified
  try {
    classified = await cacheWrap<Classified>(
      'skills-describe',
      { description: description.toLowerCase() },
      async () => {
        const res = await generateText({
          model:  getLlm(),
          system: SYSTEM_PROMPT,
          prompt: `Operator request:\n"""${description}"""\n\nReply with the classification JSON only.`,
          temperature: 0,
        })
        return parseJson(res.text)
      },
      { ttlMinutes: 60 * 24 },
    )
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'classification failed' })
  }

  const isSkill = classified.kind === 'skill' && Boolean(classified.name)
  const title = isSkill
    ? `Train skill: ${classified.name}`
    : `Clarify skill request: ${description.slice(0, 80)}`
  const taskBody = isSkill
    ? `Operator asked for a skill.\n\nName: ${classified.name}\nSlug: ${classified.slug ?? '(derive)'}\nSuccess criteria: ${classified.intent ?? description}\n\nHand to the skill-trainer: propose code, run in the sandbox, grade until 3 consecutive passes, write .claude/skills/${classified.slug ?? '<slug>'}/SKILL.md with status: draft. Operator promotes from Settings → Skills.`
    : `Operator request was ambiguous: "${description}". ${classified.reasoning ?? 'Clarify the success criteria, then train or decline.'}`

  const task = await createTask({ userId: session.userId, scope: 'admin', title, description: taskBody, source: 'operator' })
  if (!task) return NextResponse.json({ ok: false, error: 'could not file the request (operator_tasks insert failed)' })

  return NextResponse.json({
    ok:      true,
    kind:    isSkill ? 'skill' : 'manual',
    name:    classified.name ?? null,
    slug:    classified.slug ?? null,
    taskId:  task.id,
    message: isSkill
      ? `Filed "${classified.name}" for the skill-trainer — see your Inbox.`
      : 'Filed as a to-do to clarify — see your Inbox.',
  })
}

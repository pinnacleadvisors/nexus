/**
 * POST /api/agents/describe — classify a free-form "create an agent" request.
 *
 * Settings → Agents has a Connectors-style "Create" card. The operator types
 * e.g. "an agent that drafts weekly LinkedIn posts". We classify the prose and
 * file an operator_tasks row that hands the brief to the agent-generator flow
 * (docs/agents/GENERATION_PROTOCOL.md → .claude/agents/<slug>.md + agent_library
 * row + memory seed). v1 files the brief rather than auto-scaffolding so the
 * generation protocol's review gate stays intact (B1 follow-up: client POSTs the
 * stub straight to /api/agents for the lightest path).
 *
 * Retry-storm safe: always 200 + {ok:false} on classification failure so the
 * card's optimistic UI never 5xx-loops the route.
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
  kind:        'agent' | 'manual'
  name?:       string
  slug?:       string
  description?: string
  reasoning?:  string
}

const SYSTEM_PROMPT = `You classify an operator's request to create a new managed AGENT for an automation platform.

Reply with a single JSON object, no markdown fences:
  { "kind": "agent" | "manual", "name": "<Title Case agent name>" | null, "slug": "<kebab-case-slug>" | null, "description": "<one sentence of what the agent does>" | null, "reasoning": "<short>" }

Rules:
- kind="agent" when the request clearly describes a reusable agent role ("an agent that drafts weekly LinkedIn posts" -> name "LinkedIn Post Drafter", slug "linkedin-post-drafter").
- kind="manual" when it's vague, not actually an agent, or needs operator clarification.
- slug: lowercase, hyphens only, derived from the name.
- Never include backticks or markdown fences.`

function parseJson(text: string): Classified {
  // Extract the first balanced {...} object — tolerant of ```json fences,
  // trailing newlines, and any prose the model adds around the JSON.
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in model output')
  const obj = JSON.parse(text.slice(start, end + 1)) as Classified
  if (obj.kind !== 'agent' && obj.kind !== 'manual') obj.kind = 'manual'
  return obj
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = await rateLimit(req, { limit: 15, window: '1 m', prefix: 'agents:describe' })
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
      'agents-describe',
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

  const isAgent = classified.kind === 'agent' && Boolean(classified.name)
  const title = isAgent
    ? `Scaffold agent: ${classified.name}`
    : `Clarify agent request: ${description.slice(0, 80)}`
  const taskBody = isAgent
    ? `Operator asked for an agent.\n\nName: ${classified.name}\nSlug: ${classified.slug ?? '(derive)'}\nDescription: ${classified.description ?? description}\n\nHand to the agent-generator (docs/agents/GENERATION_PROTOCOL.md): emit .claude/agents/${classified.slug ?? '<slug>'}.md + upsert agent_library + seed memory.`
    : `Operator request was ambiguous: "${description}". ${classified.reasoning ?? 'Clarify what the agent should do, then scaffold or decline.'}`

  const task = await createTask({ userId: session.userId, scope: 'admin', title, description: taskBody, source: 'operator' })
  if (!task) return NextResponse.json({ ok: false, error: 'could not file the request (operator_tasks insert failed)' })

  return NextResponse.json({
    ok:      true,
    kind:    isAgent ? 'agent' : 'manual',
    name:    classified.name ?? null,
    slug:    classified.slug ?? null,
    taskId:  task.id,
    message: isAgent
      ? `Filed "${classified.name}" for the agent-generator — see your Inbox.`
      : 'Filed as a to-do to clarify — see your Inbox.',
  })
}

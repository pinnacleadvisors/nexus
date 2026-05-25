/**
 * POST /api/views/tasks/:id/explain — generate an in-depth setup guide for one task.
 *
 * Drives the "Explain" button on every manual to-do row in the inbox. The
 * first call to a given task asks the active LLM for a step-by-step setup
 * walkthrough rooted in the task's title + description, then caches the
 * result on `operator_tasks.explanation` (migration 059). Subsequent calls
 * return the cached payload for free.
 *
 * Body (optional):
 *   { force?: boolean }  — set to bypass the cache and regenerate.
 *
 * Response:
 *   { ok, explanation, cached, generated_at }
 *
 * Retry-storm safe: returns 200 + ok:false on transient LLM errors. The
 * operator can click Explain again without the route flashing red.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { generateText } from 'ai'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getLlm } from '@/lib/llm/provider'
import { getTaskById, setTaskExplanation } from '@/lib/views/tasks'

export const runtime     = 'nodejs'
export const maxDuration = 30

interface ExplainResponse {
  ok:            boolean
  explanation?:  string
  cached?:       boolean
  generated_at?: string | null
  error?:        string
}

interface ExplainBody { force?: boolean }

const SYSTEM_PROMPT = `You write concise, actionable setup guides for the operator of an automation platform.

Given a single to-do, return a markdown guide that walks through exactly how to complete it. Cover:

1. **Where to go** — the current dashboard URL or app screen (use the platform's most recent UI conventions).
2. **What to click / type** — the precise sequence of buttons, menu items, and CLI commands. Include actual command strings when possible.
3. **Where to put the result** — if a credential, env var name, or file path needs to land somewhere specific, name it. If the task is about Nexus itself, mention the file under \`lib/oauth/providers.ts\`, \`lib/businesses/mcp-manifest.ts\`, or \`docs/runbooks/\` that the operator should edit.
4. **How to verify** — one quick check to confirm the task is actually done.

Rules:
- Use \`## \`, \`### \`, \`- \`, and inline \`code\` markdown — render-safe.
- Keep it under ~400 words. Skip filler.
- If anything is genuinely ambiguous, say so explicitly in a final "## Open questions" section — don't guess.
- Do not wrap the entire reply in a markdown fence.`

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse<ExplainResponse>> {
  const rl = await rateLimit(req, { limit: 20, window: '1 m', prefix: 'views:tasks:explain' })
  if (!rl.success) return rateLimitResponse(rl) as NextResponse<ExplainResponse>

  const session = await auth()
  if (!session.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 })

  let body: ExplainBody = {}
  try { body = await req.json() } catch { /* allow empty body */ }
  const force = body.force === true

  const task = await getTaskById(session.userId, id)
  if (!task) return NextResponse.json({ ok: false, error: 'task not found' }, { status: 404 })

  // Cache hit — no LLM cost.
  if (!force && task.explanation && task.explanation.trim().length > 0) {
    return NextResponse.json({
      ok:           true,
      explanation:  task.explanation,
      cached:       true,
      generated_at: task.explanation_generated_at,
    })
  }

  const prompt = [
    `Task title: ${task.title}`,
    task.description ? `Task description: ${task.description}` : null,
    `Scope: ${task.scope}`,
    `Source: ${task.source}`,
    '',
    'Write the setup guide.',
  ].filter(Boolean).join('\n')

  let explanation: string
  try {
    const res = await generateText({
      model:  getLlm(),
      system: SYSTEM_PROMPT,
      prompt,
      // Slightly creative — the guide gains from a bit of phrasing variation
      // without compromising accuracy.
      temperature: 0.2,
    })
    explanation = (res.text ?? '').trim()
    if (explanation.length === 0) throw new Error('llm returned empty guide')
  } catch (e) {
    // 200 + ok:false keeps the UI inline-error-friendly. The operator can
    // tap Explain again without the dropdown collapsing.
    return NextResponse.json({
      ok:    false,
      error: e instanceof Error ? e.message : 'guide generation failed',
    }, { status: 200 })
  }

  const saved = await setTaskExplanation(session.userId, id, explanation)
  return NextResponse.json({
    ok:           true,
    explanation,
    cached:       false,
    generated_at: saved?.explanation_generated_at ?? new Date().toISOString(),
  })
}

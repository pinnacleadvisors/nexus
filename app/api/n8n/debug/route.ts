/**
 * POST /api/n8n/debug
 *
 * Runs a single n8n-debugger pass on a malformed workflow. Caps internal
 * iterations at 3 — beyond that, the caller (typically the n8n generation
 * UI or a manual "Try fix" button) should file a Board card with the
 * remaining errors and ask the human to intervene.
 *
 * Body:
 *   { workflow: N8nWorkflow, errors?: string[], warnings?: string[], iteration?: number }
 *
 * Response 200:
 *   { ok: true, workflow, fixedErrors[], remainingErrors[], iteration, notes? }
 *
 * Response 4xx/5xx:
 *   { ok: false, error: string }
 *
 * The debugger agent runs in a Claude Code session via the gateway — its
 * spec is at .claude/agents/n8n-debugger.md.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { resolveClawConfig } from '@/lib/claw/business-client'
import { runWorkflowTest } from '@/lib/n8n/execute-test'
import { validateWorkflow } from '@/lib/n8n/validate'
import type { N8nWorkflow } from '@/lib/n8n/types'

export const runtime    = 'nodejs'
export const maxDuration = 60

const MAX_ITERATIONS = 3

interface DebugBody {
  workflow:  N8nWorkflow
  errors?:   string[]
  warnings?: string[]
  iteration?: number
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 10, window: '1 m', prefix: 'n8n-debug' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: DebugBody
  try { body = (await req.json()) as DebugBody } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body.workflow || typeof body.workflow !== 'object') {
    return NextResponse.json({ error: 'workflow required' }, { status: 400 })
  }

  const iteration = Math.max(1, Math.min(MAX_ITERATIONS, body.iteration ?? 1))

  // Re-derive errors from the current workflow if the caller didn't pass
  // them — a fresh debug request from the UI typically only carries the
  // workflow.
  const validation = validateWorkflow(body.workflow)
  const errors   = body.errors   ?? validation.errors
  const warnings = body.warnings ?? validation.warnings

  if (errors.length === 0) {
    return NextResponse.json({
      ok:              true,
      workflow:        body.workflow,
      fixedErrors:     [],
      remainingErrors: [],
      iteration,
      notes:           'Workflow already valid — no debugger run needed.',
    })
  }

  if (iteration > MAX_ITERATIONS) {
    return NextResponse.json({
      ok:              false,
      workflow:        body.workflow,
      fixedErrors:     [],
      remainingErrors: errors,
      iteration,
      notes:           `Hit max iterations (${MAX_ITERATIONS}). File a Board card and have a human review.`,
    })
  }

  const config = await resolveClawConfig(session.userId)
  if (!config) {
    return NextResponse.json({
      ok:    false,
      error: 'No Claude gateway configured — set CLAUDE_CODE_GATEWAY_URL or business gateway in user_secrets',
    }, { status: 503 })
  }

  // The dispatch sends the workflow + errors as inputs.{workflow,errors,warnings,iteration}.
  // n8n-debugger.md spec describes how the agent loops on its own up to 3
  // internal passes; one HTTP dispatch returns the final patched workflow.
  const dispatchUrl = `${config.gatewayUrl.replace(/\/$/, '')}/api/sessions/${encodeURIComponent(`nexus-debug-${Date.now()}`)}/messages`
  const message = [
    'You are the n8n-debugger. Patch the workflow below.',
    '',
    `Iteration: ${iteration}/${MAX_ITERATIONS}`,
    '',
    `Errors (${errors.length}):`,
    ...errors.map(e => `  - ${e}`),
    warnings.length ? `\nWarnings (${warnings.length}):\n${warnings.map(w => `  - ${w}`).join('\n')}` : '',
    '',
    'Workflow JSON:',
    JSON.stringify(body.workflow, null, 2),
    '',
    'Return ONLY the JSON response specified in your spec — { ok, workflow, fixedErrors, remainingErrors, iteration, notes }.',
  ].filter(Boolean).join('\n')

  let agentResponse: string
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 50_000)
    const res = await fetch(dispatchUrl, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${config.bearerToken}`,
      },
      body:   JSON.stringify({ role: 'user', content: message, agent: 'n8n-debugger' }),
      signal: ac.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json({ ok: false, error: `gateway returned ${res.status}: ${text.slice(0, 200)}` }, { status: 502 })
    }
    const json = await res.json() as { content?: string }
    agentResponse = json.content ?? ''
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'gateway call failed' }, { status: 502 })
  }

  // Parse the agent's JSON output. The spec mandates raw JSON, no markdown.
  let parsed: { ok: boolean; workflow: N8nWorkflow; fixedErrors?: string[]; remainingErrors?: string[]; notes?: string }
  try {
    // Tolerate fenced code blocks just in case.
    const cleaned = agentResponse.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '')
    parsed = JSON.parse(cleaned)
  } catch {
    return NextResponse.json({ ok: false, error: 'debugger returned non-JSON', raw: agentResponse.slice(0, 500) }, { status: 502 })
  }

  // Verify the patched workflow.
  const verify = await runWorkflowTest(parsed.workflow)

  audit(req, {
    action:   'n8n.debug',
    resource: 'workflow',
    userId:   session.userId,
    metadata: {
      iteration,
      errorsBefore:    errors.length,
      errorsAfter:     verify.structural.errors.length,
      schemaOk:        verify.schema?.ok,
      notes:           parsed.notes?.slice(0, 200),
    },
  })

  return NextResponse.json({
    ok:              verify.ok && (parsed.ok !== false),
    workflow:        parsed.workflow,
    fixedErrors:     parsed.fixedErrors ?? [],
    remainingErrors: verify.structural.errors,
    schemaError:     verify.schema?.error,
    iteration,
    notes:           parsed.notes,
  })
}

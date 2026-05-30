/**
 * POST /api/loops/[id]/start — kick off the next Loop iteration.
 *
 * Dispatches the Loop's delegated agent (default `loop-runner`) through the
 * EXISTING claude-gateway via /api/claude-session/dispatch — NO new runtime.
 * Persists a `loop_iterations` row (outcome='running') and hands the agent a
 * scoped callback token to POST its result back to
 * /api/loops/[id]/iteration-result.
 *
 * Cost-aware (Ralph-loop invariant): checkKillSwitch(business_slug) +
 * assertUnderCostCap before dispatch. Refuses if the loop isn't active.
 *
 * Fail-soft: if the gateway is unconfigured / unreachable (e.g. local dev),
 * the dispatch returns pending and this route still records the iteration and
 * returns 200 {ok:true, pending:true} — never 5xx (retry-storm rule; the
 * dashboard "Start" button and any scheduler call this).
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { assertUnderCostCap, checkKillSwitch } from '@/lib/cost-guard'
import { getInternalBaseUrl } from '@/lib/internal-fetch'
import { getLoopWithIterations, insertIteration, nextIterationN } from '@/lib/loops/store'
import { buildLoopCallbackToken } from '@/lib/loops/callback'

export const runtime    = 'nodejs'
export const maxDuration = 45

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEFAULT_TOOLS = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch']

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: 'invalid loop id' })

  let body: { userId?: string } = {}
  try { body = (await req.json()) as typeof body } catch { /* empty body ok */ }

  const a = await authenticateOps(req, { bodyUserId: body.userId })
  if ('response' in a) return a.response

  const loaded = await getLoopWithIterations(id, a.userId)
  if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error })
  if (!loaded.loop) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  const loop = loaded.loop

  if (loop.status !== 'active') {
    return NextResponse.json({ ok: false, error: `loop_not_active`, status: loop.status })
  }

  // ── Cost gates (Ralph-loop invariant) ────────────────────────────────────
  if (loop.business_slug) {
    const kill = await checkKillSwitch(loop.business_slug)
    if (kill.kill) return NextResponse.json({ ok: false, error: 'kill_switch', reason: kill.reason })
  }
  const cap = await assertUnderCostCap(a.userId, loop.business_slug)
  if (!cap.ok) {
    return NextResponse.json({ ok: false, error: 'cost_cap_exceeded', spentUsd: cap.spentUsd, capUsd: cap.capUsd, scope: cap.scope })
  }

  const spentUsd = loaded.iterations.reduce((s, it) => s + (it.cost_usd ?? 0), 0)
  if (loop.iteration_cap !== null && loaded.iterations.length >= loop.iteration_cap) {
    return NextResponse.json({ ok: false, error: 'iteration_cap_reached', iterations: loaded.iterations.length, cap: loop.iteration_cap })
  }

  // ── Persist the iteration row (outcome='running') ─────────────────────────
  const iterationN = await nextIterationN(id)
  const ins = await insertIteration(id, iterationN, { iteration_plan_id: `loop-${id}-i${iterationN}` })
  if (!ins.ok) return NextResponse.json({ ok: false, error: ins.error })

  // ── Build the scoped callback + dispatch brief ────────────────────────────
  const base = getInternalBaseUrl()
  const nonce = randomBytes(12).toString('hex')
  const token = buildLoopCallbackToken(id, nonce)
  const callbackUrl = `${base}/api/loops/${encodeURIComponent(id)}/iteration-result?nonce=${nonce}`
  const remaining = loop.cost_cap_usd !== null ? Math.max(0, loop.cost_cap_usd - spentUsd) : null

  const brief = [
    `Run iteration ${iterationN} of the Loop "${loop.name}" (mode=${loop.mode}).`,
    `Follow the loop-runner spec at .claude/agents/loop-runner.md.`,
    ``,
    `## North Star`,
    loop.north_star_md || '(none provided)',
    ``,
    `## End-outcome predicate`,
    loop.end_outcome_md || '(none provided)',
    ``,
    `## Bounds`,
    `- cost: spent $${spentUsd.toFixed(4)}${loop.cost_cap_usd !== null ? ` of $${loop.cost_cap_usd} cap (remaining $${remaining})` : ' (no cap)'}`,
    `- iteration: ${iterationN}${loop.iteration_cap !== null ? ` of ${loop.iteration_cap}` : ' (no cap)'}`,
    `- time cap: ${loop.time_cap_hours !== null ? `${loop.time_cap_hours}h` : 'none'}`,
    `- approval gates: ${loop.approval_gates.length ? loop.approval_gates.join(', ') : 'none'}`,
    loop.mode === 'synthesize'
      ? `- synthesize: explorer_model=${loop.explorer_model ?? '(unset)'}, verifier_model=${loop.verifier_model ?? '(unset)'}, review_modality=${loop.review_modality ?? 'code'}`
      : ``,
    ``,
    `## Protocol`,
    `1. Emit an \`iteration-plan\` fenced block (approval_id "loop-${id}-i${iterationN}"). Wait for operator approval before acting.`,
    `2. Run only the approved items.`,
    `3. POST your result to: ${callbackUrl}`,
    `   Header: Authorization: Bearer <the callback_token in inputs>`,
    `   Body: { "iteration_n": ${iterationN}, "outcome": "success|partial|error|cancelled", "summary_md": "...", "cost_usd": 0, "gateway_turn_ids": [] }`,
    `   The response's "instruction" tells you to continue / stop / await-approval.`,
  ].filter(Boolean).join('\n')

  const dispatchBody = {
    agentSlug:    loop.delegated_agent_slug,
    capabilityId: 'consultant',
    ...(loop.business_slug ? { businessSlug: loop.business_slug } : {}),
    inputs: {
      task:            brief,
      tools:           DEFAULT_TOOLS,
      loop_id:         id,
      mode:            loop.mode,
      iteration_n:     iterationN,
      callback_url:    callbackUrl,
      callback_token:  token,
      explorer_model:  loop.explorer_model,
      verifier_model:  loop.verifier_model,
      review_modality: loop.review_modality,
      cost_cap_usd:    loop.cost_cap_usd,
      cost_spent_usd:  spentUsd,
    },
  }

  // Dispatch through the existing gateway. Forward the operator cookie so the
  // dispatch route's Clerk-session auth resolves. Fail-soft to pending.
  let pending = false
  let sessionId: string | undefined
  try {
    const res = await fetch(`${base}/api/claude-session/dispatch`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers.get('cookie') ? { cookie: req.headers.get('cookie') as string } : {}),
      },
      body:   JSON.stringify(dispatchBody),
      signal: AbortSignal.timeout(20_000),
    })
    const dj = (await res.json().catch(() => ({}))) as { ok?: boolean; pending?: boolean; sessionId?: string; error?: string }
    if (!res.ok || dj.ok === false) {
      pending = true
    } else {
      pending = Boolean(dj.pending)
      sessionId = dj.sessionId
    }
  } catch {
    pending = true
  }

  return NextResponse.json({ ok: true, loop_id: id, iteration_n: iterationN, iteration_id: ins.id, pending, sessionId })
}

/**
 * POST /api/loops/[id]/iteration-result — the loop-runner's per-iteration
 * callback. Resolves the running iteration (outcome + summary + spend +
 * gateway_turn_ids) and returns the next instruction (continue / stop /
 * await-approval) computed from the Loop's bounds.
 *
 * Auth (either):
 *   1. Scoped HMAC callback token — `?nonce=` + `Authorization: Bearer <token>`
 *      (or body.callback_token). Minted by /start; verified per-loop. This is
 *      the path the agent uses — no NEXUS_OPS_TOKEN needed in the gateway.
 *   2. authenticateOps (Clerk session / ops bearer) — operator / scripts.
 *
 * 200 + {ok:false} on transient failure (the agent auto-retries) — never 5xx.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { checkKillSwitch } from '@/lib/cost-guard'
import { getLoopByIdService, getLoopWithIterations, resolveIteration } from '@/lib/loops/store'
import { verifyLoopCallbackToken } from '@/lib/loops/callback'
import { decideNextInstruction } from '@/lib/loops/decide'
import type { Loop, LoopIteration, LoopIterationResultInput, LoopIterationOutcome } from '@/lib/loops/types'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TERMINAL: LoopIterationOutcome[] = ['success', 'partial', 'error', 'cancelled']

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: 'invalid loop id' })

  let body: Partial<LoopIterationResultInput> & { userId?: string; callback_token?: string } = {}
  try { body = (await req.json()) as typeof body } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' })
  }

  // ── Auth: scoped HMAC callback token first, then ops auth ─────────────────
  const url = new URL(req.url)
  const nonce = url.searchParams.get('nonce') ?? ''
  const header = req.headers.get('authorization') ?? ''
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  const token = bearer || body.callback_token || ''

  let loop: Loop | null = null
  let iterations: LoopIteration[] = []

  if (verifyLoopCallbackToken(id, nonce, token)) {
    const loaded = await getLoopByIdService(id)
    if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error })
    loop = loaded.loop; iterations = loaded.iterations
  } else {
    const a = await authenticateOps(req, { bodyUserId: body.userId })
    if ('response' in a) return a.response
    const loaded = await getLoopWithIterations(id, a.userId)
    if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error })
    loop = loaded.loop; iterations = loaded.iterations
  }

  if (!loop) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  // ── Validate the result ───────────────────────────────────────────────────
  const iterationN = typeof body.iteration_n === 'number' ? body.iteration_n : NaN
  if (!Number.isInteger(iterationN) || iterationN < 1) {
    return NextResponse.json({ ok: false, error: 'iteration_n must be a positive integer' })
  }
  const outcome = body.outcome
  if (!outcome || !TERMINAL.includes(outcome)) {
    return NextResponse.json({ ok: false, error: 'outcome must be success | partial | error | cancelled' })
  }

  const result: LoopIterationResultInput = {
    iteration_n:       iterationN,
    iteration_plan_id: body.iteration_plan_id ?? `loop-${id}-i${iterationN}`,
    scope:             typeof body.scope === 'string' ? body.scope : undefined,
    intent:            typeof body.intent === 'string' ? body.intent : undefined,
    outcome,
    summary_md:        typeof body.summary_md === 'string' ? body.summary_md : null,
    gateway_turn_ids:  Array.isArray(body.gateway_turn_ids) ? body.gateway_turn_ids.filter((s): s is string => typeof s === 'string') : undefined,
    cost_usd:          typeof body.cost_usd === 'number' && body.cost_usd >= 0 ? body.cost_usd : 0,
  }

  const resolved = await resolveIteration(id, result)
  if (!resolved.ok) return NextResponse.json({ ok: false, error: resolved.error })

  // ── Decide the next instruction ────────────────────────────────────────────
  const spentUsd = iterations
    .filter(it => it.iteration_n !== iterationN)
    .reduce((s, it) => s + (it.cost_usd ?? 0), 0) + (result.cost_usd ?? 0)
  const iterationsSoFar = Math.max(iterations.length, iterationN)

  let killSwitchFired = false
  if (loop.business_slug) {
    killSwitchFired = (await checkKillSwitch(loop.business_slug)).kill
  }

  const decision = decideNextInstruction({ loop, iterationsSoFar, spentUsd, killSwitchFired })

  return NextResponse.json({
    ok:           true,
    iteration_id: resolved.id,
    iteration_n:  iterationN,
    instruction:  decision.instruction,
    reason:       decision.reason,
    spent_usd:    spentUsd,
  })
}

/**
 * POST /api/sub-harnesses/[slug]/invoke — replay a VERIFIED sub-harness.
 *
 * The fast path (v2): run a crystallized harness directly, with NO
 * re-exploration. Dispatches the harness's agent_ref + tool manifest through
 * the EXISTING claude-gateway (no new runtime), the same primitive Loops use.
 *
 * THE GATE: refuses anything that isn't `status: verified` — the same gate the
 * skill router applies to un-promoted skills (isSubHarnessReplayable). A draft
 * (synthesized but not human-reviewed) or failed harness is NOT replayable.
 *
 * Auth: operator / agent via authenticateOps. Cost-gated (assertUnderCostCap).
 * 200 + {ok:false} on refusal / transient failure (callers auto-retry on 5xx).
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { assertUnderCostCap } from '@/lib/cost-guard'
import { getInternalBaseUrl } from '@/lib/internal-fetch'
import { getSubHarness } from '@/lib/harness/store'
import { isHarnessSlug, isSubHarnessReplayable } from '@/lib/harness/types'

export const runtime    = 'nodejs'
export const maxDuration = 45

interface InvokeBody {
  userId?: string
  /** Optional free-form input merged into the replay brief. */
  input?:  Record<string, unknown>
}

export async function POST(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  if (!isHarnessSlug(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid slug' }, { status: 400 })
  }

  let body: InvokeBody = {}
  try { body = (await req.json()) as InvokeBody } catch { /* empty body ok */ }

  const a = await authenticateOps(req, { bodyUserId: body.userId })
  if ('response' in a) return a.response

  const loaded = await getSubHarness(slug, a.userId)
  if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error })
  if (!loaded.harness) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  const harness = loaded.harness

  // ── THE GATE — verified only (same as the skill router) ───────────────────
  if (!isSubHarnessReplayable(harness.status)) {
    return NextResponse.json({
      ok:    false,
      error: 'not_verified',
      status: harness.status,
      hint:  `Promote it first: POST /api/sub-harnesses/${slug}/promote (human review gate).`,
    })
  }

  // ── Cost gate ──────────────────────────────────────────────────────────────
  const cap = await assertUnderCostCap(a.userId)
  if (!cap.ok) {
    return NextResponse.json({ ok: false, error: 'cost_cap_exceeded', spentUsd: cap.spentUsd, capUsd: cap.capUsd })
  }

  // ── Replay: dispatch the harness's agent + tool manifest through the gateway.
  // Fast path — no exploration. The manifest IS the strategy.
  const manifest = harness.manifest ?? { skills: [], agent_refs: [], tools: [], tests: [], review_spec: null }
  const agentSlug = (manifest.agent_refs && manifest.agent_refs[0]) || 'loop-runner'
  const tools = manifest.tools && manifest.tools.length >= 2 ? manifest.tools : ['Read', 'Bash']

  const brief = [
    `Replay the VERIFIED sub-harness "${slug}" — fast path, NO re-exploration. The manifest below is the proven strategy; execute it directly.`,
    ``,
    `## Goal`,
    harness.goal_md || '(see manifest)',
    ``,
    `## Manifest`,
    JSON.stringify(manifest, null, 2),
    body.input ? `\n## Input\n${JSON.stringify(body.input)}` : '',
  ].filter(Boolean).join('\n')

  const base = getInternalBaseUrl()
  const dispatchBody = {
    agentSlug,
    capabilityId: 'consultant',
    inputs: { task: brief, tools, sub_harness_slug: slug, replay: true },
  }

  let pending = false
  let sessionId: string | undefined
  try {
    const res = await fetch(`${base}/api/claude-session/dispatch`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...(req.headers.get('cookie') ? { cookie: req.headers.get('cookie') as string } : {}) },
      body:   JSON.stringify(dispatchBody),
      signal: AbortSignal.timeout(20_000),
    })
    const dj = (await res.json().catch(() => ({}))) as { ok?: boolean; pending?: boolean; sessionId?: string }
    if (!res.ok || dj.ok === false) pending = true
    else { pending = Boolean(dj.pending); sessionId = dj.sessionId }
  } catch {
    pending = true
  }

  return NextResponse.json({ ok: true, replayed: true, slug, agentSlug, pending, sessionId })
}

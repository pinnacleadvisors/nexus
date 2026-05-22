/**
 * POST /api/adapters/dispatch
 *
 * Adapter-routed dispatch endpoint — Paperclip absorption Task 4b integration.
 *
 * Takes { adapter_type, business_slug, agent_slug, inputs?, ancestry_prompt? },
 * resolves the adapter via lib/adapters/registry.ts, and calls adapter.invoke().
 * Returns the RunHandle.
 *
 * Parallel to (NOT a replacement for) the existing dispatch routes:
 *   - /api/claude-session/dispatch — direct Claude gateway dispatch
 *   - /api/n8n/dispatch            — direct n8n workflow dispatch
 *
 * Why parallel rather than in-place migration? Modifying the existing routes
 * is high-risk — they're heavily relied on by n8n + cron + the swarm
 * orchestrator. This new route lets the operator A/B test the adapter pattern
 * in production without touching the legacy code paths. When this proves out
 * (telemetry parity + no regressions), a follow-up PR can flip the legacy
 * routes to delegate here.
 *
 * Auth: Clerk + ALLOWED_USER_IDS — same as other operator-only routes.
 *
 * Retry-storm safe: 200 + {ok: false} on adapter errors so an auto-retrying
 * upstream (n8n, cron) doesn't storm a misconfigured adapter.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { resolveAdapter, listAdapterTypes } from '@/lib/adapters/registry'
import type { AdapterType, InvokeContext } from '@/lib/adapters/types'
import { assertUnderCostCap } from '@/lib/cost-guard'

export const runtime    = 'nodejs'
export const dynamic    = 'force-dynamic'
export const maxDuration = 30

function getAllowedUserIds(): Set<string> | null {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map(id => id.trim()).filter(Boolean))
}

function isOwner(userId: string): boolean {
  const allowed = getAllowedUserIds()
  if (!allowed) return true
  return allowed.has(userId)
}

interface Body {
  adapter_type:    string
  business_slug:   string
  agent_slug:      string
  issue_id?:       string | null
  goal_id?:        string | null
  ancestry_prompt?: string | null
  run_id?:         string | null
  inputs?:         Record<string, unknown>
}

function validateBody(b: unknown): { ok: true; body: Body } | { ok: false; error: string } {
  if (!b || typeof b !== 'object') return { ok: false, error: 'invalid_json' }
  const r = b as Record<string, unknown>
  if (typeof r.adapter_type  !== 'string' || r.adapter_type.length === 0)  return { ok: false, error: 'missing_adapter_type' }
  if (typeof r.business_slug !== 'string' || r.business_slug.length === 0) return { ok: false, error: 'missing_business_slug' }
  if (typeof r.agent_slug    !== 'string' || r.agent_slug.length === 0)    return { ok: false, error: 'missing_agent_slug' }
  // inputs is optional but must be a plain object when present
  if (r.inputs !== undefined && (typeof r.inputs !== 'object' || r.inputs === null || Array.isArray(r.inputs))) {
    return { ok: false, error: 'invalid_inputs' }
  }
  return {
    ok:   true,
    body: {
      adapter_type:    r.adapter_type as string,
      business_slug:   r.business_slug as string,
      agent_slug:      r.agent_slug as string,
      issue_id:        typeof r.issue_id === 'string' ? r.issue_id : null,
      goal_id:         typeof r.goal_id  === 'string' ? r.goal_id  : null,
      ancestry_prompt: typeof r.ancestry_prompt === 'string' ? r.ancestry_prompt : null,
      run_id:          typeof r.run_id          === 'string' ? r.run_id          : null,
      inputs:          (r.inputs ?? {}) as Record<string, unknown>,
    },
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  if (!isOwner(session.userId)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const rl = await rateLimit(req, {
    limit:      30,
    window:     '1 m',
    prefix:     'adapter:dispatch',
    identifier: session.userId,
  })
  if (!rl.success) return rateLimitResponse(rl)

  let parsed: unknown
  try { parsed = await req.json() } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }) }

  const v = validateBody(parsed)
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error, known_adapters: listAdapterTypes() }, { status: 400 })

  // Pre-dispatch cost gate — same hard ceiling as the legacy routes.
  const cap = await assertUnderCostCap(session.userId, v.body.business_slug)
  if (!cap.ok) {
    return NextResponse.json(
      { ok: false, error: 'cost_cap_tripped', scope: cap.scope, spent_usd: cap.spentUsd, cap_usd: cap.capUsd },
      { status: 402 },
    )
  }

  let adapter
  try {
    adapter = resolveAdapter(v.body.adapter_type as AdapterType)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'unknown_adapter', detail: err instanceof Error ? err.message : String(err), known_adapters: listAdapterTypes() },
      { status: 400 },
    )
  }

  const ctx: InvokeContext = {
    business_slug:   v.body.business_slug,
    user_id:         session.userId,
    agent_slug:      v.body.agent_slug,
    issue_id:        v.body.issue_id ?? null,
    goal_id:         v.body.goal_id ?? null,
    ancestry_prompt: v.body.ancestry_prompt ?? null,
    run_id:          v.body.run_id ?? null,
    inputs:          v.body.inputs ?? {},
  }

  try {
    const handle = await adapter.invoke(ctx)
    return NextResponse.json({ ok: true, handle })
  } catch (err) {
    // Retry-storm rule: don't 5xx on adapter-level errors; the upstream
    // dispatcher (cron, n8n, swarm) auto-retries on 5xx and would storm the
    // misconfigured adapter. Return 200 + structured error.
    return NextResponse.json(
      { ok: false, error: 'invoke_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    )
  }
}

export async function GET() {
  // Convenience — operator can curl /api/adapters/dispatch to discover what
  // adapter types are registered (sanity check for env config).
  const session = await auth()
  if (!session.userId || !isOwner(session.userId)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, adapters: listAdapterTypes() })
}

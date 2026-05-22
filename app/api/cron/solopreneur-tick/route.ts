/**
 * GET /api/cron/solopreneur-tick
 *
 * 4×/day Inngest-style Vercel cron entry point for the autonomous PDF
 * solopreneur experiment. Iterates every business whose money_model has
 * `experiment_flag === true` and dispatches the `solopreneur-loop` agent
 * once per business through the per-business Claude gateway.
 *
 * Expected schedule (configured in vercel.json by D4 — out of scope here):
 *   `0 9,12,15,21 * * *`  (UTC — 4 ticks per day)
 *
 * Per-business sequence:
 *   1. checkKillSwitch(slug) — cost-guard hard stop. If kill=true, write a
 *      `kill_switch_check` row to `experiment_metrics` and skip dispatch.
 *      If signal=auto_pivot_eligible, attach the signal to the dispatch
 *      payload so the agent proposes a pivot via the niche_pick gate.
 *   2. Resolve gate_state — last 30d of `gate_event` rows for the slug.
 *   3. Dispatch `solopreneur-loop` via the per-business claude-gateway
 *      (resolveClawConfig + callGateway). swarm:false at the loop level
 *      — the agent itself sets swarm:true on its own sub-dispatches.
 *   4. Write a `tick` row capturing dispatch outcome (ok/error, duration).
 *
 * Retry-storm rule (CLAUDE.md): per-business failures NEVER bubble up as
 * 5xx — the route always returns 200 with `{ok: false, errors: [...]}` on
 * partial failure. Cron / Inngest retry of a 5xx would multiply the Max-plan
 * spend across all businesses, not just the failed one.
 *
 * Idempotency: every emitted row carries the cron invocation id (from
 * Date.now() + a short random suffix) in payload.invocation_id so that a
 * duplicate Vercel-cron fire is detectable downstream — the rows still
 * exist, but the dashboard / ledger can dedupe by invocation_id.
 *
 * Query params:
 *   ?dryRun=true        — log intent only; no LLM dispatch. Tick rows still
 *                         get written with payload.dryRun=true so smoke
 *                         tests can verify the iteration end-to-end.
 *   ?businessSlug=foo   — restrict the iteration to one slug (for E1 smoke).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createServerClient } from '@/lib/supabase'
import { callGateway } from '@/lib/claw/gateway-call'
import { resolveClawConfig } from '@/lib/claw/business-client'
import { checkKillSwitch, type KillSwitchResult } from '@/lib/cost-guard'
import type { BusinessRow } from '@/lib/business/types'
import { claimIssue, releaseIssue } from '@/lib/issues/checkout'
import { getIssueAncestry, renderAncestryPrompt } from '@/lib/goals/ancestry'

/**
 * Phase 4 follow-up — when USE_ISSUE_CHECKOUT=1 (default off), each tick
 * tries to claim one pending issue from the new `issues` table (Phase 2
 * migration 048) before dispatch and walks its ancestry (migration 052) to
 * enrich the agent's prompt with the "why" chain. Two parallel ticks for the
 * same business get different issues (SELECT ... FOR UPDATE SKIP LOCKED via
 * the claim_issue stored function — migration 051).
 *
 * Reversible: unset the env var → tick goes back to today's behavior.
 *
 * The checkout uses a fresh randomUUID() as the run_id; invocationId stays
 * the human-readable tick id used in metrics rows.
 */
const USE_ISSUE_CHECKOUT = process.env.USE_ISSUE_CHECKOUT === '1'

export const runtime     = 'nodejs'
export const maxDuration = 60

// ── Auth ─────────────────────────────────────────────────────────────────────

function authoriseCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const got = req.headers.get('authorization') ?? ''
  return got === `Bearer ${expected}`
}

// ── Business discovery ──────────────────────────────────────────────────────

interface BusinessOperatorRow {
  slug:             string
  name:             string
  status:           string
  user_id:          string
  brand_voice:      string | null
  timezone:         string
  daily_cron_local_hour: number
  niche:            string
  money_model:      Record<string, unknown> | null
  kpi_targets:      Record<string, unknown> | null
  approval_gates:   unknown
  current_run_id:   string | null
  last_operator_at: string | null
  created_at:       string
  updated_at:       string
}

function rowToBusiness(row: BusinessOperatorRow): BusinessRow {
  return {
    slug:                  row.slug,
    name:                  row.name,
    status:                row.status as BusinessRow['status'],
    user_id:               row.user_id,
    brand_voice:           row.brand_voice,
    timezone:              row.timezone,
    daily_cron_local_hour: row.daily_cron_local_hour,
    niche:                 row.niche,
    money_model:           (row.money_model ?? {}) as BusinessRow['money_model'],
    kpi_targets:           (row.kpi_targets ?? {}) as BusinessRow['kpi_targets'],
    approval_gates:        Array.isArray(row.approval_gates) ? row.approval_gates as BusinessRow['approval_gates'] : [],
    slack_channel:         null,
    slack_webhook_url:     null,
    current_run_id:        row.current_run_id,
    last_operator_at:      row.last_operator_at,
    created_at:            row.created_at,
    updated_at:            row.updated_at,
  }
}

/**
 * List businesses where money_model->>'experiment_flag' = 'true'. Uses the
 * same untyped-shim pattern as C1 (lib/cost-guard.ts) since business_operators
 * isn't in the generated Supabase types yet.
 */
async function listExperimentBusinesses(filterSlug: string | null): Promise<BusinessRow[]> {
  const db = createServerClient()
  if (!db) return []

  type BizQuery = {
    eq:     (c: string, v: string) => BizQuery
    order:  (c: string, opts: { ascending: boolean }) => BizQuery
    then:   Promise<{ data: BusinessOperatorRow[] | null; error: unknown }>['then']
  }
  const base = (db as unknown as {
    from: (t: string) => { select: (c: string) => BizQuery }
  }).from('business_operators').select('*')
    .eq('money_model->>experiment_flag', 'true')
    .eq('status', 'active')

  const query: BizQuery = filterSlug ? base.eq('slug', filterSlug) : base
  try {
    const result = (await query.order('slug', { ascending: true })) as
      { data: BusinessOperatorRow[] | null; error: unknown }
    if (result.error) return []
    return (result.data ?? []).map(rowToBusiness)
  } catch {
    return []
  }
}

// ── experiment_metrics writers ──────────────────────────────────────────────

async function writeMetric(kind: string, businessSlug: string, payload: Record<string, unknown>): Promise<void> {
  const db = createServerClient()
  if (!db) return
  try {
    await (db.from('experiment_metrics' as never) as unknown as {
      insert: (rec: unknown) => Promise<{ error: unknown }>
    }).insert({
      business_slug: businessSlug,
      kind,
      payload,
    })
  } catch (err) {
    console.error('[solopreneur-tick] writeMetric failed:', kind, businessSlug, err)
  }
}

/**
 * Read last 30d of gate_event rows for the slug and shape them into the
 * gate_state payload the agent expects (resolved gates, pending gates,
 * per-platform first_n_posts counters).
 */
async function loadGateState(businessSlug: string): Promise<Record<string, unknown>> {
  const db = createServerClient()
  if (!db) return { gates: [] }
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  try {
    type AnyQuery = {
      eq:    (c: string, v: string) => AnyQuery
      gte:   (c: string, v: string) => AnyQuery
      order: (c: string, opts: { ascending: boolean }) => AnyQuery
      then:  Promise<{ data: Array<{ ts: string; payload: Record<string, unknown> | null }> | null; error: unknown }>['then']
    }
    const q = (db as unknown as {
      from: (t: string) => { select: (c: string) => AnyQuery }
    }).from('experiment_metrics').select('ts,payload')
      .eq('business_slug', businessSlug)
      .eq('kind', 'gate_event')
      .gte('ts', sinceIso)
      .order('ts', { ascending: true })
    const result = (await q) as { data: Array<{ ts: string; payload: Record<string, unknown> | null }> | null; error: unknown }
    return { gates: result.data ?? [] }
  } catch {
    return { gates: [] }
  }
}

// ── Per-business runner ─────────────────────────────────────────────────────

interface TickError {
  slug:  string
  stage: 'kill_switch' | 'gateway_resolve' | 'dispatch'
  error: string
}

interface PerBusinessOutcome {
  slug:        string
  killed:      boolean
  killReason?: string
  signal?:     string
  dispatched:  boolean
  durationMs?: number
  error?:      string
}

async function runForBusiness(
  biz: BusinessRow,
  invocationId: string,
  dryRun: boolean,
): Promise<{ outcome: PerBusinessOutcome; error?: TickError }> {
  const slug = biz.slug
  const startedAt = Date.now()

  // 1. Kill-switch — hard stop before any LLM call.
  let killResult: KillSwitchResult
  try {
    killResult = await checkKillSwitch(slug)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      outcome: { slug, killed: false, dispatched: false, error: `kill_switch_threw: ${msg}` },
      error:   { slug, stage: 'kill_switch', error: msg },
    }
  }

  await writeMetric('kill_switch_check', slug, {
    invocation_id: invocationId,
    kill:          killResult.kill,
    reason:        killResult.reason ?? null,
    signal:        killResult.signal ?? null,
    details:       {
      budgetUsd:          killResult.details.budgetUsd,
      totalSpentUsd:      killResult.details.totalSpentUsd,
      last7dRevenueUsd:   killResult.details.last7dRevenueUsd,
      last7dSignups:      killResult.details.last7dSignups,
      pivotHistoryLength: killResult.details.pivotHistoryLength,
      firstProductLiveAt: killResult.details.firstProductLiveAt?.toISOString() ?? null,
    },
  })

  if (killResult.kill) {
    await writeMetric('tick', slug, {
      invocation_id: invocationId,
      dryRun,
      dispatched:    false,
      reason:        `kill_switch:${killResult.reason ?? 'unknown'}`,
    })
    return {
      outcome: {
        slug,
        killed:     true,
        killReason: killResult.reason,
        dispatched: false,
      },
    }
  }

  // 2. Resolve gate_state for the agent.
  const gateState = await loadGateState(slug)

  // 2b. (Phase 4 follow-up — feature-flagged) Try to claim one issue for this
  // business. Enriches the dispatch with the issue + ancestry chain when
  // successful. When USE_ISSUE_CHECKOUT is off OR no claimable issue exists
  // OR migration 051 isn't applied, claim returns null and the tick proceeds
  // as before.
  let checkout: { issue_id: string; run_id: string; ancestry_prompt: string | null } | null = null
  if (USE_ISSUE_CHECKOUT) {
    const db = createServerClient()
    if (db) {
      const checkoutRunId = randomUUID()
      const claimed = await claimIssue(db, {
        business_slug: slug,
        run_id:        checkoutRunId,
        agent_slug:    'solopreneur-loop',
      })
      if (claimed) {
        const ancestry = await getIssueAncestry(db, claimed.issue_id)
        const promptBlock = renderAncestryPrompt(ancestry)
        checkout = {
          issue_id:        claimed.issue_id,
          run_id:          checkoutRunId,
          ancestry_prompt: promptBlock || null,
        }
      }
    }
  }

  // 3. Build the dispatch payload. solopreneur-loop spec at
  // .claude/agents/solopreneur-loop.md sets the input contract; we mirror
  // it here so the agent receives inputs.business, inputs.gate_state,
  // and inputs.kill_switch_signal (the auto_pivot_eligible carrier).
  const inputs = {
    business: {
      slug:                  biz.slug,
      name:                  biz.name,
      status:                biz.status,
      brand_voice:           biz.brand_voice,
      timezone:              biz.timezone,
      daily_cron_local_hour: biz.daily_cron_local_hour,
      niche:                 biz.niche,
      money_model:           biz.money_model,
      kpi_targets:           biz.kpi_targets,
      approval_gates:        biz.approval_gates,
      current_run_id:        biz.current_run_id,
      last_operator_at:      biz.last_operator_at,
    },
    gate_state:          gateState,
    kill_switch_signal:  killResult.signal ?? null,
    invocation_id:       invocationId,
    // Only present when USE_ISSUE_CHECKOUT=1 and a claim succeeded — agent
    // can branch on its presence to decide whether to work the assigned issue
    // vs. propose new ones.
    checkout:            checkout
      ? { issue_id: checkout.issue_id, run_id: checkout.run_id }
      : null,
  }

  // Dry-run mode — log intent, skip the LLM dispatch entirely.
  if (dryRun) {
    await writeMetric('tick', slug, {
      invocation_id: invocationId,
      dryRun:        true,
      dispatched:    false,
      reason:        'dry_run',
      signal:        killResult.signal ?? null,
      gate_count:    Array.isArray((gateState as { gates?: unknown[] }).gates)
        ? (gateState as { gates: unknown[] }).gates.length
        : 0,
    })
    return {
      outcome: {
        slug,
        killed:     false,
        signal:     killResult.signal,
        dispatched: false,
        durationMs: Date.now() - startedAt,
      },
    }
  }

  // 4. Resolve per-business claude-gateway config and dispatch.
  const config = await resolveClawConfig(biz.user_id, slug)
  if (!config) {
    await writeMetric('tick', slug, {
      invocation_id: invocationId,
      dryRun:        false,
      dispatched:    false,
      reason:        'gateway_not_configured',
    })
    return {
      outcome: { slug, killed: false, dispatched: false, error: 'gateway_not_configured' },
      error:   { slug, stage: 'gateway_resolve', error: 'no claude-gateway resolved (resolveClawConfig=null)' },
    }
  }

  const message = [
    'You are running a 4×/day tick of the autonomous solopreneur loop for the experiment business below.',
    'Follow your spec at .claude/agents/solopreneur-loop.md exactly — sense → decide → dispatch → evaluate → adapt.',
    'Return ONLY the JSON object described in your output contract — no prose, no markdown fences.',
    // Ancestry block injected only when USE_ISSUE_CHECKOUT=1 claimed an issue.
    // Empty string when absent — composes cleanly into the prompt.
    checkout?.ancestry_prompt ?? '',
    '',
    'inputs:',
    JSON.stringify(inputs, null, 2),
  ].join('\n')

  const dispatch = await callGateway({
    gatewayUrl:  config.gatewayUrl,
    bearerToken: config.bearerToken,
    sessionTag:  `solopreneur-loop-${slug}-${invocationId}`,
    message,
    agentSlug:   'solopreneur-loop',
    env:         {},   // swarm=false at the loop level — agent sets swarm on sub-dispatches
    userId:      biz.user_id,
    timeoutMs:   55_000,   // stay under maxDuration=60s
  })

  const durationMs = Date.now() - startedAt
  if (!dispatch.ok) {
    // Release the issue lock if checkout claimed one — failed dispatch should
    // not leave a stranded checkout that blocks the next tick.
    if (checkout) {
      const db = createServerClient()
      if (db) {
        await releaseIssue(db, { issue_id: checkout.issue_id, run_id: checkout.run_id })
      }
    }
    await writeMetric('tick', slug, {
      invocation_id: invocationId,
      dryRun:        false,
      dispatched:    false,
      reason:        'dispatch_failed',
      status:        dispatch.status,
      error:         dispatch.error ?? null,
      duration_ms:   durationMs,
      checkout:      checkout ? { issue_id: checkout.issue_id, released: true } : null,
    })
    return {
      outcome: {
        slug,
        killed:     false,
        dispatched: false,
        durationMs,
        error:      dispatch.error ?? `gateway_${dispatch.status}`,
      },
      error: { slug, stage: 'dispatch', error: dispatch.error ?? `gateway returned ${dispatch.status}` },
    }
  }

  // Best-effort attempt to count actions in the JSON output. Failure to parse
  // is non-fatal — the tick row still records success; the agent's per-action
  // dispatches will land their own rows.
  let actionCount: number | null = null
  try {
    const stripped = dispatch.text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()
    const parsed = JSON.parse(stripped) as { today_actions?: unknown[]; actions?: unknown[] }
    if (Array.isArray(parsed.today_actions)) actionCount = parsed.today_actions.length
    else if (Array.isArray(parsed.actions))  actionCount = parsed.actions.length
  } catch {
    // ignore — dispatch.text may not be JSON; agent still ran.
  }

  await writeMetric('tick', slug, {
    invocation_id:  invocationId,
    dryRun:         false,
    dispatched:     true,
    duration_ms:    durationMs,
    action_count:   actionCount,
    signal:         killResult.signal ?? null,
    response_chars: dispatch.text.length,
    checkout:       checkout
      ? { issue_id: checkout.issue_id, run_id: checkout.run_id, ancestry_attached: Boolean(checkout.ancestry_prompt) }
      : null,
  })

  return {
    outcome: {
      slug,
      killed:     false,
      signal:     killResult.signal,
      dispatched: true,
      durationMs,
    },
  }
}

// ── Route handler ──────────────────────────────────────────────────────────

interface TickReport {
  ok:           boolean
  ranAt:        string
  invocationId: string
  ticked:       number
  killed:       number
  dispatched:   number
  dryRun:       boolean
  outcomes:     PerBusinessOutcome[]
  errors:       TickError[]
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authoriseCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const url           = new URL(req.url)
  const dryRun        = url.searchParams.get('dryRun') === 'true'
  const filterSlug    = url.searchParams.get('businessSlug')
  const invocationId  = `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const ranAt         = new Date().toISOString()

  const businesses = await listExperimentBusinesses(filterSlug && filterSlug.length ? filterSlug : null)

  const outcomes: PerBusinessOutcome[] = []
  const errors:   TickError[]          = []

  for (const biz of businesses) {
    try {
      const { outcome, error } = await runForBusiness(biz, invocationId, dryRun)
      outcomes.push(outcome)
      if (error) errors.push(error)
    } catch (err) {
      // Defensive — runForBusiness shouldn't throw, but if it does, capture
      // and keep going so one slug's failure doesn't kill the whole tick.
      const msg = err instanceof Error ? err.message : String(err)
      outcomes.push({ slug: biz.slug, killed: false, dispatched: false, error: msg })
      errors.push({ slug: biz.slug, stage: 'dispatch', error: msg })
    }
  }

  const report: TickReport = {
    ok:           errors.length === 0,
    ranAt,
    invocationId,
    ticked:       businesses.length,
    killed:       outcomes.filter(o => o.killed).length,
    dispatched:   outcomes.filter(o => o.dispatched).length,
    dryRun,
    outcomes,
    errors,
  }

  // Always 200 — retry-storm rule: per-business failures never bubble up as
  // 5xx, otherwise Vercel-cron / Inngest retries multiply Max-plan spend
  // across all businesses, not just the failed one. Caller inspects `ok`.
  return NextResponse.json(report, { status: 200 })
}

// Vercel cron sends GET; mirror to POST so manual `curl -X POST` triggers
// work too (consistent with the rest of app/api/cron/*).
export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req)
}

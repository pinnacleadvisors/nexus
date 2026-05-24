/**
 * GET/POST /api/cron/codex-maintainer-tick
 *
 * Task C3 of the autonomous-solopreneur experiment plan
 * (`task_plan-solopreneur-experiment.md`).
 *
 * Fires every 30 minutes. Iterates every `business_operators` row whose
 * `money_model.experiment_flag` is `true`, runs the kill-switch preflight,
 * and dispatches the `codex-maintainer` agent against the **shared**
 * codex-gateway on KVM4 (one instance covers every experiment-flagged
 * business — see ADR 002 + `.claude/agents/codex-maintainer.md`). KVM4
 * since 2026-05-22 (was KVM2 before; ADR 006 lean-mode pivot).  // topology-check: ignore
 *
 * Single-instance reasoning: `dispatchToCodexGateway` reads
 * `CODEX_GATEWAY_URL` + `CODEX_GATEWAY_BEARER_TOKEN` from env and posts to
 * the shared gateway. We pass `businessSlug` as part of the agent brief so
 * the agent's tick knows which business to inspect, but the gateway URL
 * itself is single-tenant (NOT resolved per-business via
 * `lib/claw/business-client.ts`). That mirrors how the dispatch route
 * routes codex traffic at app/api/claude-session/dispatch/route.ts:415-496.
 *
 * The `codex-maintainer` agent emits its own `health_check` /
 * `tick(noop=true)` rows to `experiment_metrics` per its spec — the cron
 * route is the dispatcher, not the writer. The kill-switch check is
 * already recorded by `solopreneur-tick` (C2) on its own cadence; we skip
 * dispatch silently when the kill-switch fires to avoid duplicate
 * `kill_switch_check` rows.
 *
 * Retry-storm rule: this route ALWAYS returns 200 + `{ok, ticked, errors}`
 * even on per-business failure. Vercel cron retries 5xx, which would
 * multiply codex-gateway load on flaky upstreams.
 *
 * Cron schedule (`*\/30 * * * *`) is registered separately in `vercel.json`
 * by Task D4 — out of scope for this file.
 */

import { NextRequest, NextResponse } from 'next/server'
import { audit } from '@/lib/audit'
import { listActiveBusinesses } from '@/lib/business/db'
import type { BusinessRow } from '@/lib/business/types'
import { checkKillSwitch } from '@/lib/cost-guard'
import {
  dispatchToCodexGateway,
  isCodexGatewayConfigured,
} from '@/lib/claw/codex-gateway'
import { buildSessionEnv } from '@/lib/n8n/managed-agent-builder'

export const runtime    = 'nodejs'
export const maxDuration = 60

const AGENT_SLUG    = 'codex-maintainer'
const AGENT_MODEL   = 'gpt-5.5-codex'
const TOOL_BUDGET   = ['Bash', 'WebFetch', 'WebSearch', 'Read', 'Grep']

interface PerBusinessResult {
  slug:       string
  dispatched: boolean
  skipped?:   'kill_switch' | 'dry_run' | 'gateway_unconfigured'
  error?:     string
  sessionId?: string
  status?:    number
}

interface TickReport {
  ok:      boolean
  ticked:  number
  dryRun:  boolean
  results: PerBusinessResult[]
  errors:  string[]
}

function authoriseCron(req: NextRequest): boolean {
  // Vercel cron sends `Authorization: Bearer <CRON_SECRET>` automatically
  // when the schedule is registered in `vercel.json`. Match the
  // `scale-down-businesses` cron's pattern: when CRON_SECRET is unset
  // (dev / un-secured), allow the request so manual `curl` works.
  const expected = process.env.CRON_SECRET
  if (!expected) return true
  const got = req.headers.get('authorization') ?? ''
  return got === `Bearer ${expected}`
}

function isExperimentBusiness(b: BusinessRow): boolean {
  const flag = (b.money_model as Record<string, unknown> | null)?.experiment_flag
  return flag === true
}

function buildBusinessContext(b: BusinessRow): Record<string, unknown> {
  // Same shape as `business-operator` agent's `inputs.business`
  // (BusinessContext = BusinessRow minus secrets). We pass it inline so
  // the codex-maintainer tick has the full payload without an extra
  // round-trip to Supabase from inside the gateway.
  return {
    slug:                  b.slug,
    name:                  b.name,
    status:                b.status,
    brand_voice:           b.brand_voice,
    timezone:              b.timezone,
    daily_cron_local_hour: b.daily_cron_local_hour,
    niche:                 b.niche,
    money_model:           b.money_model,
    kpi_targets:           b.kpi_targets,
    approval_gates:        b.approval_gates,
    slack_channel:         b.slack_channel,
    current_run_id:        b.current_run_id,
    last_operator_at:      b.last_operator_at,
    created_at:            b.created_at,
    updated_at:            b.updated_at,
  }
}

function buildAgentMessage(args: {
  business: Record<string, unknown>
  tickTs:   string
  tools:    readonly string[]
}): string {
  return [
    `Nexus codex-maintainer tick — business ${args.business.slug}.`,
    '',
    `tickTs: ${args.tickTs}`,
    '',
    'Run the cyclic checks per `.claude/agents/codex-maintainer.md`:',
    '  1. Container health (Coolify KVM4)',
    '  2. Vercel build-log scan',
    '  3. Codex token expiry monitor',
    '',
    'Emit at least one row to experiment_metrics (heartbeat always — kind=tick with payload.noop=true if no signal fires).',
    '',
    'Tool budget — pick the most appropriate from this list:',
    `  - ${args.tools.join('\n  - ')}`,
    '',
    `Business context: ${JSON.stringify(args.business)}`,
  ].join('\n')
}

async function tickOne(b: BusinessRow, dryRun: boolean, tickTs: string): Promise<PerBusinessResult> {
  // 1. Kill-switch preflight (C1). Don't write a duplicate
  //    kill_switch_check row — solopreneur-tick already records that on
  //    its own cadence. Just skip silently.
  const ks = await checkKillSwitch(b.slug)
  if (ks.kill) {
    return { slug: b.slug, dispatched: false, skipped: 'kill_switch' }
  }

  if (dryRun) {
    return { slug: b.slug, dispatched: false, skipped: 'dry_run' }
  }

  // 2. Dispatch to the SHARED codex-gateway. dispatchToCodexGateway()
  //    reads CODEX_GATEWAY_URL from env directly — it does NOT consult
  //    the per-business resolver in lib/claw/business-client.ts, so
  //    every business's tick lands on the same KVM4 instance. That's
  //    intentional (see ADR 002 + the agent spec's single-instance
  //    notes).
  const message = buildAgentMessage({
    business: buildBusinessContext(b),
    tickTs,
    tools:    TOOL_BUDGET,
  })

  const env = buildSessionEnv({ swarm: false })
  const result = await dispatchToCodexGateway({
    agentSlug:  AGENT_SLUG,
    message,
    env:        { ...env, NEXUS_AGENT_MODEL: AGENT_MODEL },
    userId:     b.user_id,
    sessionTag: `codex-maintainer-tick-${b.slug}-${Date.now()}`,
  })

  if (result === null) {
    // Codex gateway not configured — codex-maintainer can't run at all.
    // Treat as a soft skip (return 200 + skipped tag) rather than a
    // per-business error so the cron stays green until the operator
    // wires CODEX_GATEWAY_URL + CODEX_GATEWAY_BEARER_TOKEN.
    return { slug: b.slug, dispatched: false, skipped: 'gateway_unconfigured' }
  }

  if (!result.ok) {
    return {
      slug:       b.slug,
      dispatched: false,
      error:      result.error ?? `codex gateway returned ${result.status}`,
      sessionId:  result.sessionId,
      status:     result.status,
    }
  }

  return {
    slug:       b.slug,
    dispatched: true,
    sessionId:  result.sessionId,
    status:     result.status,
  }
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authoriseCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const dryRun = req.nextUrl.searchParams.get('dryRun') === 'true'
  const tickTs = new Date().toISOString()

  const report: TickReport = {
    ok:      true,
    ticked:  0,
    dryRun,
    results: [],
    errors:  [],
  }

  if (!isCodexGatewayConfigured() && !dryRun) {
    // Globally unconfigured — surface once, don't iterate.
    report.ok = false
    report.errors.push('codex_gateway_not_configured')
    return NextResponse.json(report, { status: 200 })
  }

  let businesses: BusinessRow[]
  try {
    businesses = (await listActiveBusinesses()).filter(isExperimentBusiness)
  } catch (err) {
    report.ok = false
    report.errors.push(err instanceof Error ? err.message : 'list_businesses_failed')
    return NextResponse.json(report, { status: 200 })
  }

  // Sequential iteration — codex-maintainer ticks are short (<5 min ceiling
  // per spec) and the gateway is single-tenant, so parallel dispatch would
  // contend on the same Codex CLI session pool. Sequential keeps this
  // route's wall-clock under the 60s maxDuration even at 5+ businesses.
  for (const b of businesses) {
    try {
      const r = await tickOne(b, dryRun, tickTs)
      report.results.push(r)
      if (r.dispatched) report.ticked++
      if (r.error)     report.errors.push(`${r.slug}: ${r.error}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error'
      report.results.push({ slug: b.slug, dispatched: false, error: msg })
      report.errors.push(`${b.slug}: ${msg}`)
    }
  }

  if (report.errors.length > 0) report.ok = false

  audit(req, {
    action:   'cron.codex_maintainer_tick',
    resource: 'experiment_metrics',
    metadata: {
      ticked:  report.ticked,
      scanned: businesses.length,
      dryRun,
      errors:  report.errors.length,
    },
  })

  // ALWAYS 200 — retry-storm rule. The `ok:false` flag in the body is the
  // signal an external monitor should read.
  return NextResponse.json(report, { status: 200 })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}

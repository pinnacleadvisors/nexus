/**
 * POST/GET /api/cron/optimizer-scan-failures
 *
 * Daily cron (07:00 UTC). Reads recent failure clusters from `run_events` via
 * `lib/runs/failure-clusters.ts`, picks the highest-frequency unresolved one,
 * and dispatches `workflow-optimizer` with the cluster brief.
 *
 * Absorbed from Life-Harness (arXiv 2605.22166): "failure-to-intervention
 * conversion" — automatically distill recurring trajectory failures into
 * reusable interventions, rather than only reading human-flagged feedback.
 * The existing `workflow-feedback` table (manual) is preserved; this is the
 * automatic surface that augments it.
 *
 * Auth: CRON_SECRET bearer OR bot bearer token (mirrors other crons).
 *
 * Retry-storm safe: returns 200 + `{ok: false, …}` on transient failures so
 * the cron-job.org retry policy doesn't hammer the dispatch gateway on a
 * Supabase blip.
 *
 * Operator gate: the dispatched `workflow-optimizer` emits an `edit-plan`
 * block; nothing actually changes until the operator approves the plan
 * via the existing chat UI. Mirrors the Ralph-loop invariants.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { findFailureClusters, type FailureCluster } from '@/lib/runs/failure-clusters'
import { authBotToken } from '@/lib/auth/bot'

export const runtime     = 'nodejs'
export const maxDuration = 60

type AuthVerdict =
  | { ok: true;  via: 'cron_secret' | 'bot_token' }
  | { ok: false; reason: 'no_authorization_header' | 'cron_secret_unset_and_bot_token_invalid' | 'cron_secret_set_but_header_mismatch' }

function checkAuth(req: NextRequest): AuthVerdict {
  const cronSecret = process.env.CRON_SECRET
  const header     = req.headers.get('authorization') ?? ''
  if (cronSecret && header === `Bearer ${cronSecret}`) return { ok: true, via: 'cron_secret' }
  if (authBotToken(req)) return { ok: true, via: 'bot_token' }
  if (!header)      return { ok: false, reason: 'no_authorization_header' }
  if (!cronSecret)  return { ok: false, reason: 'cron_secret_unset_and_bot_token_invalid' }
  return { ok: false, reason: 'cron_secret_set_but_header_mismatch' }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = checkAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: 'unauthorized', reason: auth.reason }, { status: 401 })
  }

  // ?lookback=<days> & ?minFrequency=<n> & ?scope=admin|business:<slug>
  const u = new URL(req.url)
  const lookbackDays = numParam(u, 'lookback',     7)
  const minFrequency = numParam(u, 'minFrequency', 5)
  const scope        = u.searchParams.get('scope') ?? null
  const dryRun       = u.searchParams.get('dryRun') === '1'

  let clusters: FailureCluster[]
  try {
    clusters = await findFailureClusters({ lookbackDays, minFrequency, scope, maxClusters: 10 })
  } catch (err) {
    // 200 + ok:false — retry-storm safe.
    return NextResponse.json({
      ok:     false,
      error:  'cluster_read_failed',
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  if (clusters.length === 0) {
    return NextResponse.json({
      ok:        true,
      dispatched: false,
      reason:    'no_clusters_above_minFrequency',
      lookback:  lookbackDays,
      minFrequency,
    })
  }

  const top = clusters[0]
  if (dryRun) {
    return NextResponse.json({ ok: true, dispatched: false, dryRun: true, top, total_clusters: clusters.length })
  }

  // Dispatch workflow-optimizer with the cluster brief. We POST to our own
  // dispatch route (no need to call the gateway directly — that's what the
  // route is for).
  const dispatchUrl = `${process.env.NEXUS_BASE_URL ?? ''}/api/claude-session/dispatch`
  if (!process.env.NEXUS_BASE_URL) {
    return NextResponse.json({
      ok:     false,
      error:  'nexus_base_url_unset',
      hint:   'Set NEXUS_BASE_URL in Doppler so the cron can dispatch workflow-optimizer.',
    })
  }

  const brief = buildBrief(top)
  let res: Response
  try {
    res = await fetch(dispatchUrl, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.BOT_API_TOKEN ?? ''}`,
      },
      body: JSON.stringify({
        agentSlug:  'workflow-optimizer',
        sessionTag: `optimizer-failure-scan-${new Date().toISOString().slice(0, 10)}`,
        inputs: {
          task:        'distill-failure-cluster',
          cluster:     top,
          brief,
          // Tool budget — h3 layer. Required ≥ 2 plausible options.
          tools:       ['Read', 'Edit'],
        },
      }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    // retry-storm: return 200 + ok:false so cron-job.org doesn't auto-disable.
    return NextResponse.json({
      ok:      false,
      error:   'dispatch_unreachable',
      detail:  err instanceof Error ? err.message : String(err),
      cluster: top,
    })
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return NextResponse.json({
      ok:        false,
      error:     `dispatch_${res.status}`,
      detail:    text.slice(0, 300),
      cluster:   top,
    })
  }

  return NextResponse.json({
    ok:             true,
    dispatched:     true,
    dispatched_to:  'workflow-optimizer',
    cluster:        top,
    total_clusters: clusters.length,
  })
}

// Vercel cron sends GET by default. Mirror to POST for consistency.
export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req)
}

function numParam(u: URL, name: string, fallback: number): number {
  const raw = u.searchParams.get(name)
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Build the brief workflow-optimizer reads. Mirrors the existing
 * workflow-feedback brief shape so the agent can treat both inbox sources
 * identically.
 */
function buildBrief(cluster: FailureCluster): string {
  return [
    `# Automatic failure-cluster scan`,
    ``,
    `**Signature:** \`${cluster.signature}\``,
    `**Kind:** \`${cluster.kind}\``,
    `**Frequency:** ${cluster.count} occurrences in the lookback window.`,
    `**Scope:** ${cluster.business_slug ?? 'admin (platform-wide)'}`,
    `**First seen:** ${cluster.first_seen_at}`,
    `**Last seen:**  ${cluster.last_seen_at}`,
    ``,
    `## Task`,
    ``,
    `1. Read the sample events (\`run_events\` ids: ${cluster.sample_event_ids.join(', ')}) — \`select * from run_events where id = any(array[...])\` will work.`,
    `2. Identify the harness layer this failure lives in (h2/h3/h4/h5 — see AGENTS.md "Harness taxonomy").`,
    `3. Emit ONE \`edit-plan\` block proposing the smallest intervention that prevents the recurrence. Operator approves item-by-item.`,
    ``,
    `## Constraints`,
    ``,
    `- Do NOT auto-merge. Open a draft PR per the existing edit-plan flow.`,
    `- Do NOT broaden scope — one intervention per cluster.`,
    `- If the cluster looks resolved already (e.g. last_seen_at is > 24h ago AND the freq curve is decreasing), reply with \`scope: "stop"\` and one-line rationale instead.`,
  ].join('\n')
}

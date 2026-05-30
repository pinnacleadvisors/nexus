/**
 * lib/chat/reconcile-inflight.ts — durable chat (migration 099).
 *
 * Drains FINISHED detached gateway jobs into chat_messages with no browser in
 * the loop. Today a turn's reply is only persisted when a browser poll sees
 * status='done'; close the tab and the reply is lost when the gateway GCs the
 * result after RETAIN_MS. This reconciler — run by a cron + a fire-and-forget
 * kick at enqueue — closes that gap.
 *
 * Correctness: persistCompletedTurn is called with `claimInflight:true`, which
 * atomically claims the turn (sets inflight_drained=true) before any append, so
 * the reconciler and a late browser poll can never both persist. Per-session
 * try/catch keeps one bad session from stalling the sweep.
 */

import { createServerClient } from '@/lib/supabase'
import { getGatewayJob } from '@/lib/claw/gateway-jobs'
import { resolveClawConfig } from '@/lib/claw/business-client'
import { persistCompletedTurn } from '@/lib/chat/persist-completed-turn'
import { notifyOperator } from '@/lib/notifications/dispatch'

/** Only scan turns started within the gateway's RETAIN_MS (~10min) — older jobs
 *  have been GC'd, so there's nothing left to drain. */
const WINDOW_MS = 9 * 60 * 1000

interface InflightRow {
  id:              string
  user_id:         string
  inflight_job_id: string | null
}

export interface ReconcileResult {
  scanned: number
  drained: number
  pending: number
  errored: number
}

export async function reconcileInflightTurns(): Promise<ReconcileResult> {
  const result: ReconcileResult = { scanned: 0, drained: 0, pending: 0, errored: 0 }
  const sb = createServerClient()
  if (!sb) return result

  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString()
  const resp = await (sb.from('chat_sessions') as unknown as {
    select: (c: string) => {
      eq: (c: string, v: boolean) => {
        gte: (c: string, v: string) => Promise<{ data: InflightRow[] | null; error: unknown }>
      }
    }
  })
    .select('id, user_id, inflight_job_id')
    .eq('inflight_drained', false)
    .gte('inflight_started_at', cutoff)

  const rows = ((resp.data ?? []) as InflightRow[]).filter(
    (r): r is InflightRow & { inflight_job_id: string } => Boolean(r.inflight_job_id),
  )
  result.scanned = rows.length

  for (const row of rows) {
    try {
      const cfg = await resolveClawConfig(row.user_id)
      if (!cfg) continue
      const job = await getGatewayJob({
        gatewayUrl:  cfg.gatewayUrl,
        bearerToken: cfg.bearerToken,
        jobId:       row.inflight_job_id,
        userId:      row.user_id,
      })
      if (!job.ok || !job.status) continue
      if (job.status === 'pending' || job.status === 'running') {
        result.pending++
        continue
      }

      // done | error → persist (claim-guarded; skips cleanly if a late browser
      // poll already drained this same turn).
      const text =
        job.status === 'error'
          ? job.text || (job.jobError ? `⚠ Turn failed: ${job.jobError}` : '⚠ Turn failed.')
          : job.text ?? ''
      const persisted = await persistCompletedTurn({
        userId:        row.user_id,
        sessionId:     row.id,
        jobId:         row.inflight_job_id,
        gatewayText:   text,
        toolCalls:     job.toolCalls,
        durationMs:    job.durationMs,
        usage:         job.usage,
        claimInflight: true,
      })
      result.drained++

      // Phase D2 — the reconciler only wins the claim when NO browser drained
      // this turn first (a live poll would have beaten us), so a win means the
      // operator was away. Ping them. `persisted.displayText` is the
      // fenced-block-stripped reply; use a short preview as the body. notify is
      // fail-soft + never throws, but guard anyway so it can't stall the sweep.
      const crashed = job.status === 'error'
      const preview = (persisted.displayText || text || '').replace(/\s+/g, ' ').trim().slice(0, 140)
      await notifyOperator(row.user_id, 'chat-turn', {
        title:     crashed ? 'Chat turn failed' : 'Chat reply ready',
        body:      preview || (crashed
                     ? 'A detached chat turn failed while you were away.'
                     : 'Your chat turn finished while you were away.'),
        link_href: '/manage-platform',
        severity:  crashed ? 'critical' : 'info',
      }).catch(() => { /* notify is best-effort — never block the sweep */ })
    } catch (e) {
      result.errored++
      console.warn('[reconcile-inflight] session', row.id, 'failed:', e instanceof Error ? e.message : e)
    }
  }

  return result
}

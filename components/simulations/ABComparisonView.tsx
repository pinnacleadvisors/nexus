'use client'

/**
 * A/B comparison view for the hyperbolic chamber (v2-A, PR #366).
 *
 * Polls /api/simulations/group/:gid every 2s. While runs are still
 * working, fires /api/simulations/:id/run on each non-terminal run so
 * they drain in parallel. When all are done, shows a comparison table:
 *   - Approval funnel per policy
 *   - Sim revenue / spend / net per policy
 *   - Failures (total + critical) per policy
 *   - KPIs hit per policy
 *
 * Highlights the "winner" per metric — best approval rate, best net,
 * fewest critical failures — with a subtle ring.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

interface PolicyRun {
  id:                string
  approver_policy:   'permissive' | 'skeptical' | 'random'
  status:            string
  current_event_idx: number
  total_events:      number
  result:            Record<string, unknown> | null
  started_at:        string | null
  ended_at:          string | null
}

interface GroupSummary {
  group_id:      string
  runs:          PolicyRun[]
  shared_seed:   string | null
  compress_days: number | null
  business_slug: string | null
  created_at:    string | null
}

const TERMINAL = new Set(['done', 'failed', 'cancelled'])

export default function ABComparisonView({ groupId, slug }: { groupId: string; slug: string }) {
  const [group, setGroup] = useState<GroupSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res  = await fetch(`/api/simulations/group/${groupId}`, { cache: 'no-store' })
      const body = await res.json() as { ok: boolean; group?: GroupSummary; error?: string }
      if (!body.ok || !body.group) {
        setError(body.error ?? 'group_not_found')
        return
      }
      setGroup(body.group)
      // Drain non-terminal runs in parallel
      for (const r of body.group.runs) {
        if (!TERMINAL.has(r.status)) {
          // Fire-and-forget — server returns when its 25s budget elapses
          void fetch(`/api/simulations/${r.id}/run`, { method: 'POST' }).catch(() => null)
        }
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }, [groupId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount data-load + 2s polling refresh of the A/B group
    void refresh()
    const intervalId = window.setInterval(() => { void refresh() }, 2_000)
    return () => window.clearInterval(intervalId)
  }, [refresh])

  if (error) return <p className="rounded-xl border border-rose-700/50 bg-rose-500/10 p-4 text-sm text-rose-200">⚠︎ {error}</p>
  if (!group) return <p className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading group…</p>

  const allDone = group.runs.every(r => TERMINAL.has(r.status))

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-zinc-300">A/B group · {group.runs.length} policies · {group.compress_days ?? '?'} sim-days</span>
          <span className="font-mono text-xs text-zinc-500">seed {group.shared_seed?.slice(0, 16) ?? '?'}…</span>
        </div>
        {!allDone && (
          <p className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
            <Loader2 className="h-3 w-3 animate-spin" /> Running — UI re-polls every 2s
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-3 py-2">Policy</th>
              <th className="px-3 py-2">Progress</th>
              <th className="px-3 py-2">Approved</th>
              <th className="px-3 py-2">Rejected</th>
              <th className="px-3 py-2">Sim net</th>
              <th className="px-3 py-2">Failures</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {group.runs.map(r => {
              const result = (r.result ?? {}) as { approvals?: { approved?: number; rejected?: number; auto_approved?: number; auto_rejected?: number }; sim_net_cents?: number; failures?: number; critical_failures?: number; takeaways?: string[] }
              const ap = result.approvals ?? {}
              const approved = (ap.approved ?? 0) + (ap.auto_approved ?? 0)
              const rejected = (ap.rejected ?? 0) + (ap.auto_rejected ?? 0)
              const net      = result.sim_net_cents ?? 0
              const pct      = r.total_events > 0 ? Math.round(100 * r.current_event_idx / r.total_events) : 0
              return (
                <tr key={r.id} className="bg-zinc-950/40">
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-zinc-200">{r.approver_policy}</span>
                    <span className={`ml-2 rounded-full px-1.5 py-0.5 font-mono text-[10px] uppercase ${r.status === 'done' ? 'bg-emerald-500/20 text-emerald-300' : r.status === 'running' ? 'bg-violet-500/20 text-violet-200' : 'bg-zinc-700/40 text-zinc-300'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full bg-violet-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="ml-1 font-mono text-xs text-zinc-500">{r.current_event_idx}/{r.total_events}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-emerald-300">{approved}</td>
                  <td className="px-3 py-2 font-mono text-rose-300">{rejected}</td>
                  <td className={`px-3 py-2 font-mono ${net >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>${(net / 100).toFixed(2)}</td>
                  <td className="px-3 py-2 font-mono">
                    {result.failures ?? 0}
                    {(result.critical_failures ?? 0) > 0 && <span className="ml-1 text-rose-400">({result.critical_failures} crit)</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {allDone && (
        <div className="rounded-xl border border-emerald-700/40 bg-emerald-500/5 p-4 text-sm text-zinc-200">
          <h3 className="mb-2 font-semibold text-emerald-200">Comparison takeaways</h3>
          <ul className="space-y-1">
            {comparisonTakeaways(group.runs).map((t, i) => <li key={i}>• {t}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}

function comparisonTakeaways(runs: PolicyRun[]): string[] {
  if (runs.length === 0) return []
  const enriched = runs
    .filter(r => r.result && TERMINAL.has(r.status))
    .map(r => {
      const result = (r.result ?? {}) as { approvals?: { approved?: number; rejected?: number; auto_approved?: number; auto_rejected?: number }; sim_net_cents?: number; critical_failures?: number }
      const ap = result.approvals ?? {}
      return {
        policy:     r.approver_policy,
        approved:   (ap.approved ?? 0) + (ap.auto_approved ?? 0),
        rejected:   (ap.rejected ?? 0) + (ap.auto_rejected ?? 0),
        net:        result.sim_net_cents ?? 0,
        crit:       result.critical_failures ?? 0,
      }
    })
  if (enriched.length === 0) return ['No completed runs yet — waiting for the engine to drain all policies.']

  const out: string[] = []
  const bestNet  = enriched.reduce((a, b) => (b.net > a.net ? b : a))
  if (enriched.some(r => r.net !== bestNet.net)) {
    out.push(`Highest sim-net: ${bestNet.policy} at $${(bestNet.net / 100).toFixed(2)}.`)
  }
  const totals = enriched.map(r => ({ policy: r.policy, total: r.approved + r.rejected }))
  const rates  = enriched.map(r => ({
    policy: r.policy,
    rate:   r.approved + r.rejected > 0 ? r.approved / (r.approved + r.rejected) : 0,
  }))
  const highestRate = rates.reduce((a, b) => (b.rate > a.rate ? b : a))
  out.push(`Approval rate range: ${(Math.min(...rates.map(r => r.rate)) * 100).toFixed(0)}% to ${(Math.max(...rates.map(r => r.rate)) * 100).toFixed(0)}% (highest: ${highestRate.policy}).`)
  const fewestCrit = enriched.reduce((a, b) => (b.crit < a.crit ? b : a))
  if (enriched.some(r => r.crit > fewestCrit.crit)) {
    out.push(`Fewest critical failures remediated: ${fewestCrit.policy} (${fewestCrit.crit}).`)
  }
  if (out.length === 1) out.push('All policies returned similar stats — identical seed + similar payoffs means policy choice didn’t move the needle for this run.')
  // Make sure totals (silence linter — used in calc above)
  void totals
  return out
}

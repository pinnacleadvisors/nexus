/**
 * Agent-overload analyzer — Mission Control Kit Pack 04 ported to Nexus.
 *
 * Once a day, count `agent_actions` rows per agent_id over the last 7 days.
 * Any agent whose count exceeds 2× the median is flagged as overloaded; we
 * file a row in the `signals` table (kind='question') so the operator sees
 * it on `/signals` and can decide whether to spawn a sibling agent.
 *
 * Files under each owner's user_id (resolved from ALLOWED_USER_IDS, single-
 * tenant default). Idempotent — skips re-filing if a same-agent overload
 * signal already exists in the last 24h.
 *
 * No LLM clustering yet — Pack 04's "what categories of work is this agent
 * doing?" requires routing through Claude. Phase 2 (followup): pull the
 * recent actions, ask Sonnet to cluster, and stash the suggested split
 * inside the signal body as structured JSON.
 */

import { inngest } from '@/inngest/client'
import { createServerClient } from '@/lib/supabase'
import { isEnabled as isKillSwitchEnabled } from '@/lib/kill-switches'

interface ActionRow { agent_id: string | null; user_id: string }

const WINDOW_DAYS  = 7
const OVERLOAD_X   = 2.0

function getOwnerUserIds(): string[] {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return []
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

function median(nums: number[]): number {
  if (!nums.length) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export const agentOverloadDaily = inngest.createFunction(
  {
    id:   'agent-overload-daily',
    name: 'Agent-overload analyzer (split suggestions)',
    // retries: 0 — daily idempotent. If today's flag missed, tomorrow's run
    // will catch it. We don't want 3× signals filed for the same overload.
    retries: 0,
    triggers: [
      { cron: '15 4 * * *' }, // 04:15 UTC, just after the daily business operator
      { event: 'agents/overload-check' },
    ],
  },
  async ({ step }: { step: Record<string, (id: string, fn: () => Promise<unknown>) => Promise<unknown>> }) => {
    if (!(await isKillSwitchEnabled('scheduler'))) {
      return { skipped: 'scheduler kill switch disabled' }
    }

    const flagged = await step['run']('analyze', async () => {
      const db = createServerClient()
      if (!db) return { skipped: 'no supabase' }
      const owners = getOwnerUserIds()
      const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

      // agent_actions exists from migration 008 but may not be in
      // lib/database.types.ts; signals check constraint in 020 limits kind to
      // ('idea','link','error','question'). We use 'question' here.
      type LooseChain = {
        select: (cols: string, opts?: Record<string, unknown>) => LooseChain
        eq:     (k: string, v: unknown) => LooseChain
        in:     (k: string, v: readonly unknown[]) => LooseChain
        gte:    (k: string, v: unknown) => LooseChain
        ilike:  (k: string, p: string) => LooseChain
        limit:  (n: number) => LooseChain
        insert: (rec: unknown) => LooseChain
        order:  (k: string, opts: { ascending: boolean }) => LooseChain
        then:   <T>(onfulfilled: (v: { data: unknown; error: { message: string } | null }) => T) => Promise<T>
      }
      const looseFrom = (table: string): LooseChain =>
        (db as unknown as { from: (t: string) => LooseChain }).from(table)

      // Count rows per agent_id from agent_actions (the existing dispatch
      // log from migration 008). Filter to owners' rows only — this is a
      // single-tenant analyzer, so we don't aggregate across tenants.
      let q = looseFrom('agent_actions')
        .select('agent_id, user_id')
        .gte('created_at', cutoff)
        .limit(5000)
      if (owners.length) q = q.in('user_id', owners)
      const { data, error } = await q
      if (error || !data) return { skipped: error?.message ?? 'no dispatch table' }

      // Count per (user_id, agent_id) so each owner gets their own analysis.
      const countsByOwner = new Map<string, Map<string, number>>()
      for (const row of (data as ActionRow[])) {
        const slug = (row.agent_id ?? '').trim()
        if (!slug) continue
        let inner = countsByOwner.get(row.user_id)
        if (!inner) { inner = new Map(); countsByOwner.set(row.user_id, inner) }
        inner.set(slug, (inner.get(slug) ?? 0) + 1)
      }

      let filed = 0, totalOverloaded = 0
      const reports: Array<{ user: string; agent: string; count: number; median: number }> = []

      for (const [ownerId, counts] of countsByOwner.entries()) {
        if (counts.size < 2) continue
        const med = median([...counts.values()])
        if (med <= 0) continue

        for (const [slug, count] of counts.entries()) {
          if (count <= med * OVERLOAD_X) continue
          totalOverloaded++

          const since = new Date(Date.now() - 86_400_000).toISOString()
          const { data: existing } = await looseFrom('signals')
            .select('id')
            .eq('user_id', ownerId)
            .eq('kind', 'question')
            .ilike('title', `Agent overload: ${slug}%`)
            .gte('created_at', since)
            .limit(1)
          if ((existing as unknown[] | null)?.length) continue

          await looseFrom('signals').insert({
            user_id: ownerId,
            kind:    'question',
            title:   `Agent overload: ${slug}`,
            body:
              `Agent '${slug}' handled ${count} dispatches in the last ${WINDOW_DAYS} days — ${(count / med).toFixed(1)}× the team median (${med}).\n\n` +
              `Consider spawning a sibling agent, splitting its responsibilities, or routing some traffic to a less-loaded agent.\n\n` +
              `<!-- agent_overload_split count_7d=${count} median_7d=${med} ratio=${(count / med).toFixed(2)} -->`,
            status:  'new',
          })
          reports.push({ user: ownerId, agent: slug, count, median: med })
          filed++
        }
      }

      return { ok: true, overloaded: totalOverloaded, filed, owners: countsByOwner.size, reports }
    })

    return { ranAt: new Date().toISOString(), ...flagged as Record<string, unknown> }
  },
)

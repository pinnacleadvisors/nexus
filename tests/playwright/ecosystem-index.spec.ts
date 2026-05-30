/**
 * Spec: /api/cron/ecosystem-index (Akashic Thread A, migration 101).
 *
 * Server-to-server cron (CRON_SECRET via ?secret=). Proves the structural
 * indexer builds the live ecosystem graph and persists its edges into mol_edge
 * (so /api/memory/walk can traverse them). Runs AFTER migration 101 widens the
 * mol_edge kind/source CHECK — before that the route fail-softs (200 +
 * {ok:false, error:'check constraint'}), which is the retry-storm-safe contract.
 *
 * Requirements (skips cleanly otherwise): CRON_SECRET.
 */

import { test, expect } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'

test('ecosystem-index cron persists structural edges into mol_edge', async () => {
  const cronSecret = process.env.CRON_SECRET
  test.skip(!cronSecret, 'CRON_SECRET not set — needed to call the cron')

  const res = await fetch(`${BASE}/api/cron/ecosystem-index?secret=${encodeURIComponent(cronSecret!)}`, { method: 'POST' })
  expect(res.status, 'never 5xx (cron-route rule)').toBe(200)

  const j = (await res.json().catch(() => null)) as { ok?: boolean; edges_total?: number; inserted?: number; error?: string } | null
  // After migration 101 the kind/source CHECK accepts structural/indexer edges.
  expect(j?.ok, `indexer ran ok (error: ${j?.error ?? 'none'})`).toBe(true)
  expect(typeof j?.edges_total, 'edges_total numeric').toBe('number')
  expect(j?.edges_total, 'the live registries yield agent→tool edges').toBeGreaterThan(0)
  // inserted may be 0 on a re-run (idempotent dedup) — that's fine.

  // Unauthorized must be rejected.
  const noauth = await fetch(`${BASE}/api/cron/ecosystem-index`, { method: 'POST' })
  expect(noauth.status, 'rejects missing secret').toBe(401)
})

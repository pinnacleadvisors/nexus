/**
 * GET /api/health/db
 *
 * Owner-only Supabase diagnostic. Reports:
 *   - which env vars are present (masked: just "set" / "unset")
 *   - whether the anon and service-role clients can construct
 *   - latency + result of a minimal query against `tasks` (`select id limit 1`)
 *   - latency + result of the same query against `business_operators`
 *   - whether migrations 025 and 026 are applied (by probing for the columns
 *     they add)
 *
 * Designed to be the first stop when "all pages aren't loading from Supabase":
 * one curl gives you env, connectivity, RLS, and migration status in a single
 * JSON blob without having to spelunk Vercel logs or Supabase dashboards.
 *
 * Auth: ALLOWED_USER_IDS owner-only (signed-in via Clerk).
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const maxDuration = 30

interface ProbeResult {
  ok:        boolean
  durationMs?: number
  error?:    string
  rows?:     number
}

async function probe(client: { from: (t: string) => { select: (cols: string) => { limit: (n: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }> } } } | null, table: string, columns: string): Promise<ProbeResult> {
  if (!client) return { ok: false, error: 'client not constructed' }
  const t0 = Date.now()
  try {
    const res = await client.from(table).select(columns).limit(1)
    const durationMs = Date.now() - t0
    if (res.error) return { ok: false, durationMs, error: res.error.message }
    return { ok: true, durationMs, rows: res.data?.length ?? 0 }
  } catch (err) {
    return {
      ok:         false,
      durationMs: Date.now() - t0,
      error:      err instanceof Error ? err.message : String(err),
    }
  }
}

export async function GET() {
  // Auth gate — owner only.
  const a = await auth()
  if (!a.userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const allowed = (process.env.ALLOWED_USER_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
  if (allowed.length > 0 && !allowed.includes(a.userId)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  const env = {
    NEXT_PUBLIC_SUPABASE_URL:      url ? 'set' : 'UNSET',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey ? 'set' : 'UNSET',
    SUPABASE_SERVICE_ROLE_KEY:     svcKey ? 'set' : 'UNSET',
    ENCRYPTION_KEY:                process.env.ENCRYPTION_KEY ? 'set' : 'UNSET',
    ALLOWED_USER_IDS:              process.env.ALLOWED_USER_IDS ? 'set' : 'UNSET',
  }

  // Construct both clients (anon + service-role).
  let anonClient: ReturnType<typeof createClient> | null = null
  let svcClient:  ReturnType<typeof createClient> | null = null
  try {
    if (url && anonKey) anonClient = createClient(url, anonKey)
  } catch (err) {
    return NextResponse.json({
      ok: false, env,
      error: `anon client construct failed: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
  try {
    if (url && svcKey) svcClient = createClient(url, svcKey)
  } catch (err) {
    return NextResponse.json({
      ok: false, env,
      error: `service-role client construct failed: ${err instanceof Error ? err.message : String(err)}`,
    })
  }

  // Run probes in parallel.
  const [tasksAnon, tasksSvc, boOps, ideas, migration025, migration026] = await Promise.all([
    probe(anonClient as never, 'tasks',              'id'),
    probe(svcClient  as never, 'tasks',              'id'),
    probe(svcClient  as never, 'business_operators', 'slug'),
    probe(svcClient  as never, 'ideas',              'id'),
    probe(svcClient  as never, 'tasks',              'idea_id'),
    probe(svcClient  as never, 'business_operators', 'slack_webhook_url_enc'),
  ])

  // Migration summary — column probes return error if the column doesn't exist.
  const migrations = {
    '025_tasks_lineage': migration025.ok
      ? 'applied'
      : `not applied (${migration025.error ?? 'unknown'})`,
    '026_encrypt_slack_webhook': migration026.ok
      ? 'applied'
      : `not applied (${migration026.error ?? 'unknown'})`,
  }

  const summary = {
    overall_ok: tasksSvc.ok && boOps.ok && ideas.ok,
    note:       tasksSvc.ok
      ? 'Supabase service-role reads are working.'
      : 'Service-role queries failing — check SUPABASE_SERVICE_ROLE_KEY in Doppler / Vercel env.',
  }

  return NextResponse.json({
    ok:         summary.overall_ok,
    summary,
    env,
    probes: {
      tasks_anon:           tasksAnon,
      tasks_service:        tasksSvc,
      business_operators:   boOps,
      ideas:                ideas,
    },
    migrations,
  })
}

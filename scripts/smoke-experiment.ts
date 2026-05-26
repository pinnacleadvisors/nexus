/**
 * scripts/smoke-experiment.ts — Phase 3 Group E smoke runner.
 *
 * Phases: preflight | e1 | e2 | e3 | e4 | all (default)
 *
 * Usage:
 *   doppler run -- npx --yes tsx scripts/smoke-experiment.ts
 *   doppler run -- npx --yes tsx scripts/smoke-experiment.ts --phase=e3
 *   doppler run -- npx --yes tsx scripts/smoke-experiment.ts --teardown
 *
 * Required Doppler vars: NEXUS_BASE_URL, NEXUS_OPS_TOKEN, NEXUS_SLACK_WEBHOOK_URL,
 * SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL (or NEXUS_SUPABASE_URL),
 * ALLOWED_USER_IDS.
 */

import { createClient } from '@supabase/supabase-js'

interface Args {
  phase:    'all' | 'preflight' | 'e1' | 'e2' | 'e3' | 'e4'
  teardown: boolean
  slug:     string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const out: Args = { phase: 'all', teardown: false, slug: 'pdf-experiment-01' }
  for (const a of argv) {
    if (a === '--teardown') out.teardown = true
    else if (a.startsWith('--phase=')) out.phase = a.slice(8) as Args['phase']
    else if (a.startsWith('--slug='))  out.slug  = a.slice(7)
  }
  return out
}

function need(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`FAIL preflight: ${name} is not set in Doppler`)
    process.exit(1)
  }
  return v
}

function fmt(label: string, ok: boolean, detail?: string): void {
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
  // Pass `detail` as a separate console.log arg (not template-interpolated)
  // so CodeQL js/clear-text-logging sees the env-derived value as data
  // rather than format-string content. Also lets log shippers tag the
  // detail separately when they parse structured logs.
  if (detail) console.log(' ', tag, ' ', label, '—', detail)
  else        console.log(' ', tag, ' ', label)
}

interface CtxBase {
  baseUrl:      string
  opsToken:     string
  webhookUrl:   string
  supabaseUrl:  string
  serviceKey:   string
  ownerUserId:  string
  slug:         string
}

function ctx(slug: string): CtxBase {
  return {
    baseUrl:     need('NEXUS_BASE_URL').replace(/\/$/, ''),
    opsToken:    need('NEXUS_OPS_TOKEN'),
    webhookUrl:  need('NEXUS_SLACK_WEBHOOK_URL'),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? need('NEXUS_SUPABASE_URL'),
    serviceKey:  need('SUPABASE_SERVICE_ROLE_KEY'),
    ownerUserId: (process.env.ALLOWED_USER_IDS ?? '').split(',')[0]?.trim() ?? '',
    slug,
  }
}

async function preflight(c: CtxBase): Promise<boolean> {
  console.log('\n[preflight] env + Slack webhook + business row')
  let ok = true

  fmt('NEXUS_BASE_URL set', !!c.baseUrl, c.baseUrl)
  fmt('NEXUS_OPS_TOKEN set', !!c.opsToken && c.opsToken.length >= 32)
  fmt('NEXUS_SLACK_WEBHOOK_URL set', c.webhookUrl.startsWith('https://hooks.slack.com/'))
  fmt('SUPABASE_SERVICE_ROLE_KEY set', !!c.serviceKey)
  fmt('ALLOWED_USER_IDS first entry resolved',
    c.ownerUserId.startsWith('user_'), c.ownerUserId || '(empty)')

  try {
    const res = await fetch(c.webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        text: `:test_tube: Smoke test — ${new Date().toISOString()} — slug=${c.slug}`,
      }),
      signal:  AbortSignal.timeout(10_000),
    })
    fmt('Slack webhook POST', res.ok, `${res.status}`)
    if (!res.ok) ok = false
  } catch (e) {
    fmt('Slack webhook POST', false, (e as Error).message)
    ok = false
  }

  const db = createClient(c.supabaseUrl, c.serviceKey, { auth: { persistSession: false } })
  const { data: biz, error } = await db.from('business_operators').select('slug,name').eq('slug', c.slug).maybeSingle()
  fmt(`business_operators.slug=${c.slug} present`, !error && !!biz,
    biz ? biz.name : (error?.message ?? 'no row'))
  if (error || !biz) ok = false

  return ok
}

async function tickPhase(c: CtxBase, route: string, label: string): Promise<boolean> {
  console.log(`\n[${label}] ${route} dry-run`)
  const url = `${c.baseUrl}${route}?dryRun=true&businessSlug=${encodeURIComponent(c.slug)}`
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${c.opsToken}`, 'Content-Type': 'application/json' },
      signal:  AbortSignal.timeout(60_000),
    })
    const body = await res.json().catch(() => ({}))
    fmt(`${route} returned 200`, res.ok, `${res.status}`)
    fmt(`${route} body has ok flag`, typeof (body as { ok?: unknown }).ok === 'boolean')
    if (!res.ok) console.log('  body:', JSON.stringify(body, null, 2).slice(0, 600))
    return res.ok
  } catch (e) {
    fmt(`${route} reachable`, false, (e as Error).message)
    return false
  }
}

async function killSwitchPhase(c: CtxBase): Promise<boolean> {
  console.log('\n[e3] kill-switch — insert fake $100 cash_spend, expect kill on dispatch')
  const db = createClient(c.supabaseUrl, c.serviceKey, { auth: { persistSession: false } })

  const fixtures = [
    { business_slug: c.slug, kind: 'cash_spend', payload: { usd: 50, source: 'smoke-fixture' } },
    { business_slug: c.slug, kind: 'cash_spend', payload: { usd: 50, source: 'smoke-fixture' } },
  ]
  const { error: insErr } = await (db as unknown as {
    from: (t: string) => { insert: (rows: unknown[]) => Promise<{ error: unknown }> }
  }).from('experiment_metrics').insert(fixtures)
  fmt('inserted 2× $50 cash_spend rows', !insErr,
    insErr ? (insErr as { message?: string }).message ?? 'unknown' : '')
  if (insErr) return false

  const url = `${c.baseUrl}/api/cron/solopreneur-tick?dryRun=true&businessSlug=${encodeURIComponent(c.slug)}`
  const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${c.opsToken}` } })
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  const businesses = (body.businesses ?? body.results ?? []) as Array<Record<string, unknown>>
  const ours = businesses.find(b => b.slug === c.slug)
  const skipped = ours?.skipped ?? body.skipped
  fmt('E1 re-run returned 200', res.ok)
  fmt(`solopreneur-tick reports kill_switch for ${c.slug}`,
    skipped === 'kill_switch', String(skipped ?? '(no skipped field)'))

  console.log(`  Cleanup: --teardown --slug=${c.slug}`)
  return res.ok && skipped === 'kill_switch'
}

async function gatePhase(c: CtxBase): Promise<boolean> {
  console.log('\n[e4] gate-request — niche_pick smoke')
  const url = `${c.baseUrl}/api/experiments/gate-request`
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${c.opsToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug:    c.slug,
      gate:    'niche_pick',
      payload: {
        proposed:   'pdf-templates-for-real-estate-investors',
        rationale:  'smoke-test fixture — please reject this',
        smoke_test: true,
      },
    }),
  })
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  fmt('gate-request returned 200', res.ok, `${res.status}`)
  fmt('response includes gateEventId', typeof body.gateEventId === 'string',
    String(body.gateEventId ?? '(missing)'))

  console.log('\n  Now check Slack:')
  console.log('    1. A new message should have arrived in your experiment channel')
  console.log('    2. The message body should mention `niche_pick` + the proposed niche')
  console.log('    3. Two buttons: Approve / Reject')
  console.log('    4. Click *Reject* (smoke fixture — DO NOT approve)')
  console.log('    5. The message should update to "Rejected by @you"')
  console.log('  If all 5 happen, E4 passes end-to-end.')
  console.log(`  Cleanup: --teardown --slug=${c.slug}`)
  return res.ok && typeof body.gateEventId === 'string'
}

async function teardown(c: CtxBase): Promise<boolean> {
  console.log(`\n[teardown] removing smoke fixtures for slug=${c.slug}`)
  const db = createClient(c.supabaseUrl, c.serviceKey, { auth: { persistSession: false } })
  type Del = { delete: () => { eq: (k: string, v: unknown) => { eq: (k: string, v: unknown) => Promise<{ error: unknown; count: number | null }> } } }
  const exp = (db as unknown as { from: (t: string) => Del }).from('experiment_metrics')

  const r1 = await exp.delete().eq('business_slug', c.slug).eq('kind', 'cash_spend')
  fmt('deleted cash_spend rows', !r1.error, `${r1.count ?? '?'} rows`)
  const r2 = await exp.delete().eq('business_slug', c.slug).eq('kind', 'gate_event')
  fmt('deleted gate_event rows', !r2.error, `${r2.count ?? '?'} rows`)
  return !r1.error && !r2.error
}

async function main(): Promise<void> {
  const args = parseArgs()
  const c = ctx(args.slug)
  console.log(`smoke-experiment — slug=${c.slug} phase=${args.phase}${args.teardown ? ' [teardown]' : ''}`)

  if (args.teardown) {
    const ok = await teardown(c)
    process.exit(ok ? 0 : 1)
  }

  let ok = true
  if (args.phase === 'all' || args.phase === 'preflight') ok = (await preflight(c)) && ok
  if (!ok) { console.log('\nstopping — fix preflight before continuing'); process.exit(1) }
  if (args.phase === 'all' || args.phase === 'e1') ok = (await tickPhase(c, '/api/cron/solopreneur-tick',     'e1')) && ok
  if (args.phase === 'all' || args.phase === 'e2') ok = (await tickPhase(c, '/api/cron/codex-maintainer-tick','e2')) && ok
  if (args.phase === 'all' || args.phase === 'e3') ok = (await killSwitchPhase(c)) && ok
  if (args.phase === 'all' || args.phase === 'e4') ok = (await gatePhase(c)) && ok

  console.log(`\n${ok ? '\x1b[32mALL PHASES PASSED\x1b[0m' : '\x1b[31mONE OR MORE PHASES FAILED\x1b[0m'}`)
  process.exit(ok ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(2) })

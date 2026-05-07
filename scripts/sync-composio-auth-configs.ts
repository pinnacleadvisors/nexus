/**
 * scripts/sync-composio-auth-configs.ts
 *
 * Syncs Composio Auth Configs against `lib/oauth/providers.ts`. For each
 * provider entry that doesn't already have an Auth Config in the connected
 * Composio org, creates one using Composio-managed OAuth (or skips if the
 * provider is marked `manualSetup`).
 *
 * On success it emits the resulting `auth_config_id`s as
 * `COMPOSIO_AUTH_CONFIG_<TOOLKIT_SLUG> = <id>` lines that the OAuth init
 * route reads at request time. When `DOPPLER_TOKEN`, `DOPPLER_PROJECT`, and
 * `DOPPLER_CONFIG` are present in env, it also pushes the new values to
 * Doppler directly via the v3 API — handy for the monthly cron.
 *
 * Usage:
 *
 *   # Dry-run — list what would change, don't call Composio
 *   doppler run -- npx --yes tsx scripts/sync-composio-auth-configs.ts --dry-run
 *
 *   # Real run, manual Doppler paste afterwards
 *   doppler run -- npx --yes tsx scripts/sync-composio-auth-configs.ts
 *
 *   # Real run + auto-push results to Doppler (requires service token in env)
 *   DOPPLER_TOKEN=dp.st.... DOPPLER_PROJECT=nexus DOPPLER_CONFIG=prd \
 *     npx --yes tsx scripts/sync-composio-auth-configs.ts
 *
 * Required env:
 *   COMPOSIO_API_KEY        — Composio API key (org or project scope)
 *
 * Optional env:
 *   COMPOSIO_BASE_URL       — defaults to https://backend.composio.dev
 *   DOPPLER_TOKEN           — when set, push results back to Doppler
 *   DOPPLER_PROJECT         — required if DOPPLER_TOKEN is set
 *   DOPPLER_CONFIG          — required if DOPPLER_TOKEN is set
 *
 * Exit codes: 0 on full success or partial-with-no-errors, 1 on any errors.
 */

import { OAUTH_PROVIDERS, type OAuthProvider } from '../lib/oauth/providers'

const COMPOSIO_BASE_URL = (process.env.COMPOSIO_BASE_URL ?? 'https://backend.composio.dev').replace(/\/$/, '')
const DOPPLER_BASE_URL  = 'https://api.doppler.com/v3'

interface AuthConfigRow {
  id:                   string
  toolkit:              { slug: string }
  is_composio_managed?: boolean
  auth_scheme?:         string
}

interface SyncResult {
  created: Array<{ provider: OAuthProvider; authConfigId: string }>
  existing: Array<{ provider: OAuthProvider; authConfigId: string }>
  skipped: Array<{ provider: OAuthProvider; reason: string; credentialsUrl?: string }>
  errors:  Array<{ provider: OAuthProvider; error: string }>
}

// ── Composio API ────────────────────────────────────────────────────────────

function getApiKey(): string {
  const k = process.env.COMPOSIO_API_KEY
  if (!k) throw new Error('COMPOSIO_API_KEY not in env')
  return k
}

async function listAuthConfigs(): Promise<AuthConfigRow[]> {
  const url = `${COMPOSIO_BASE_URL}/api/v3/auth_configs?limit=200`
  const res = await fetch(url, {
    headers: { 'x-api-key': getApiKey() },
    signal:  AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`list auth_configs failed: ${res.status} ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as { items?: AuthConfigRow[]; data?: AuthConfigRow[] }
  // Composio's pagination wraps the array as either `items` or `data` depending on version.
  return data.items ?? data.data ?? []
}

async function createComposioManagedAuthConfig(toolkitSlug: string): Promise<string> {
  const url = `${COMPOSIO_BASE_URL}/api/v3/auth_configs`
  const body = {
    toolkit:     { slug: toolkitSlug },
    auth_config: {
      auth_scheme:         'OAUTH2',
      is_composio_managed: true,
    },
  }
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'x-api-key':    getApiKey(),
      'content-type': 'application/json',
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`create ${toolkitSlug}: ${res.status} ${text.slice(0, 300)}`)
  }
  const data = (await res.json()) as { auth_config?: { id: string }; id?: string }
  const id = data.auth_config?.id ?? data.id
  if (!id) throw new Error(`create ${toolkitSlug}: response missing auth_config_id`)
  return id
}

// ── Doppler API ─────────────────────────────────────────────────────────────

async function pushToDoppler(updates: Record<string, string>): Promise<void> {
  const token   = process.env.DOPPLER_TOKEN
  const project = process.env.DOPPLER_PROJECT
  const config  = process.env.DOPPLER_CONFIG
  if (!token || !project || !config) {
    return // Optional integration; skip silently when not configured.
  }
  const url = `${DOPPLER_BASE_URL}/configs/config/secrets?project=${encodeURIComponent(project)}&config=${encodeURIComponent(config)}`
  // Doppler expects `secrets: { NAME: { value: "..." } }` for v3.
  const secrets: Record<string, { value: string }> = {}
  for (const [k, v] of Object.entries(updates)) secrets[k] = { value: v }
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'accept':        'application/json',
      'content-type':  'application/json',
    },
    body:   JSON.stringify({ secrets }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Doppler push failed: ${res.status} ${text.slice(0, 200)}`)
  }
}

// ── Sync logic ──────────────────────────────────────────────────────────────

function envName(toolkitSlug: string): string {
  return `COMPOSIO_AUTH_CONFIG_${toolkitSlug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

async function sync(opts: { dryRun: boolean }): Promise<SyncResult> {
  const result: SyncResult = { created: [], existing: [], skipped: [], errors: [] }

  console.error('Listing existing Auth Configs from Composio…')
  const existingConfigs = opts.dryRun ? [] : await listAuthConfigs()
  const bySlug = new Map(existingConfigs.map(c => [c.toolkit.slug, c]))
  console.error(`  found ${existingConfigs.length} existing configs`)

  for (const provider of OAUTH_PROVIDERS) {
    if (provider.manualSetup) {
      result.skipped.push({
        provider,
        reason:         provider.manualSetup.reason,
        credentialsUrl: provider.manualSetup.credentialsUrl,
      })
      continue
    }

    const existing = bySlug.get(provider.toolkitSlug)
    if (existing) {
      result.existing.push({ provider, authConfigId: existing.id })
      continue
    }

    if (opts.dryRun) {
      result.created.push({ provider, authConfigId: '<would-create>' })
      continue
    }

    try {
      const id = await createComposioManagedAuthConfig(provider.toolkitSlug)
      result.created.push({ provider, authConfigId: id })
      console.error(`  ✓ created ${provider.toolkitSlug} → ${id}`)
    } catch (err) {
      result.errors.push({ provider, error: err instanceof Error ? err.message : String(err) })
      console.error(`  ✗ ${provider.toolkitSlug}: ${err instanceof Error ? err.message : err}`)
    }
  }

  return result
}

function printReport(r: SyncResult, opts: { dryRun: boolean }) {
  const log = (s: string) => console.log(s)

  log('')
  log('═══ Auth Config Sync Report ═══')
  log('')

  if (r.existing.length) {
    log('─ Already configured (no change) ─')
    for (const { provider, authConfigId } of r.existing) {
      log(`  ${provider.toolkitSlug.padEnd(20)} ${authConfigId}`)
    }
    log('')
  }

  if (r.created.length) {
    log(opts.dryRun ? '─ Would create ─' : '─ Created ─')
    for (const { provider, authConfigId } of r.created) {
      log(`  ${provider.toolkitSlug.padEnd(20)} ${authConfigId}`)
    }
    log('')
  }

  if (r.skipped.length) {
    log('─ Manual setup required ─')
    for (const { provider, reason, credentialsUrl } of r.skipped) {
      log(`  ${provider.toolkitSlug}: ${reason}`)
      if (credentialsUrl) log(`     credentials → ${credentialsUrl}`)
    }
    log('')
  }

  if (r.errors.length) {
    log('─ Errors ─')
    for (const { provider, error } of r.errors) log(`  ${provider.toolkitSlug}: ${error}`)
    log('')
  }

  // Doppler-set helpers — useful when the operator runs locally and pastes manually.
  const allKnown = [...r.created, ...r.existing]
  if (allKnown.length) {
    log('─ Doppler env (paste if not auto-pushed) ─')
    for (const { provider, authConfigId } of allKnown) {
      log(`  ${envName(provider.toolkitSlug)} = ${authConfigId}`)
    }
    log('')
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  if (!dryRun && !process.env.COMPOSIO_API_KEY) {
    console.error('ERROR: COMPOSIO_API_KEY missing — run via `doppler run --` or export it manually.')
    process.exit(1)
  }

  const result = await sync({ dryRun })
  printReport(result, { dryRun })

  // Auto-push to Doppler when token is present and we're not in dry-run.
  if (!dryRun && process.env.DOPPLER_TOKEN) {
    const updates: Record<string, string> = {}
    for (const { provider, authConfigId } of [...result.created, ...result.existing]) {
      updates[envName(provider.toolkitSlug)] = authConfigId
    }
    if (Object.keys(updates).length > 0) {
      try {
        await pushToDoppler(updates)
        console.log(`✓ Pushed ${Object.keys(updates).length} secrets to Doppler (${process.env.DOPPLER_PROJECT}/${process.env.DOPPLER_CONFIG})`)
      } catch (err) {
        console.error(`✗ Doppler push failed: ${err instanceof Error ? err.message : err}`)
        process.exit(1)
      }
    }
  }

  if (result.errors.length > 0) process.exit(1)
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack ?? err.message : err)
  process.exit(1)
})

/**
 * POST /api/businesses/:slug/provision
 *
 * Provisions a per-business Claude Code gateway container on Coolify.
 *
 * Steps:
 *   1. Resolve the MCP manifest from the business niche / money_model.
 *   2. Generate a per-container bearer token + an FQDN for the container.
 *   3. Create the Coolify application from the per-business image, with env
 *      that includes the bearer token + nexus identification labels.
 *   4. Persist `business:<slug>` secrets (gatewayUrl + bearerToken) into
 *      user_secrets — the dispatch route's resolveClawConfig already looks
 *      these up first when a businessSlug is passed.
 *   5. Return the new app's URL + manifest summary.
 *
 * Activation is deferred — the owner reviews the container in Coolify, then
 * clicks Start. This is intentional: a partially-built image shouldn't
 * silently start drawing money.
 *
 * Auth (two modes — either is sufficient):
 *   1. Clerk session + ALLOWED_USER_IDS owner gate (interactive)
 *   2. Authorization: Bearer <NEXUS_OPS_TOKEN> (curl, scripts, GHA)
 *      In bearer mode, target user defaults to ALLOWED_USER_IDS[0]; pass
 *      `userId` in the body to override (must still be in ALLOWED_USER_IDS).
 *
 * Body:
 *   { niche?: string, moneyModel?: string, image?: string, fqdn?: string,
 *     userId?: string }
 *
 * Response 200:
 *   { ok: true, uuid, fqdn, manifest: { profile, mcpIds }, secretsWritten }
 */

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { setSecret } from '@/lib/user-secrets'
import { createApp, findAppByName, isConfigured as isCoolifyConfigured, CoolifyError } from '@/lib/coolify/client'
import { resolveManifest, MCP_CATALOG } from '@/lib/businesses/mcp-manifest'
import { isBusinessSlug, businessKind } from '@/lib/claw/business-client'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { OAUTH_PROVIDERS } from '@/lib/oauth/providers'
import { decrypt } from '@/lib/crypto'
import { createServerClient } from '@/lib/supabase'

export const runtime    = 'nodejs'
export const maxDuration = 60

interface ProvisionBody {
  niche?:      string
  moneyModel?: string
  image?:      string
  fqdn?:       string
  /** Bearer-mode only: target this user id instead of the default ALLOWED_USER_IDS[0]. */
  userId?:     string
}

const DEFAULT_IMAGE_REPO = process.env.NEXUS_BUSINESS_IMAGE_REPO ?? 'ghcr.io/pinnacleadvisors/nexus-business'

function generateBearerToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Build a (envVar → platformId) reverse-lookup from the OAuth provider
 * registry. Only providers flagged `apiKeySetup` with a populated
 * `envVar` field participate — those are the non-Composio platforms
 * whose decrypted key is injected at provision time.
 */
function envVarToPlatformMap(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of OAUTH_PROVIDERS) {
    const ev = p.apiKeySetup?.envVar
    if (ev) out[ev] = p.id
  }
  return out
}

/**
 * Decode a bytea value returned by supabase-js. PostgREST serialises bytea as
 * a `\x<hex>` string in JSON; node-postgres clients sometimes return a Buffer
 * directly. A5's contract is that the bytes are the UTF-8 encoding of the
 * canonical "<iv>:<tag>:<ciphertext>" string from lib/crypto encrypt().
 *
 * Returns null when the value isn't a recognisable shape.
 */
function decodeByteaToUtf8(value: unknown): string | null {
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) {
      try { return Buffer.from(value.slice(2), 'hex').toString('utf8') } catch { return null }
    }
    return value
  }
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (value && typeof value === 'object' && 'data' in (value as Record<string, unknown>)) {
    const data = (value as { data: unknown }).data
    if (Array.isArray(data))         return Buffer.from(data as number[]).toString('utf8')
    if (data instanceof Uint8Array)  return Buffer.from(data).toString('utf8')
  }
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  return null
}

interface KeyRow { encrypted_api_key: unknown }

/**
 * Fetch the active encrypted_api_key for (user, businessSlug, platform) and
 * decrypt it. Returns null when no row exists, no key is stored, or
 * decryption fails — caller logs + skips injection (non-blocking).
 */
async function fetchDecryptedApiKey(
  userId: string,
  businessSlug: string,
  platform: string,
): Promise<string | null> {
  const db = createServerClient()
  if (!db) return null

  type Chain = {
    eq:    (col: string, val: unknown) => Chain
    is:    (col: string, val: unknown) => Chain
    limit: (n: number) => Promise<{ data: KeyRow[] | null }>
  }
  const from = (db.from('connected_accounts' as never) as unknown as {
    select: (cols: string) => Chain
  })

  // Per-business row first.
  const perBiz = await (from
    .select('encrypted_api_key')
    .eq('user_id', userId)
    .eq('business_slug', businessSlug)
    .eq('platform', platform)
    .eq('status', 'active') as Chain).limit(1)

  let row = perBiz.data?.[0]

  // Fall back to user-default (business_slug IS NULL) when no per-business
  // row exists. Mirrors the same partition order executeBusinessAction()
  // uses, and lets the operator share Stripe / Vercel / etc. across every
  // business via a single Default-scope connection. See providers.ts
  // sharePolicy: 'shareable' for which platforms expect this fallback.
  if (!row || row.encrypted_api_key == null) {
    const def = await (from
      .select('encrypted_api_key')
      .eq('user_id', userId)
      .is('business_slug', null)
      .eq('platform', platform)
      .eq('status', 'active') as Chain).limit(1)
    row = def.data?.[0]
  }

  if (!row || row.encrypted_api_key == null) return null

  const ciphertext = decodeByteaToUtf8(row.encrypted_api_key)
  if (!ciphertext) return null

  return decrypt(ciphertext)
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const rl = await rateLimit(req, { limit: 5, window: '5 m', prefix: 'businesses:provision' })
  if (!rl.success) return rateLimitResponse(rl)

  const { slug } = await context.params
  if (!isBusinessSlug(slug)) {
    return NextResponse.json({ error: 'invalid businessSlug' }, { status: 400 })
  }

  let body: ProvisionBody = {}
  try { body = (await req.json()) as ProvisionBody } catch { /* empty body is fine */ }

  // Two-mode auth — Clerk session (browser) OR Bearer NEXUS_OPS_TOKEN (curl,
  // scripts). Bearer-mode falls back to ALLOWED_USER_IDS[0] for the userId
  // unless body.userId is set. See lib/auth/ops-auth.ts.
  const a = await authenticateOps(req, { bodyUserId: body.userId })
  if ('response' in a) return a.response

  if (!isCoolifyConfigured()) {
    return NextResponse.json(
      { error: 'Coolify not configured — set COOLIFY_KVM4_URL, COOLIFY_KVM4_API_TOKEN, COOLIFY_PROJECT_ID_NEXUS_BUSINESSES, COOLIFY_KVM4_SERVER_UUID' },
      { status: 503 },
    )
  }

  const manifest = resolveManifest({
    niche:      body.niche ?? null,
    moneyModel: body.moneyModel ?? null,
  })

  // Build the npm-package list for the image build args.
  const mcpPackages = manifest.mcps.map(m => m.pkg).join(' ')

  // Image tag matches the slug for one-image-per-business simplicity. The
  // image must already be built + pushed; this provisioner doesn't trigger
  // CI. (Phase 5a's Dockerfile.business is the build recipe.)
  const image = body.image ?? `${DEFAULT_IMAGE_REPO}:${slug}`
  // FQDN: if operator passes one, use it. Otherwise leave undefined and
  // Coolify auto-generates a *.sslip.io domain (works fine for early testing,
  // owner can swap to a real domain later via the Coolify UI).
  const fqdn  = body.fqdn ?? (process.env.NEXUS_BUSINESS_DOMAIN_TEMPLATE
    ? process.env.NEXUS_BUSINESS_DOMAIN_TEMPLATE.replace(/\{slug\}/g, slug)
    : undefined)

  const bearerToken = generateBearerToken()

  // Env: secrets-by-name reference Coolify's shared secrets store; values
  // injected at runtime. NEXUS_*  labels make logs greppable.
  const env: Record<string, string> = {
    NEXUS_BUSINESS_SLUG:   slug,
    CLAUDE_GATEWAY_BEARER: bearerToken,
    CLAUDE_GATEWAY_PORT:   '3000',
    MCP_PACKAGES:          mcpPackages,
    MCP_PROFILE:           manifest.profile,
  }
  // Source every required env var (per-MCP `env` ∪ profile-level `env`) from
  // Coolify shared variables. The provisioner just references the names so a
  // missing secret surfaces as an empty env var in the container, not as a
  // leaked value here. Walking `requiredEnv` (vs `envVars`) covers profile-
  // level vars like CONVERTKIT_API_KEY that aren't owned by any single MCP.
  for (const v of manifest.requiredEnv) {
    if (v in process.env) env[v] = process.env[v] as string
  }
  // Always-injected platform env: Claude CLI auth (covers headless containers
  // where 'claude login' isn't possible because no terminal access). The
  // entrypoint prefers CLAUDE_CODE_OAUTH_TOKEN (Max plan, non-interactive)
  // and falls back to ANTHROPIC_API_KEY when present.
  for (const v of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']) {
    if (v in process.env) env[v] = process.env[v] as string
  }

  // ── Per-business API-key injection (apiKeySetup pattern, A5 + C4) ─────
  // For every env var the manifest declares, look up the corresponding
  // `apiKeySetup` provider in the OAuth registry, fetch the active row
  // from connected_accounts for (user, businessSlug, platform), decrypt
  // encrypted_api_key, and inject under the env-var name. Missing rows /
  // null keys log a warning and SKIP — the agent's call will 401 and
  // that's the agent's problem to handle gracefully. Never log values.
  const envVarPlatform = envVarToPlatformMap()
  const apiKeysInjected: string[] = []
  for (const envVar of manifest.requiredEnv) {
    const platform = envVarPlatform[envVar]
    if (!platform) continue // Composio-managed / build-time env — not an apiKeySetup target
    const decrypted = await fetchDecryptedApiKey(a.userId, slug, platform)
    if (!decrypted) {
      console.warn(`[provision] missing api-key for env=${envVar} platform=${platform} business=${slug}`)
      continue
    }
    env[envVar] = decrypted
    apiKeysInjected.push(envVar)
  }

  // ── Idempotency: skip create if an app with this name already exists ──
  // Coolify allows duplicates by name; without this check, every retry after
  // a post-create failure would leave another orphan app. Re-using the
  // existing one means the operator can re-run safely until secrets land.
  const expectedName = `nexus-business-${slug}`
  let created: { uuid: string; name?: string; fqdn?: string; domains?: string } | null = null
  let reusedExisting = false
  try {
    const existing = await findAppByName(expectedName)
    if (existing) {
      created = existing
      reusedExisting = true
    }
  } catch (err) {
    // Lookup failure isn't fatal — fall through to create. Logged in audit.
    console.warn('[provision] findAppByName failed, will attempt create:', err instanceof Error ? err.message : err)
  }

  if (!created) {
    try {
      created = await createApp({
        businessSlug: slug,
        image,
        fqdn,
        env,
      })
    } catch (err) {
      const status      = err instanceof CoolifyError ? err.status : 502
      const coolifyBody = err instanceof CoolifyError ? err.body   : undefined
      const message     = err instanceof Error        ? err.message : 'coolify create failed'
      audit(req, {
        action:     'businesses.provision',
        resource:   'business',
        resourceId: slug,
        userId:     a.userId,
        metadata:   { authMode: a.mode, error: message, status, profile: manifest.profile, coolifyBody: coolifyBody?.slice(0, 500) },
      })
      return NextResponse.json(
        { error: message, coolifyResponse: coolifyBody?.slice(0, 800) },
        { status: status >= 400 && status < 600 ? status : 502 },
      )
    }
  }

  // ── Post-create work — wrapped in try/catch so any throw returns JSON
  //    instead of crashing into Vercel's empty 500. The Coolify app exists
  //    by this point; we want the operator to see the orphan uuid so they
  //    can decide whether to reuse it (next provision call will pick it up
  //    via findAppByName) or delete it manually.
  try {
    const resolvedFqdn = (created.domains ?? created.fqdn ?? fqdn ?? '').replace(/^https?:\/\//, '')
    const gatewayUrl   = resolvedFqdn ? `https://${resolvedFqdn}` : ''
    const wroteUrl     = gatewayUrl ? await setSecret(a.userId, businessKind(slug), 'gatewayUrl',  gatewayUrl) : false
    const wroteToken   = await setSecret(a.userId, businessKind(slug), 'bearerToken', bearerToken)

    audit(req, {
      action:     'businesses.provision',
      resource:   'business',
      resourceId: slug,
      userId:     a.userId,
      metadata:   {
        authMode:        a.mode,
        uuid:            created.uuid,
        fqdn:            resolvedFqdn,
        profile:         manifest.profile,
        mcps:            manifest.mcpIds.length,
        reusedExisting,
        apiKeysInjected: apiKeysInjected.length,  // names only logged via console.warn on miss; values never logged
      },
    })

    return NextResponse.json({
      ok:             true,
      uuid:           created.uuid,
      fqdn:           resolvedFqdn,
      gatewayUrl,
      secretsWritten: wroteUrl && wroteToken,
      reusedExisting,
      apiKeysInjected,
      manifest: {
        profile: manifest.profile,
        mcpIds:  manifest.mcpIds,
        missingFromCatalog: manifest.mcpIds.filter(id => !MCP_CATALOG.find(m => m.id === id)),
      },
      note: reusedExisting
        ? 'Reused existing Coolify app. Review configuration in Coolify, then click Deploy.'
        : 'Container created in Coolify but not started. Review the deployment in Coolify, then click Start.',
    })
  } catch (err) {
    // Coolify app exists, but post-create persistence failed. Surface the
    // uuid so the operator can re-run (idempotent) or manually clean up.
    const message = err instanceof Error ? err.message : 'post-create persistence failed'
    audit(req, {
      action:     'businesses.provision',
      resource:   'business',
      resourceId: slug,
      userId:     a.userId,
      metadata:   {
        authMode:        a.mode,
        error:           message,
        status:          500,
        stage:           'post-create',
        coolifyAppUuid:  created.uuid,
        profile:         manifest.profile,
        reusedExisting,
      },
    })
    return NextResponse.json(
      {
        error:          'post-create persistence failed',
        message,
        coolifyAppUuid: created.uuid,
        reusedExisting,
        hint:           'The Coolify app exists. Re-running this endpoint will reuse it (idempotent). Persistence failed at setSecret/audit stage — check ENCRYPTION_KEY + SUPABASE_SERVICE_ROLE_KEY env.',
      },
      { status: 500 },
    )
  }
}

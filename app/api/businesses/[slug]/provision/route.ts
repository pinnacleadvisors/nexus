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
import { createApp, isConfigured as isCoolifyConfigured, CoolifyError } from '@/lib/coolify/client'
import { resolveManifest, MCP_CATALOG } from '@/lib/businesses/mcp-manifest'
import { isBusinessSlug, businessKind } from '@/lib/claw/business-client'
import { authenticateOps } from '@/lib/auth/ops-auth'

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
      { error: 'Coolify not configured — set COOLIFY_BASE_URL, COOLIFY_API_TOKEN, COOLIFY_PROJECT_ID_NEXUS_BUSINESSES, COOLIFY_KVM4_SERVER_UUID' },
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
  const fqdn  = body.fqdn  ?? `${slug}.gateway.nexus.example.com`

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
  // Source every MCP env var from Coolify shared variables — operator must
  // have populated them ahead of time. The provisioner just references the
  // names so a missing secret surfaces as an empty env var in the container,
  // not as a leaked value here.
  for (const v of manifest.envVars) {
    if (v in process.env) env[v] = process.env[v] as string
  }

  let created
  try {
    created = await createApp({
      businessSlug: slug,
      image,
      fqdn,
      env,
    })
  } catch (err) {
    const status = err instanceof CoolifyError ? err.status : 502
    audit(req, {
      action:     'businesses.provision',
      resource:   'business',
      resourceId: slug,
      userId:     a.userId,
      metadata:   { authMode: a.mode, error: err instanceof Error ? err.message : 'coolify create failed', status, profile: manifest.profile },
    })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'coolify create failed' },
      { status: status >= 400 && status < 600 ? status : 502 },
    )
  }

  // Persist the gateway config so dispatch picks it up via resolveClawConfig.
  // gatewayUrl uses https + the FQDN; if Coolify hasn't issued a cert yet,
  // the operator can flip to http until one is ready.
  const gatewayUrl  = `https://${created.fqdn ?? fqdn}`
  const wroteUrl    = await setSecret(a.userId, businessKind(slug), 'gatewayUrl',  gatewayUrl)
  const wroteToken  = await setSecret(a.userId, businessKind(slug), 'bearerToken', bearerToken)

  audit(req, {
    action:     'businesses.provision',
    resource:   'business',
    resourceId: slug,
    userId:     a.userId,
    metadata:   {
      authMode: a.mode,
      uuid:    created.uuid,
      fqdn:    created.fqdn ?? fqdn,
      profile: manifest.profile,
      mcps:    manifest.mcpIds.length,
    },
  })

  return NextResponse.json({
    ok:             true,
    uuid:           created.uuid,
    fqdn:           created.fqdn ?? fqdn,
    gatewayUrl,
    secretsWritten: wroteUrl && wroteToken,
    manifest: {
      profile: manifest.profile,
      mcpIds:  manifest.mcpIds,
      missingFromCatalog: manifest.mcpIds.filter(id => !MCP_CATALOG.find(m => m.id === id)),
    },
    note: 'Container created in Coolify but not started. Review the deployment in Coolify, then click Start.',
  })
}

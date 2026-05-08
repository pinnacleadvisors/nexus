/**
 * Coolify v4 API client — the lifecycle primitive for per-business containers.
 *
 * Coolify exposes a REST API at https://coolify.example.com/api/v1/* with a
 * personal access token. We model only the operations the provisioner needs:
 *
 *   - createApp({ businessSlug, image, env })   — `POST /applications/dockerimage`
 *   - getApp(id)                                — `GET  /applications/:id`
 *   - deleteApp(id)                             — `DELETE /applications/:id`
 *   - startApp(id)                              — `POST /applications/:id/start`
 *   - stopApp(id)                               — `POST /applications/:id/stop`
 *
 * Required env (matches Doppler names — KVM4-specific because per-business
 * apps live on KVM4 in the current setup):
 *   COOLIFY_KVM4_URL                    e.g. https://coolify.coolifycloudtunnel.uk
 *   COOLIFY_KVM4_API_TOKEN              personal access token from Coolify settings
 *   COOLIFY_PROJECT_ID_NEXUS_BUSINESSES uuid of the Coolify project that holds per-business apps
 *   COOLIFY_KVM4_SERVER_UUID            uuid of the Coolify server the apps run on
 *
 * Naming reflects the multi-instance setup: KVM2 hosts the codex-gateway,
 * KVM4 hosts claude-gateway + per-business containers. Future KVM2-side
 * provisioning would add a parallel `COOLIFY_KVM2_*` resolver.
 *
 * The wrapper throws CoolifyError on any non-2xx; callers should wrap in
 * try/catch and log to audit_log via lib/audit.
 */

const DEFAULT_TIMEOUT_MS = 20_000

export class CoolifyError extends Error {
  status:    number
  body?:     string
  constructor(message: string, status = 500, body?: string) {
    super(message)
    this.name = 'CoolifyError'
    this.status = status
    this.body = body
  }
}

interface CoolifyConfig {
  baseUrl:     string
  token:       string
  projectId:   string
  serverUuid:  string
}

function getConfig(): CoolifyConfig {
  const baseUrl    = process.env.COOLIFY_KVM4_URL
  const token      = process.env.COOLIFY_KVM4_API_TOKEN
  const projectId  = process.env.COOLIFY_PROJECT_ID_NEXUS_BUSINESSES
  const serverUuid = process.env.COOLIFY_KVM4_SERVER_UUID
  if (!baseUrl)    throw new CoolifyError('COOLIFY_KVM4_URL not configured', 500)
  if (!token)      throw new CoolifyError('COOLIFY_KVM4_API_TOKEN not configured', 500)
  if (!projectId)  throw new CoolifyError('COOLIFY_PROJECT_ID_NEXUS_BUSINESSES not configured', 500)
  if (!serverUuid) throw new CoolifyError('COOLIFY_KVM4_SERVER_UUID not configured', 500)
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    token,
    projectId,
    serverUuid,
  }
}

export function isConfigured(): boolean {
  return Boolean(
    process.env.COOLIFY_KVM4_URL &&
    process.env.COOLIFY_KVM4_API_TOKEN &&
    process.env.COOLIFY_PROJECT_ID_NEXUS_BUSINESSES &&
    process.env.COOLIFY_KVM4_SERVER_UUID,
  )
}

async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
  const cfg = getConfig()
  const url = `${cfg.baseUrl}/api/v1${path}`
  const ac  = new AbortController()
  const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...options,
      signal:  ac.signal,
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Authorization': `Bearer ${cfg.token}`,
        ...options.headers,
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new CoolifyError(`coolify ${options.method ?? 'GET'} ${path} → ${res.status}`, res.status, body.slice(0, 500))
    }
    if (res.status === 204) return undefined as unknown as T
    return res.json() as Promise<T>
  } finally {
    clearTimeout(timer)
  }
}

// ── Operations ───────────────────────────────────────────────────────────────

export interface CoolifyAppRow {
  uuid:   string
  name:   string
  status: string
  fqdn?:  string
}

export interface CreateAppInput {
  businessSlug:   string
  /** Docker image registry path including tag (e.g. ghcr.io/pinnacleadvisors/nexus-business:acme-ads). */
  image:          string
  /** Env vars to inject. Posted to /applications/{uuid}/envs after create — the
   *  create endpoint itself doesn't accept env vars. */
  env:            Record<string, string>
  /** Public hostname Coolify routes to this app. Pass bare hostname; we'll
   *  prepend https://. Omit to let Coolify auto-generate a *.sslip.io domain. */
  fqdn?:          string
  /** Optional: override the default 3000 if the image listens elsewhere. */
  port?:          number
  /** Coolify environment within the project. Defaults to 'production' which is
   *  the default Coolify creates per project. */
  environmentName?: string
}

export interface CreateAppResult {
  uuid:    string
  name:    string
  fqdn?:   string
  /** Coolify v4's create response field is `domains` (not `fqdn`); kept for
   *  back-compat — same value. */
  domains?: string
}

/**
 * Create a Docker-image-backed application in the configured Coolify project.
 * Coolify v4 separates the resource creation from the start; the caller must
 * call `startApp(uuid)` to bring it up.
 *
 * Coolify v4 quirks this wrapper smooths over:
 *   - The `image` arg gets split into `docker_registry_image_name` +
 *     `docker_registry_image_tag` on the wire (the `docker_image` field is
 *     rejected).
 *   - `custom_labels` MUST be base64 encoded ("The custom_labels should be
 *     base64 encoded.").
 *   - `environment_name` is required ("provide at least one of
 *     environment_name or environment_uuid").
 *   - `environment_variables` is NOT a valid field on create — env vars go
 *     to /applications/{uuid}/envs after the app exists.
 *   - `domains` (not `fqdn`) and must be a full URL with protocol.
 */
export async function createApp(input: CreateAppInput): Promise<CreateAppResult> {
  const cfg = getConfig()

  // Split image into name + tag at the LAST colon. Tags can't contain `:`,
  // and registry hosts can include a port (e.g. `localhost:5000/foo:tag`).
  const lastColon = input.image.lastIndexOf(':')
  const slashAfterColon = lastColon > 0 ? input.image.indexOf('/', lastColon) : -1
  const hasTag = lastColon > 0 && slashAfterColon === -1
  const imageName = hasTag ? input.image.slice(0, lastColon) : input.image
  const imageTag  = hasTag ? input.image.slice(lastColon + 1) : 'latest'

  const labelLines = [
    `nexus.business.slug=${input.businessSlug}`,
    'nexus.app.kind=per-business-claude-gateway',
  ].join('\n')

  const body: Record<string, unknown> = {
    project_uuid:               cfg.projectId,
    server_uuid:                cfg.serverUuid,
    environment_name:           input.environmentName ?? 'production',
    name:                       `nexus-business-${input.businessSlug}`,
    description:                `Per-business Claude Code gateway for ${input.businessSlug}`,
    docker_registry_image_name: imageName,
    docker_registry_image_tag:  imageTag,
    ports_exposes:              String(input.port ?? 3000),
    instant_deploy:             false,
    custom_labels:              Buffer.from(labelLines, 'utf8').toString('base64'),
  }
  if (input.fqdn) {
    body.domains = input.fqdn.startsWith('http') ? input.fqdn : `https://${input.fqdn}`
  }

  const created = await call<CreateAppResult>('/applications/dockerimage', {
    method: 'POST',
    body:   JSON.stringify(body),
  })

  // Env vars go in via a per-var endpoint after create. There's no documented
  // bulk endpoint as of Coolify v4 (we tested /envs/bulk → 404). Failures on
  // individual vars are logged but don't fail the whole create — the operator
  // can fix in the Coolify UI rather than rolling back the whole app.
  for (const [key, value] of Object.entries(input.env)) {
    if (value === '') continue // skip empty values (Coolify rejects them)
    try {
      await call(`/applications/${encodeURIComponent(created.uuid)}/envs`, {
        method: 'POST',
        body:   JSON.stringify({ key, value, is_literal: true }),
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[coolify] env ${key} failed for app ${created.uuid}:`, err instanceof Error ? err.message : err)
    }
  }

  return created
}

export async function getApp(uuid: string): Promise<CoolifyAppRow | null> {
  try {
    return await call<CoolifyAppRow>(`/applications/${encodeURIComponent(uuid)}`)
  } catch (err) {
    if (err instanceof CoolifyError && err.status === 404) return null
    throw err
  }
}

export async function deleteApp(uuid: string): Promise<void> {
  await call<void>(`/applications/${encodeURIComponent(uuid)}`, { method: 'DELETE' })
}

export async function startApp(uuid: string): Promise<void> {
  await call<void>(`/applications/${encodeURIComponent(uuid)}/start`, { method: 'POST' })
}

export async function stopApp(uuid: string): Promise<void> {
  await call<void>(`/applications/${encodeURIComponent(uuid)}/stop`, { method: 'POST' })
}

export async function listApps(): Promise<CoolifyAppRow[]> {
  return call<CoolifyAppRow[]>('/applications')
}

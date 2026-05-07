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
 * Required env:
 *   COOLIFY_BASE_URL                   e.g. https://coolify.coolifycloudtunnel.uk
 *   COOLIFY_API_TOKEN                  personal access token from Coolify settings
 *   COOLIFY_PROJECT_ID_NEXUS_BUSINESSES uuid of the Coolify project that holds per-business apps
 *   COOLIFY_KVM4_SERVER_UUID           uuid of the Coolify server the apps run on (KVM4 in our setup)
 *
 * Naming reflects the multi-instance + multi-project Coolify setup: KVM2 and
 * KVM4 each have their own project for non-business apps; this code path
 * targets the dedicated "Nexus Businesses" project on KVM4 specifically.
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
  const baseUrl    = process.env.COOLIFY_BASE_URL
  const token      = process.env.COOLIFY_API_TOKEN
  const projectId  = process.env.COOLIFY_PROJECT_ID_NEXUS_BUSINESSES
  const serverUuid = process.env.COOLIFY_KVM4_SERVER_UUID
  if (!baseUrl)    throw new CoolifyError('COOLIFY_BASE_URL not configured', 500)
  if (!token)      throw new CoolifyError('COOLIFY_API_TOKEN not configured', 500)
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
    process.env.COOLIFY_BASE_URL &&
    process.env.COOLIFY_API_TOKEN &&
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
  /** Docker image registry path (e.g. ghcr.io/pinnacleadvisors/nexus-business:acme-ads). */
  image:          string
  /** Env vars to inject. NEVER pass secret values directly — use a Coolify
   *  shared variable name reference; this wrapper stamps `{ key, value, isShared: true }`. */
  env:            Record<string, string>
  /** Public hostname Coolify routes to this app. */
  fqdn?:          string
  /** Optional: override the default 3000 if the image listens elsewhere. */
  port?:          number
}

export interface CreateAppResult {
  uuid:    string
  name:    string
  fqdn?:   string
}

/**
 * Create a Docker-image-backed application in the configured Coolify project.
 * Coolify v4 separates the resource creation from the start; the caller must
 * call `startApp(uuid)` to bring it up.
 */
export async function createApp(input: CreateAppInput): Promise<CreateAppResult> {
  const cfg = getConfig()
  const body = {
    project_uuid:    cfg.projectId,
    server_uuid:     cfg.serverUuid,
    name:            `nexus-business-${input.businessSlug}`,
    description:     `Per-business Claude Code gateway for ${input.businessSlug}`,
    docker_image:    input.image,
    ports_exposes:   String(input.port ?? 3000),
    fqdn:            input.fqdn,
    instant_deploy:  false,
    environment_variables: Object.entries(input.env).map(([key, value]) => ({
      key,
      value,
      is_preview:  false,
      is_build_time: false,
      is_literal:  true,
    })),
    labels: [
      `nexus.business.slug=${input.businessSlug}`,
      'nexus.app.kind=per-business-claude-gateway',
    ].join('\n'),
  }

  return call<CreateAppResult>('/applications/dockerimage', {
    method: 'POST',
    body:   JSON.stringify(body),
  })
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

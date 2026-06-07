/**
 * lib/ecosystems/adapters/did.ts — `avatar` adapter for D-ID talking-head video.
 *
 * The documented talking-head FALLBACK to HeyGen (see heygen.ts header). Same
 * verb shape as heygen (`synthesize_avatar` / `get_avatar_status`) so it's a
 * drop-in rebind in /teams. Best-effort async HTTP router (higgsfield.ts /
 * heygen.ts pattern): env-gated, payload pass-through, 429→rate_limited.
 *
 * ⚠️ Upstream-contract note: D-ID's REST surface (POST /talks → handle,
 * GET /talks/{id} → status) and Basic auth are taken from D-ID's published
 * docs; verify against a live DID_API_KEY before relying on it for prod.
 *
 * Env:
 *   DID_API_KEY — Basic auth (the dashboard key is already in `email:key`
 *                 base64 form; sent verbatim as `Authorization: Basic <key>`)
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['synthesize_avatar', 'get_avatar_status'] as const
type Verb = (typeof VERBS)[number]

const API_BASE = 'https://api.d-id.com'

interface SynthesizeAvatarPayload {
  script:      string
  /** Source image URL the avatar is rendered from. */
  source_url?: string
  voice_id?:   string
}

interface GetAvatarStatusPayload {
  /** D-ID returns this as the talk `id` from synthesize_avatar. Accept either key. */
  talk_id?:  string
  video_id?: string
}

function envKey(): string | undefined { return process.env.DID_API_KEY }

export const didAdapter: EcosystemAdapter = {
  kind:         'avatar',
  name:         'did',
  label:        'D-ID (talking-head fallback)',
  capabilities: VERBS,
  available:    () => Boolean(envKey()),
  invoke:       invokeDid,
}

async function invokeDid(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!didAdapter.available()) {
    return unavailable('did', verb, 'Set DID_API_KEY to enable D-ID talking-head video.')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('did', verb, VERBS)
  const auth = { authorization: `Basic ${envKey()!}` }

  try {
    if (verb === 'synthesize_avatar') {
      const p = (payload ?? {}) as SynthesizeAvatarPayload
      if (typeof p.script !== 'string' || !p.script.trim()) {
        return { ok: false, adapter: 'did', verb, error: 'upstream_error', message: 'synthesize_avatar requires non-empty `script`' }
      }
      const t0 = Date.now()
      const res = await fetch(`${API_BASE}/talks`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body:    JSON.stringify({
          source_url: p.source_url,
          script:     { type: 'text', input: p.script, ...(p.voice_id ? { provider: { type: 'microsoft', voice_id: p.voice_id } } : {}) },
        }),
        signal: AbortSignal.timeout(30_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) return httpError(verb, res.status, latency)
      return { ok: true, adapter: 'did', verb, result: await res.json(), telemetry: { latency_ms: latency } }
    }

    const p = (payload ?? {}) as GetAvatarStatusPayload
    const id = p.talk_id ?? p.video_id
    if (!id) {
      return { ok: false, adapter: 'did', verb, error: 'upstream_error', message: 'get_avatar_status requires `talk_id`' }
    }
    const t0 = Date.now()
    const res = await fetch(`${API_BASE}/talks/${encodeURIComponent(id)}`, {
      headers: auth,
      signal:  AbortSignal.timeout(15_000),
    })
    const latency = Date.now() - t0
    if (!res.ok) return httpError(verb, res.status, latency)
    return { ok: true, adapter: 'did', verb, result: await res.json(), telemetry: { latency_ms: latency } }
  } catch (e) {
    return { ok: false, adapter: 'did', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'did call failed' }
  }
}

function httpError(verb: string, status: number, latency: number): EcosystemResult {
  return {
    ok: false, adapter: 'did', verb,
    error: status === 429 ? 'rate_limited' : 'upstream_error',
    message: `did ${verb} → ${status}`,
    telemetry: { http_status: status, latency_ms: latency },
  }
}

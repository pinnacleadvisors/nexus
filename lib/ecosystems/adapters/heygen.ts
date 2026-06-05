/**
 * lib/ecosystems/adapters/heygen.ts — `avatar` adapter for HeyGen UGC/avatar video.
 *
 * Best-effort async HTTP router (higgsfield.ts pattern). `synthesize_avatar`
 * submits a talking-avatar video job and returns a handle; `get_avatar_status`
 * polls. Surface contract is best-effort — tighten when a key is wired.
 *
 * Default `avatar` binding (lib/teams/default-bindings.ts). D-ID (DID_API_KEY)
 * is the documented talking-head fallback; a sibling `did` adapter can be added
 * later with the same shape.
 *
 * Env:
 *   HEYGEN_API_KEY — X-Api-Key header (required to be "available")
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['synthesize_avatar', 'get_avatar_status'] as const
type Verb = (typeof VERBS)[number]

const API_BASE = 'https://api.heygen.com'

interface SynthesizeAvatarPayload {
  script:     string
  avatar_id?: string
  voice_id?:  string
}

interface GetAvatarStatusPayload {
  video_id: string
}

function envKey(): string | undefined { return process.env.HEYGEN_API_KEY }

export const heygenAdapter: EcosystemAdapter = {
  kind:         'avatar',
  name:         'heygen',
  label:        'HeyGen (UGC / avatar video)',
  capabilities: VERBS,
  available:    () => Boolean(envKey()),
  invoke:       invokeHeygen,
}

async function invokeHeygen(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!heygenAdapter.available()) {
    return unavailable('heygen', verb, 'Set HEYGEN_API_KEY to enable avatar video generation.')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('heygen', verb, VERBS)
  const auth = { 'x-api-key': envKey()! }

  try {
    if (verb === 'synthesize_avatar') {
      const p = (payload ?? {}) as SynthesizeAvatarPayload
      if (typeof p.script !== 'string' || !p.script.trim()) {
        return { ok: false, adapter: 'heygen', verb, error: 'upstream_error', message: 'synthesize_avatar requires non-empty `script`' }
      }
      const t0 = Date.now()
      const res = await fetch(`${API_BASE}/v2/video/generate`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body:    JSON.stringify({
          video_inputs: [{
            character: { type: 'avatar', avatar_id: p.avatar_id ?? 'default' },
            voice:     { type: 'text', input_text: p.script, voice_id: p.voice_id },
          }],
        }),
        signal: AbortSignal.timeout(30_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) return httpError(verb, res.status, latency)
      return { ok: true, adapter: 'heygen', verb, result: await res.json(), telemetry: { latency_ms: latency } }
    }

    const p = (payload ?? {}) as GetAvatarStatusPayload
    if (!p.video_id) {
      return { ok: false, adapter: 'heygen', verb, error: 'upstream_error', message: 'get_avatar_status requires `video_id`' }
    }
    const t0 = Date.now()
    const res = await fetch(`${API_BASE}/v1/video_status.get?video_id=${encodeURIComponent(p.video_id)}`, {
      headers: auth,
      signal:  AbortSignal.timeout(15_000),
    })
    const latency = Date.now() - t0
    if (!res.ok) return httpError(verb, res.status, latency)
    return { ok: true, adapter: 'heygen', verb, result: await res.json(), telemetry: { latency_ms: latency } }
  } catch (e) {
    return { ok: false, adapter: 'heygen', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'heygen call failed' }
  }
}

function httpError(verb: string, status: number, latency: number): EcosystemResult {
  return {
    ok: false, adapter: 'heygen', verb,
    error: status === 429 ? 'rate_limited' : 'upstream_error',
    message: `heygen ${verb} → ${status}`,
    telemetry: { http_status: status, latency_ms: latency },
  }
}

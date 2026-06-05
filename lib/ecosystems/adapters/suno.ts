/**
 * lib/ecosystems/adapters/suno.ts — `music` adapter for Suno / Udio.
 *
 * Best-effort async HTTP router (higgsfield.ts pattern). Music generation is
 * async: `generate_music` submits and returns a job handle; `get_music_status`
 * polls. Surface contract is best-effort — tighten when a key is wired.
 *
 * Default `music` binding (lib/teams/default-bindings.ts). Verb matches the
 * content asset-builder spec (`generate_music`).
 *
 * Env (either enables it; SUNO preferred):
 *   SUNO_API_KEY / UDIO_API_KEY — bearer auth
 *   SUNO_BASE_URL               — optional base override
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['generate_music', 'get_music_status'] as const
type Verb = (typeof VERBS)[number]

const PUBLIC_API_BASE = 'https://api.suno.ai'

interface GenerateMusicPayload {
  prompt:       string
  duration_s?:  number
  instrumental?: boolean
}

interface GetMusicStatusPayload {
  job_id: string
}

function envKey():  string | undefined { return process.env.SUNO_API_KEY || process.env.UDIO_API_KEY }
function envBase(): string { return process.env.SUNO_BASE_URL || PUBLIC_API_BASE }

export const sunoAdapter: EcosystemAdapter = {
  kind:         'music',
  name:         'suno',
  label:        'Suno / Udio (background music)',
  capabilities: VERBS,
  available:    () => Boolean(envKey()),
  invoke:       invokeSuno,
}

async function invokeSuno(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!sunoAdapter.available()) {
    return unavailable('suno', verb, 'Set SUNO_API_KEY (or UDIO_API_KEY) to enable music generation.')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('suno', verb, VERBS)
  const auth = { authorization: `Bearer ${envKey()}` }

  try {
    if (verb === 'generate_music') {
      const p = (payload ?? {}) as GenerateMusicPayload
      if (typeof p.prompt !== 'string' || !p.prompt.trim()) {
        return { ok: false, adapter: 'suno', verb, error: 'upstream_error', message: 'generate_music requires non-empty `prompt`' }
      }
      const t0 = Date.now()
      const res = await fetch(`${envBase()}/v1/generate`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body:    JSON.stringify({ prompt: p.prompt, duration: p.duration_s ?? 30, instrumental: p.instrumental ?? true }),
        signal:  AbortSignal.timeout(30_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) return httpError(verb, res.status, latency)
      return { ok: true, adapter: 'suno', verb, result: await res.json(), telemetry: { latency_ms: latency } }
    }

    const p = (payload ?? {}) as GetMusicStatusPayload
    if (!p.job_id) {
      return { ok: false, adapter: 'suno', verb, error: 'upstream_error', message: 'get_music_status requires `job_id`' }
    }
    const t0 = Date.now()
    const res = await fetch(`${envBase()}/v1/generate/${encodeURIComponent(p.job_id)}`, {
      headers: auth,
      signal:  AbortSignal.timeout(15_000),
    })
    const latency = Date.now() - t0
    if (!res.ok) return httpError(verb, res.status, latency)
    return { ok: true, adapter: 'suno', verb, result: await res.json(), telemetry: { latency_ms: latency } }
  } catch (e) {
    return { ok: false, adapter: 'suno', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'suno call failed' }
  }
}

function httpError(verb: string, status: number, latency: number): EcosystemResult {
  return {
    ok: false, adapter: 'suno', verb,
    error: status === 429 ? 'rate_limited' : 'upstream_error',
    message: `suno ${verb} → ${status}`,
    telemetry: { http_status: status, latency_ms: latency },
  }
}

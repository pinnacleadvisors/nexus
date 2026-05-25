/**
 * lib/ecosystems/adapters/higgsfield.ts — `video` adapter for Higgsfield (real).
 *
 * v4: HTTP client. Pattern mirrors lib/ecosystems/adapters/gbrain.ts — a
 * thin wrapper that hits the configured endpoint per verb, surfaces 429
 * as `rate_limited`, captures latency telemetry, and times out at 60s.
 *
 * Endpoint selection:
 *   - HIGGSFIELD_BASE_URL (self-hosted) takes precedence
 *   - HIGGSFIELD_API_URL  (alias used in some older configs)
 *   - falls back to the public Higgsfield API base
 *
 * Auth:
 *   - HIGGSFIELD_API_KEY → "authorization: Bearer <key>"
 *
 * The exact API surface evolves; this adapter passes the verb's payload
 * straight through and surfaces whatever the upstream returns. When the
 * content team's asset-builder needs a tighter contract, define it in
 * lib/teams/role-bundles/content.ts (future) and validate before invoke.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['render_clip', 'render_talking_head', 'list_models'] as const
type Verb = (typeof VERBS)[number]

interface RenderClipPayload {
  prompt:       string
  duration_s?:  number
  model?:       string
  aspect_ratio?: '9:16' | '16:9' | '1:1'
}

interface RenderTalkingHeadPayload {
  script:       string
  voice_id?:    string
  avatar_id?:   string
}

const PUBLIC_API_BASE = 'https://api.higgsfield.ai'

function envBase(): string | undefined {
  return process.env.HIGGSFIELD_BASE_URL || process.env.HIGGSFIELD_API_URL || PUBLIC_API_BASE
}

function envKey(): string | undefined {
  return process.env.HIGGSFIELD_API_KEY
}

function authHeader(): Record<string, string> {
  const k = envKey()
  return k ? { authorization: `Bearer ${k}` } : {}
}

export const higgsfieldAdapter: EcosystemAdapter = {
  kind:         'video',
  name:         'higgsfield',
  label:        'Higgsfield (open)',
  capabilities: VERBS,
  // Available when EITHER the self-hosted URL is set OR an API key is set
  // (so the public endpoint can be hit). The PUBLIC_API_BASE fallback in
  // envBase() means envBase() is always defined — gating on key OR explicit
  // self-hosted URL keeps the "unwired = unavailable" semantic honest.
  available:    () => Boolean(process.env.HIGGSFIELD_BASE_URL || process.env.HIGGSFIELD_API_URL || envKey()),
  invoke:       invokeHiggsfield,
}

async function invokeHiggsfield(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!higgsfieldAdapter.available()) {
    return unavailable('higgsfield', verb, 'Set HIGGSFIELD_BASE_URL (self-hosted) or HIGGSFIELD_API_KEY (hosted).')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('higgsfield', verb, VERBS)
  const base = envBase()!

  try {
    if (verb === 'list_models') {
      const t0 = Date.now()
      const res = await fetch(`${base}/v1/models`, {
        headers: authHeader(),
        signal:  AbortSignal.timeout(15_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) {
        return errorResult('higgsfield', verb, res.status, latency)
      }
      const data = await res.json()
      return { ok: true, adapter: 'higgsfield', verb, result: data, telemetry: { latency_ms: latency } }
    }

    if (verb === 'render_clip') {
      const p = (payload ?? {}) as RenderClipPayload
      if (typeof p.prompt !== 'string' || !p.prompt.trim()) {
        return { ok: false, adapter: 'higgsfield', verb, error: 'upstream_error', message: 'render_clip requires non-empty `prompt`' }
      }
      const t0 = Date.now()
      const res = await fetch(`${base}/v1/generate/video`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...authHeader() },
        body:    JSON.stringify({
          prompt:       p.prompt,
          duration:     p.duration_s ?? 6,
          model:        p.model ?? 'higgsfield-v1',
          aspect_ratio: p.aspect_ratio ?? '9:16',
        }),
        // Video generation can take a while; allow 60s before bailing.
        // Caller is responsible for polling the job-id when the upstream
        // returns 202 + a job handle (real upstream shape — surfaces in result).
        signal: AbortSignal.timeout(60_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) return errorResult('higgsfield', verb, res.status, latency)
      const data = await res.json()
      return { ok: true, adapter: 'higgsfield', verb, result: data, telemetry: { latency_ms: latency } }
    }

    if (verb === 'render_talking_head') {
      const p = (payload ?? {}) as RenderTalkingHeadPayload
      if (typeof p.script !== 'string' || !p.script.trim()) {
        return { ok: false, adapter: 'higgsfield', verb, error: 'upstream_error', message: 'render_talking_head requires non-empty `script`' }
      }
      const t0 = Date.now()
      const res = await fetch(`${base}/v1/generate/talking-head`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...authHeader() },
        body:    JSON.stringify(p),
        signal:  AbortSignal.timeout(60_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) return errorResult('higgsfield', verb, res.status, latency)
      const data = await res.json()
      return { ok: true, adapter: 'higgsfield', verb, result: data, telemetry: { latency_ms: latency } }
    }
  } catch (e) {
    return {
      ok:      false,
      adapter: 'higgsfield',
      verb,
      error:   'upstream_error',
      message: e instanceof Error ? e.message : 'higgsfield call failed',
    }
  }
  return capabilityMissing('higgsfield', verb, VERBS)
}

function errorResult(adapter: string, verb: string, status: number, latency: number): EcosystemResult {
  return {
    ok:        false,
    adapter,
    verb,
    error:     status === 429 ? 'rate_limited' : 'upstream_error',
    message:   `${adapter} ${verb} → ${status}`,
    telemetry: { http_status: status, latency_ms: latency },
  }
}

/**
 * lib/ecosystems/adapters/muapi.ts — `image` adapter for MUAPI scene images.
 *
 * Best-effort HTTP router in the higgsfield.ts pattern: env-gated, passes the
 * payload through, surfaces 429 as rate_limited, captures latency, and returns
 * whatever the upstream returns. The exact MUAPI surface evolves; tighten the
 * request/response shape here when a key is wired and the contract is confirmed.
 *
 * Default `image` binding for every niche (lib/teams/default-bindings.ts).
 * Verb name matches the content asset-builder spec (`generate_image`).
 *
 * Env:
 *   MUAPI_AI_KEY   — bearer auth (required to be "available")
 *   MUAPI_BASE_URL — optional self-hosted / regional base (else public default)
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['generate_image'] as const
type Verb = (typeof VERBS)[number]

const PUBLIC_API_BASE = 'https://api.muapi.ai'

interface GenerateImagePayload {
  prompt:        string
  aspect_ratio?: '9:16' | '16:9' | '1:1'
  model?:        string
  n?:            number
}

function envKey():  string | undefined { return process.env.MUAPI_AI_KEY }
function envBase(): string { return process.env.MUAPI_BASE_URL || PUBLIC_API_BASE }

export const muapiAdapter: EcosystemAdapter = {
  kind:         'image',
  name:         'muapi',
  label:        'MUAPI (scene images)',
  capabilities: VERBS,
  available:    () => Boolean(envKey()),
  invoke:       invokeMuapi,
}

async function invokeMuapi(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!muapiAdapter.available()) {
    return unavailable('muapi', verb, 'Set MUAPI_AI_KEY (and optionally MUAPI_BASE_URL).')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('muapi', verb, VERBS)

  const p = (payload ?? {}) as GenerateImagePayload
  if (typeof p.prompt !== 'string' || !p.prompt.trim()) {
    return { ok: false, adapter: 'muapi', verb, error: 'upstream_error', message: 'generate_image requires non-empty `prompt`' }
  }

  try {
    const t0 = Date.now()
    const res = await fetch(`${envBase()}/v1/images/generations`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${envKey()}` },
      body:    JSON.stringify({
        prompt:       p.prompt,
        aspect_ratio: p.aspect_ratio ?? '1:1',
        model:        p.model ?? 'muapi-default',
        n:            p.n ?? 1,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    const latency = Date.now() - t0
    if (!res.ok) {
      return {
        ok: false, adapter: 'muapi', verb,
        error: res.status === 429 ? 'rate_limited' : 'upstream_error',
        message: `muapi ${verb} → ${res.status}`,
        telemetry: { http_status: res.status, latency_ms: latency },
      }
    }
    return { ok: true, adapter: 'muapi', verb, result: await res.json(), telemetry: { latency_ms: latency } }
  } catch (e) {
    return { ok: false, adapter: 'muapi', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'muapi call failed' }
  }
}

/**
 * lib/ecosystems/adapters/flux.ts — `image` adapter for FLUX (via Replicate).
 *
 * Photo-realistic product shots — the `ecommerce` niche's intended image
 * provider (currently repointed to muapi because no flux adapter existed).
 * Same verb (`generate_image`) as muapi.ts so it's a drop-in rebind in /teams.
 *
 * FLUX is served through Replicate's prediction API (black-forest-labs/
 * flux-1.1-pro). Best-effort router (muapi.ts pattern): env-gated, returns the
 * Replicate prediction object (which carries the polling URL + output once
 * complete). Replicate predictions are async — callers poll `result.urls.get`.
 *
 * ⚠️ Upstream-contract note: the Replicate endpoint + Bearer auth are from
 * Replicate's published docs; verify against a live token before prod.
 *
 * Env:
 *   REPLICATE_API_TOKEN — Bearer auth (preferred)
 *   FLUX_API_KEY        — accepted as an alias if REPLICATE_API_TOKEN unset
 *   FLUX_MODEL          — optional model slug override (default flux-1.1-pro)
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['generate_image'] as const
type Verb = (typeof VERBS)[number]

const API_BASE = 'https://api.replicate.com'
const DEFAULT_MODEL = 'black-forest-labs/flux-1.1-pro'

interface GenerateImagePayload {
  prompt:        string
  aspect_ratio?: '9:16' | '16:9' | '1:1' | '4:3' | '3:4'
  model?:        string
  /** Forwarded straight into Replicate `input` for model-specific knobs. */
  input?:        Record<string, unknown>
}

function envKey():   string | undefined { return process.env.REPLICATE_API_TOKEN || process.env.FLUX_API_KEY }
function envModel(): string { return process.env.FLUX_MODEL || DEFAULT_MODEL }

export const fluxAdapter: EcosystemAdapter = {
  kind:         'image',
  name:         'flux',
  label:        'FLUX (Replicate · photo-real)',
  capabilities: VERBS,
  available:    () => Boolean(envKey()),
  invoke:       invokeFlux,
}

async function invokeFlux(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!fluxAdapter.available()) {
    return unavailable('flux', verb, 'Set REPLICATE_API_TOKEN (or FLUX_API_KEY) to enable FLUX image generation.')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('flux', verb, VERBS)

  const p = (payload ?? {}) as GenerateImagePayload
  if (typeof p.prompt !== 'string' || !p.prompt.trim()) {
    return { ok: false, adapter: 'flux', verb, error: 'upstream_error', message: 'generate_image requires non-empty `prompt`' }
  }

  try {
    const t0 = Date.now()
    // Replicate's run-a-model endpoint creates a prediction; `Prefer: wait`
    // blocks (up to ~60s) for a synchronous result when the model is fast.
    const res = await fetch(`${API_BASE}/v1/models/${envModel()}/predictions`, {
      method:  'POST',
      headers: {
        'content-type': 'application/json',
        authorization:  `Bearer ${envKey()}`,
        prefer:         'wait',
      },
      body: JSON.stringify({
        input: {
          prompt:       p.prompt,
          aspect_ratio: p.aspect_ratio ?? '1:1',
          ...(p.input ?? {}),
        },
      }),
      signal: AbortSignal.timeout(60_000),
    })
    const latency = Date.now() - t0
    if (!res.ok) {
      return {
        ok: false, adapter: 'flux', verb,
        error: res.status === 429 ? 'rate_limited' : 'upstream_error',
        message: `flux ${verb} → ${res.status}`,
        telemetry: { http_status: res.status, latency_ms: latency },
      }
    }
    return { ok: true, adapter: 'flux', verb, result: await res.json(), telemetry: { latency_ms: latency } }
  } catch (e) {
    return { ok: false, adapter: 'flux', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'flux call failed' }
  }
}

/**
 * lib/ecosystems/adapters/open-design.ts — `design` adapter for open-design.ai (real).
 *
 * v4: HTTP client. Same shape as higgsfield / gbrain — verb router with
 * 60s timeout for renders, 15s for listings.
 *
 * No PUBLIC fallback — open-design.ai's public endpoint shape isn't pinned
 * enough yet to risk hitting it blindly. Operator MUST set
 * OPEN_DESIGN_BASE_URL (self-hosted) OR an internal proxy URL with
 * OPEN_DESIGN_API_KEY before this adapter reports available().
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['render_comp', 'export_tokens', 'list_templates'] as const
type Verb = (typeof VERBS)[number]

interface RenderCompPayload {
  wireframe:   Record<string, unknown>
  tokens?:     Record<string, unknown>
  breakpoint?: 'mobile' | 'tablet' | 'desktop'
  brand_voice?: string
}

interface ExportTokensPayload {
  brand_slug:  string
  format?:     'json' | 'css' | 'tailwind'
}

function envBase(): string | undefined {
  return process.env.OPEN_DESIGN_BASE_URL || process.env.OPEN_DESIGN_API_URL
}

function envKey(): string | undefined {
  return process.env.OPEN_DESIGN_API_KEY
}

function authHeader(): Record<string, string> {
  const k = envKey()
  return k ? { authorization: `Bearer ${k}` } : {}
}

export const openDesignAdapter: EcosystemAdapter = {
  kind:         'design',
  name:         'open-design',
  label:        'open-design.ai',
  capabilities: VERBS,
  available:    () => Boolean(envBase()),
  invoke:       invokeOpenDesign,
}

async function invokeOpenDesign(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!openDesignAdapter.available()) {
    return unavailable('open-design', verb, 'Set OPEN_DESIGN_BASE_URL (and optionally OPEN_DESIGN_API_KEY).')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('open-design', verb, VERBS)
  const base = envBase()!

  try {
    if (verb === 'list_templates') {
      const t0 = Date.now()
      const res = await fetch(`${base}/v1/templates`, {
        headers: authHeader(),
        signal:  AbortSignal.timeout(15_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) return errorResult(verb, res.status, latency)
      const data = await res.json()
      return { ok: true, adapter: 'open-design', verb, result: data, telemetry: { latency_ms: latency } }
    }

    if (verb === 'render_comp') {
      const p = (payload ?? {}) as RenderCompPayload
      if (!p.wireframe || typeof p.wireframe !== 'object') {
        return { ok: false, adapter: 'open-design', verb, error: 'upstream_error', message: 'render_comp requires `wireframe` object' }
      }
      const t0 = Date.now()
      const res = await fetch(`${base}/v1/render`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...authHeader() },
        body:    JSON.stringify({
          wireframe:   p.wireframe,
          tokens:      p.tokens ?? {},
          breakpoint:  p.breakpoint ?? 'mobile',
          brand_voice: p.brand_voice ?? '',
        }),
        signal:  AbortSignal.timeout(60_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) return errorResult(verb, res.status, latency)
      const data = await res.json()
      return { ok: true, adapter: 'open-design', verb, result: data, telemetry: { latency_ms: latency } }
    }

    if (verb === 'export_tokens') {
      const p = (payload ?? {}) as ExportTokensPayload
      if (typeof p.brand_slug !== 'string') {
        return { ok: false, adapter: 'open-design', verb, error: 'upstream_error', message: 'export_tokens requires `brand_slug`' }
      }
      const t0 = Date.now()
      const res = await fetch(`${base}/v1/tokens?brand=${encodeURIComponent(p.brand_slug)}&format=${p.format ?? 'json'}`, {
        headers: authHeader(),
        signal:  AbortSignal.timeout(15_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) return errorResult(verb, res.status, latency)
      const data = await res.json()
      return { ok: true, adapter: 'open-design', verb, result: data, telemetry: { latency_ms: latency } }
    }
  } catch (e) {
    return {
      ok:      false,
      adapter: 'open-design',
      verb,
      error:   'upstream_error',
      message: e instanceof Error ? e.message : 'open-design call failed',
    }
  }
  return capabilityMissing('open-design', verb, VERBS)
}

function errorResult(verb: string, status: number, latency: number): EcosystemResult {
  return {
    ok:        false,
    adapter:   'open-design',
    verb,
    error:     status === 429 ? 'rate_limited' : 'upstream_error',
    message:   `open-design ${verb} → ${status}`,
    telemetry: { http_status: status, latency_ms: latency },
  }
}

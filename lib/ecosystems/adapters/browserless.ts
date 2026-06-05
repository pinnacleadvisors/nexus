/**
 * lib/ecosystems/adapters/browserless.ts — `browser` adapter (headless browser).
 *
 * Best-effort HTTP router targeting a headless-browser shim (Browserless,
 * Playwright server, or the nexus-sandbox). Default `browser` binding is named
 * `playwright` in lib/teams/default-bindings.ts; this adapter registers under
 * that name so the binding resolves. Env-gated — unavailable until a shim URL
 * is set, so the platform stays bootable.
 *
 * Env:
 *   BROWSER_BASE_URL — headless shim base (required to be "available")
 *   BROWSER_API_KEY  — optional bearer auth
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['screenshot', 'extract'] as const
type Verb = (typeof VERBS)[number]

interface ScreenshotPayload {
  url:        string
  full_page?: boolean
}

interface ExtractPayload {
  url:      string
  selector?: string
}

function envBase(): string | undefined { return process.env.BROWSER_BASE_URL }
function authHeader(): Record<string, string> {
  const k = process.env.BROWSER_API_KEY
  return k ? { authorization: `Bearer ${k}` } : {}
}

export const browserlessAdapter: EcosystemAdapter = {
  // Registered under name 'playwright' to satisfy the default `browser` binding.
  kind:         'browser',
  name:         'playwright',
  label:        'Headless browser (Playwright/Browserless shim)',
  capabilities: VERBS,
  available:    () => Boolean(envBase()),
  invoke:       invokeBrowser,
}

async function invokeBrowser(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!browserlessAdapter.available()) {
    return unavailable('playwright', verb, 'Set BROWSER_BASE_URL to enable headless-browser actions.')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('playwright', verb, VERBS)
  const base = envBase()!

  const p = (payload ?? {}) as ScreenshotPayload & ExtractPayload
  if (typeof p.url !== 'string' || !p.url.trim()) {
    return { ok: false, adapter: 'playwright', verb, error: 'upstream_error', message: `${verb} requires \`url\`` }
  }

  try {
    const t0 = Date.now()
    const res = await fetch(`${base}/${verb}`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body:    JSON.stringify(p),
      signal:  AbortSignal.timeout(30_000),
    })
    const latency = Date.now() - t0
    if (!res.ok) {
      return {
        ok: false, adapter: 'playwright', verb,
        error: res.status === 429 ? 'rate_limited' : 'upstream_error',
        message: `playwright ${verb} → ${res.status}`,
        telemetry: { http_status: res.status, latency_ms: latency },
      }
    }
    return { ok: true, adapter: 'playwright', verb, result: await res.json(), telemetry: { latency_ms: latency } }
  } catch (e) {
    return { ok: false, adapter: 'playwright', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'browser call failed' }
  }
}

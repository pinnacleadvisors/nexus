/**
 * lib/ecosystems/adapters/aider.ts — `code` adapter for Aider (real).
 *
 * v5: HTTP client. Aider itself is a Python CLI tool; this adapter expects
 * a thin HTTP shim around it (the operator deploys e.g. services/aider/
 * which spawns aider with the right repo + relays a JSON contract).
 *
 * Shim contract (the operator's deployment defines this):
 *   POST {base}/v1/{verb}
 *   body: { ...payload }
 *   returns: { ok: boolean, result: any, telemetry?: any }
 *
 * Auth: AIDER_API_KEY → "authorization: Bearer <key>" when set.
 *
 * Replaces the v3 stub. When AIDER_BASE_URL is unset, available() returns
 * false and the routing layer can fall back to claude-code or open-code.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['generate_module', 'edit_file', 'review_diff', 'run_command'] as const
type Verb = (typeof VERBS)[number]

interface GenericPayload {
  prompt?:  string
  file?:    string
  patch?:   string
  command?: string
  cwd?:     string
  [k: string]: unknown
}

function envBase(): string | undefined { return process.env.AIDER_BASE_URL }
function envKey():  string | undefined { return process.env.AIDER_API_KEY }

function authHeader(): Record<string, string> {
  const k = envKey()
  return k ? { authorization: `Bearer ${k}` } : {}
}

export const aiderAdapter: EcosystemAdapter = {
  kind:         'code',
  name:         'aider',
  label:        'Aider (open source)',
  capabilities: VERBS,
  available:    () => Boolean(envBase()),
  invoke:       invokeAider,
}

async function invokeAider(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!aiderAdapter.available()) {
    return unavailable('aider', verb, 'Set AIDER_BASE_URL (self-hosted aider HTTP shim).')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('aider', verb, VERBS)
  const base = envBase()!

  try {
    const t0 = Date.now()
    const res = await fetch(`${base}/v1/${verb}`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body:    JSON.stringify(payload ?? {} as GenericPayload),
      // Aider runs are model-mediated and can be slow. 90s ceiling.
      signal:  AbortSignal.timeout(verb === 'run_command' ? 90_000 : 60_000),
    })
    const latency = Date.now() - t0
    if (!res.ok) {
      return {
        ok:        false,
        adapter:   'aider',
        verb,
        error:     res.status === 429 ? 'rate_limited' : 'upstream_error',
        message:   `aider ${verb} → ${res.status}`,
        telemetry: { http_status: res.status, latency_ms: latency },
      }
    }
    const data = await res.json()
    return {
      ok:        true,
      adapter:   'aider',
      verb,
      result:    data,
      telemetry: { latency_ms: latency },
    }
  } catch (e) {
    return {
      ok:      false,
      adapter: 'aider',
      verb,
      error:   'upstream_error',
      message: e instanceof Error ? e.message : 'aider call failed',
    }
  }
}

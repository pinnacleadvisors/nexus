/**
 * lib/ecosystems/adapters/open-code.ts — `code` adapter for Open Code (real).
 *
 * v4: HTTP client with claude-gateway fallback. When OPEN_CODE_BASE_URL is
 * set, calls Open Code's HTTP API. When unset BUT the claude-gateway is
 * configured, routes through there so the dev-team plan can ship before
 * Open Code GA.
 *
 * Both paths share the same verb shape — caller doesn't know which backend
 * served the call (telemetry.via reports it).
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = [
  'generate_module',
  'edit_file',
  'review_diff',
  'run_command',
  'health_check',
] as const
type Verb = (typeof VERBS)[number]

interface GenericPayload {
  prompt?:   string
  file?:     string
  patch?:    string
  command?:  string
  cwd?:      string
  // Free-form pass-through; the upstream picks what it needs.
  [k: string]: unknown
}

function envBase():    string | undefined { return process.env.OPEN_CODE_BASE_URL }
function envKey():     string | undefined { return process.env.OPEN_CODE_API_KEY }
function gatewayBase():string | undefined { return process.env.CLAUDE_CODE_GATEWAY_URL }
function gatewayKey(): string | undefined { return process.env.CLAUDE_CODE_BEARER_TOKEN }

function authHeader(useGateway: boolean): Record<string, string> {
  if (useGateway) {
    const k = gatewayKey()
    return k ? { authorization: `Bearer ${k}` } : {}
  }
  const k = envKey()
  return k ? { authorization: `Bearer ${k}` } : {}
}

export const openCodeAdapter: EcosystemAdapter = {
  kind:         'code',
  name:         'open-code',
  label:        'Open Code',
  capabilities: VERBS,
  available:    () => Boolean(envBase() || (gatewayBase() && gatewayKey())),
  invoke:       invokeOpenCode,
}

async function invokeOpenCode(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!openCodeAdapter.available()) {
    return unavailable('open-code', verb,
      'Set OPEN_CODE_BASE_URL (and OPEN_CODE_API_KEY) OR wire CLAUDE_CODE_GATEWAY_URL + CLAUDE_CODE_BEARER_TOKEN as fallback.')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('open-code', verb, VERBS)

  // Prefer Open Code's native endpoint when configured; fall back to the
  // existing claude-gateway when not.
  const useGateway = !envBase()
  const base = useGateway ? gatewayBase()! : envBase()!
  // Open Code's path scheme: /v1/<verb>. Gateway's path scheme: /dispatch.
  const path = useGateway ? '/dispatch' : `/v1/${verb}`

  try {
    const t0 = Date.now()
    const res = await fetch(`${base}${path}`, {
      method:  verb === 'health_check' ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(useGateway) },
      body:    verb === 'health_check' ? undefined : JSON.stringify(useGateway ? { verb, payload: payload ?? {} } : (payload ?? {})),
      signal:  AbortSignal.timeout(verb === 'run_command' ? 60_000 : 30_000),
    })
    const latency = Date.now() - t0
    if (!res.ok) {
      return {
        ok:        false,
        adapter:   'open-code',
        verb,
        error:     res.status === 429 ? 'rate_limited' : 'upstream_error',
        message:   `open-code ${verb} → ${res.status}`,
        telemetry: { http_status: res.status, latency_ms: latency, via: useGateway ? 'claude-gateway' : 'open-code' },
      }
    }
    const data = verb === 'health_check' ? { status: res.status } : await res.json()
    return {
      ok:        true,
      adapter:   'open-code',
      verb,
      result:    data,
      telemetry: { latency_ms: latency, via: useGateway ? 'claude-gateway' : 'open-code' },
    }
  } catch (e) {
    return {
      ok:      false,
      adapter: 'open-code',
      verb,
      error:   'upstream_error',
      message: e instanceof Error ? e.message : 'open-code call failed',
    }
  }
}

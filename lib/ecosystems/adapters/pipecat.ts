/**
 * lib/ecosystems/adapters/pipecat.ts — `voice-agent` adapter for Pipecat (real).
 *
 * v5: HTTP client. Pipecat is a Python framework for real-time voice
 * agents; this adapter expects an HTTP shim around a deployed Pipecat
 * instance that exposes:
 *
 *   POST {base}/v1/calls           — body {dial_to, prompt, voice_id?}  → {call_id, status}
 *   GET  {base}/v1/calls           — query ?limit=N&status=...           → {calls: [...]}
 *   GET  {base}/v1/calls/{id}/transcript                                 → {transcript, duration_s}
 *
 * Auth: PIPECAT_API_KEY → bearer when set.
 *
 * Sales-CS dept's `support` + `account-manager` roles route through here
 * for outbound phone work without a paid Vapi / Retell / Bland tier.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['start_call', 'list_calls', 'get_transcript'] as const
type Verb = (typeof VERBS)[number]

interface StartCallPayload {
  dial_to:    string
  prompt:     string
  voice_id?:  string
}

interface GetTranscriptPayload {
  call_id:    string
}

function envBase(): string | undefined { return process.env.PIPECAT_BASE_URL }
function envKey():  string | undefined { return process.env.PIPECAT_API_KEY }

function authHeader(): Record<string, string> {
  const k = envKey()
  return k ? { authorization: `Bearer ${k}` } : {}
}

export const pipecatAdapter: EcosystemAdapter = {
  kind:         'voice-agent',
  name:         'pipecat',
  label:        'Pipecat (open source)',
  capabilities: VERBS,
  available:    () => Boolean(envBase()),
  invoke:       invokePipecat,
}

async function invokePipecat(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!pipecatAdapter.available()) {
    return unavailable('pipecat', verb, 'Set PIPECAT_BASE_URL (and optionally PIPECAT_API_KEY).')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('pipecat', verb, VERBS)
  const base = envBase()!

  try {
    if (verb === 'list_calls') {
      const t0 = Date.now()
      const res = await fetch(`${base}/v1/calls`, {
        headers: authHeader(),
        signal:  AbortSignal.timeout(10_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) return errorResult(verb, res.status, latency)
      return { ok: true, adapter: 'pipecat', verb, result: await res.json(), telemetry: { latency_ms: latency } }
    }

    if (verb === 'start_call') {
      const p = (payload ?? {}) as StartCallPayload
      if (!p.dial_to || !p.prompt) {
        return { ok: false, adapter: 'pipecat', verb, error: 'upstream_error', message: 'start_call requires `dial_to` and `prompt`' }
      }
      const t0 = Date.now()
      const res = await fetch(`${base}/v1/calls`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...authHeader() },
        body:    JSON.stringify(p),
        signal:  AbortSignal.timeout(15_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) return errorResult(verb, res.status, latency)
      return { ok: true, adapter: 'pipecat', verb, result: await res.json(), telemetry: { latency_ms: latency } }
    }

    if (verb === 'get_transcript') {
      const p = (payload ?? {}) as GetTranscriptPayload
      if (!p.call_id) {
        return { ok: false, adapter: 'pipecat', verb, error: 'upstream_error', message: 'get_transcript requires `call_id`' }
      }
      const t0 = Date.now()
      const res = await fetch(`${base}/v1/calls/${encodeURIComponent(p.call_id)}/transcript`, {
        headers: authHeader(),
        signal:  AbortSignal.timeout(15_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) return errorResult(verb, res.status, latency)
      return { ok: true, adapter: 'pipecat', verb, result: await res.json(), telemetry: { latency_ms: latency } }
    }
  } catch (e) {
    return {
      ok:      false,
      adapter: 'pipecat',
      verb,
      error:   'upstream_error',
      message: e instanceof Error ? e.message : 'pipecat call failed',
    }
  }
  return capabilityMissing('pipecat', verb, VERBS)
}

function errorResult(verb: string, status: number, latency: number): EcosystemResult {
  return {
    ok:        false,
    adapter:   'pipecat',
    verb,
    error:     status === 429 ? 'rate_limited' : 'upstream_error',
    message:   `pipecat ${verb} → ${status}`,
    telemetry: { http_status: status, latency_ms: latency },
  }
}

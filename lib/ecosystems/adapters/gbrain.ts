/**
 * lib/ecosystems/adapters/gbrain.ts — `memory` adapter for Garry Tan's GBrain.
 *
 * v1 (this PR): real HTTP client. Calls GBrain's /query and /health endpoints
 * when GBRAIN_BASE_URL is set, no-ops otherwise. The contract is intentionally
 * permissive — GBrain's response shape is still being characterised per
 * task_plan-gbrain-integration.md Phase 1 (recon). We wrap whatever it returns.
 *
 * Integration decision (turn this on for production traffic) gates on the
 * benchmark numbers in docs/adr/009-gbrain-evaluation.md. The adapter is
 * always SAFE to ship — until the operator rebinds a team's `memory` kind
 * to `gbrain`, no calls land here.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['gbrain_query', 'gbrain_suggest_links', 'gbrain_health'] as const
type Verb = (typeof VERBS)[number]

interface GbrainQueryPayload {
  question: string
  k?:       number
}

function envBase(): string | undefined { return process.env.GBRAIN_BASE_URL }
function envKey():  string | undefined { return process.env.GBRAIN_API_KEY  }

function authHeader(): Record<string, string> {
  const k = envKey()
  return k ? { authorization: `Bearer ${k}` } : {}
}

export const gbrainAdapter: EcosystemAdapter = {
  kind:         'memory',
  name:         'gbrain',
  label:        'GBrain (self-wiring memory)',
  capabilities: VERBS,
  available:    () => Boolean(envBase()),
  invoke:       invokeGbrain,
}

async function invokeGbrain(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!gbrainAdapter.available()) return unavailable('gbrain', verb,
    'Set GBRAIN_BASE_URL (and optionally GBRAIN_API_KEY).')
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('gbrain', verb, VERBS)
  const base = envBase()!

  try {
    if (verb === 'gbrain_health') {
      const res = await fetch(`${base}/health`, {
        headers: authHeader(),
        signal:  AbortSignal.timeout(5000),
      })
      const text = await res.text().catch(() => '')
      return {
        ok:        res.ok,
        adapter:   'gbrain',
        verb,
        result:    { status: res.status, body: text.slice(0, 500) },
        telemetry: { http_status: res.status },
      }
    }

    if (verb === 'gbrain_query') {
      const p = (payload ?? {}) as GbrainQueryPayload
      if (typeof p.question !== 'string' || !p.question.trim()) {
        return { ok: false, adapter: 'gbrain', verb, error: 'upstream_error', message: 'gbrain_query requires `question`' }
      }
      const t0 = Date.now()
      const res = await fetch(`${base}/query`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...authHeader() },
        body:    JSON.stringify({ question: p.question, k: p.k ?? 10 }),
        signal:  AbortSignal.timeout(15_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) {
        return {
          ok:      false,
          adapter: 'gbrain',
          verb,
          error:   res.status === 429 ? 'rate_limited' : 'upstream_error',
          message: `gbrain /query → ${res.status}`,
          telemetry: { http_status: res.status, latency_ms: latency },
        }
      }
      const data = await res.json()
      return {
        ok:        true,
        adapter:   'gbrain',
        verb,
        result:    data,
        telemetry: { latency_ms: latency },
      }
    }

    if (verb === 'gbrain_suggest_links') {
      // Per the integration plan, GBrain's edge suggestions don't
      // auto-write to memory-hq — they file a manual-task for operator
      // review. v1 just calls the endpoint; the routing layer above
      // decides what to do with the response.
      const t0 = Date.now()
      const res = await fetch(`${base}/suggest-links`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...authHeader() },
        body:    JSON.stringify(payload ?? {}),
        signal:  AbortSignal.timeout(15_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) {
        return {
          ok:      false,
          adapter: 'gbrain',
          verb,
          error:   'upstream_error',
          message: `gbrain /suggest-links → ${res.status}`,
          telemetry: { http_status: res.status, latency_ms: latency },
        }
      }
      const data = await res.json()
      return { ok: true, adapter: 'gbrain', verb, result: data, telemetry: { latency_ms: latency } }
    }
  } catch (e) {
    return {
      ok:      false,
      adapter: 'gbrain',
      verb,
      error:   'upstream_error',
      message: e instanceof Error ? e.message : 'gbrain call failed',
    }
  }

  // Unreachable — type-narrow above covers all VERBS.
  return capabilityMissing('gbrain', verb, VERBS)
}

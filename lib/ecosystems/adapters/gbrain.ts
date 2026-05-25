/**
 * lib/ecosystems/adapters/gbrain.ts — `memory` adapter for Garry Tan's GBrain.
 *
 * v1 is a pure stub — `available()` returns true only when GBRAIN_BASE_URL
 * is set. Until then, `getEcosystem('memory', 'gbrain')` returns this
 * adapter and the operator sees a typed `unavailable` envelope. The point
 * of shipping the stub now is so the rebind UI ("switch memory to gbrain")
 * is functional from day one — wiring a real GBrain backend later is a
 * single-file change, not a cross-cutting refactor.
 *
 * See task_plan-gbrain-integration.md for the eval criteria + decision
 * gates BEFORE we point any production traffic at GBrain.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = [
  'gbrain_query',
  'gbrain_suggest_links',
  'gbrain_health',
] as const
type Verb = (typeof VERBS)[number]

function envBase(): string | undefined {
  return process.env.GBRAIN_BASE_URL
}

function envKey(): string | undefined {
  return process.env.GBRAIN_API_KEY
}

export const gbrainAdapter: EcosystemAdapter = {
  kind:         'memory',
  name:         'gbrain',
  label:        'GBrain (self-wiring memory)',
  capabilities: VERBS,
  available:    () => Boolean(envBase()),
  invoke:       invokeGbrain,
}

async function invokeGbrain(verb: string, _payload?: unknown): Promise<EcosystemResult> {
  if (!gbrainAdapter.available()) return unavailable('gbrain', verb,
    'Set GBRAIN_BASE_URL (and optionally GBRAIN_API_KEY) to enable.')
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('gbrain', verb, VERBS)
  // v1 stub — once the recon phase of task_plan-gbrain-integration.md
  // confirms the GBrain API surface, this becomes a real HTTP client.
  return {
    ok:        true,
    adapter:   'gbrain',
    verb,
    result:    { stub: true, hint: 'GBrain configured but client not yet wired — see task_plan-gbrain-integration.md.' },
    telemetry: { stub: 1, env_configured: envKey() ? 1 : 0 },
  }
}

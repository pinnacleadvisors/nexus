/**
 * lib/ecosystems/adapters/pipecat.ts — `voice-agent` adapter for Pipecat (open source).
 *
 * Open-source alternative to Vapi / Retell / Bland. Self-hosted via a
 * pipecat Python service. Adapter ships as the default open-source
 * voice-agent so the sales-cs dept's lead can route phone work without
 * waiting on a paid vendor.
 *
 * v1 stub — verb router only.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['start_call', 'list_calls', 'get_transcript'] as const
type Verb = (typeof VERBS)[number]

function envBase(): string | undefined {
  return process.env.PIPECAT_BASE_URL
}

function envKey(): string | undefined {
  return process.env.PIPECAT_API_KEY
}

export const pipecatAdapter: EcosystemAdapter = {
  kind:         'voice-agent',
  name:         'pipecat',
  label:        'Pipecat (open source)',
  capabilities: VERBS,
  available:    () => Boolean(envBase()),
  invoke:       invokePipecat,
}

async function invokePipecat(verb: string, _payload?: unknown): Promise<EcosystemResult> {
  if (!pipecatAdapter.available()) return unavailable('pipecat', verb, 'Set PIPECAT_BASE_URL (and optionally PIPECAT_API_KEY).')
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('pipecat', verb, VERBS)
  return {
    ok:        true,
    adapter:   'pipecat',
    verb,
    result:    { stub: true, hint: 'Pipecat adapter v1 — stand up services/pipecat/ to enable.', env_configured: envKey() ? 1 : 0 },
    telemetry: { stub: 1 },
  }
}

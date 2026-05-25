/**
 * lib/ecosystems/adapters/open-code.ts — `code` adapter for Open Code.
 *
 * v1 = verb router. Wires through the existing claude-gateway when the
 * Open Code env vars aren't set, so the dev-team plan can ship without
 * waiting on Open Code GA.
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

function envBase(): string | undefined {
  return process.env.OPEN_CODE_BASE_URL
}

function envKey(): string | undefined {
  return process.env.OPEN_CODE_API_KEY
}

/** When Open Code isn't configured, we still report available=true if the
 *  fallback claude-gateway is present — the dev-lead can keep working. */
function fallbackAvailable(): boolean {
  return Boolean(process.env.CLAUDE_CODE_GATEWAY_URL && process.env.CLAUDE_CODE_BEARER_TOKEN)
}

export const openCodeAdapter: EcosystemAdapter = {
  kind:         'code',
  name:         'open-code',
  label:        'Open Code',
  capabilities: VERBS,
  available:    () => Boolean(envBase() || envKey() || fallbackAvailable()),
  invoke:       invokeOpenCode,
}

async function invokeOpenCode(verb: string, _payload?: unknown): Promise<EcosystemResult> {
  if (!openCodeAdapter.available()) return unavailable('open-code', verb,
    'Set OPEN_CODE_BASE_URL or OPEN_CODE_API_KEY, or wire CLAUDE_CODE_GATEWAY_URL as fallback.')
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('open-code', verb, VERBS)
  // v1 stub. The dev-team plan's atomic tasks land the real claude-gateway
  // and codex-gateway routing logic here.
  const usingFallback = !envBase() && !envKey()
  return {
    ok:        true,
    adapter:   'open-code',
    verb,
    result:    { stub: true, hint: 'open-code adapter v1 — verb router only.' },
    telemetry: { stub: 1, fallback: usingFallback ? 1 : 0 },
  }
}

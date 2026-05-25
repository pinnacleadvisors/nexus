/**
 * lib/ecosystems/adapters/aider.ts — `code` adapter for Aider (open source).
 *
 * Open-source alternative to claude-code / codex / open-code. Self-hosted
 * via the Aider CLI; we route through a thin HTTP shim the operator stands
 * up via `services/aider/` (not in this PR — adapter ships ready).
 *
 * v1 stub — verb router only.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['generate_module', 'edit_file', 'review_diff', 'run_command'] as const
type Verb = (typeof VERBS)[number]

function envBase(): string | undefined {
  return process.env.AIDER_BASE_URL
}

export const aiderAdapter: EcosystemAdapter = {
  kind:         'code',
  name:         'aider',
  label:        'Aider (open source)',
  capabilities: VERBS,
  available:    () => Boolean(envBase()),
  invoke:       invokeAider,
}

async function invokeAider(verb: string, _payload?: unknown): Promise<EcosystemResult> {
  if (!aiderAdapter.available()) return unavailable('aider', verb, 'Set AIDER_BASE_URL (self-hosted Aider HTTP shim).')
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('aider', verb, VERBS)
  return {
    ok:        true,
    adapter:   'aider',
    verb,
    result:    { stub: true, hint: 'Aider adapter v1 — verb router only; deploy services/aider/ to enable.' },
    telemetry: { stub: 1 },
  }
}

/**
 * lib/ecosystems/adapters/open-design.ts — `design` adapter for open-design.ai.
 *
 * v1 = verb router only. Wired alongside the design-team plan.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['render_comp', 'export_tokens', 'list_templates'] as const
type Verb = (typeof VERBS)[number]

function envBase(): string | undefined {
  return process.env.OPEN_DESIGN_BASE_URL || process.env.OPEN_DESIGN_API_URL
}

function envKey(): string | undefined {
  return process.env.OPEN_DESIGN_API_KEY
}

export const openDesignAdapter: EcosystemAdapter = {
  kind:         'design',
  name:         'open-design',
  label:        'open-design.ai',
  capabilities: VERBS,
  available:    () => Boolean(envBase() || envKey()),
  invoke:       invokeOpenDesign,
}

async function invokeOpenDesign(verb: string, _payload?: unknown): Promise<EcosystemResult> {
  if (!openDesignAdapter.available()) return unavailable('open-design', verb,
    'Set OPEN_DESIGN_API_KEY or OPEN_DESIGN_BASE_URL.')
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('open-design', verb, VERBS)
  return {
    ok:        true,
    adapter:   'open-design',
    verb,
    result:    { stub: true, hint: 'open-design adapter v1 — verb router only.' },
    telemetry: { stub: 1 },
  }
}

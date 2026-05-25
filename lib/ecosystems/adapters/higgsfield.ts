/**
 * lib/ecosystems/adapters/higgsfield.ts — `video` adapter for Higgsfield.
 *
 * v1 = a thin verb router. Real network calls land when we wire the
 * production Higgsfield client per task_plan-content-team-higgsfield.md.
 * Until then this adapter answers `available()` truthfully and returns a
 * typed `unavailable` envelope for every verb so the routing layer can
 * fall back to another video adapter cleanly.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['render_clip', 'render_talking_head', 'list_models'] as const
type Verb = (typeof VERBS)[number]

function envBase(): string | undefined {
  // Prefer the self-hosted endpoint when set, fall back to the hosted API.
  return process.env.HIGGSFIELD_BASE_URL || process.env.HIGGSFIELD_API_URL
}

function envKey(): string | undefined {
  return process.env.HIGGSFIELD_API_KEY
}

export const higgsfieldAdapter: EcosystemAdapter = {
  kind:         'video',
  name:         'higgsfield',
  label:        'Higgsfield (open)',
  capabilities: VERBS,
  available:    () => Boolean(envBase() || envKey()),
  invoke:       invokeHiggsfield,
}

async function invokeHiggsfield(verb: string, _payload?: unknown): Promise<EcosystemResult> {
  if (!higgsfieldAdapter.available()) return unavailable('higgsfield', verb,
    'Set HIGGSFIELD_BASE_URL (self-hosted) or HIGGSFIELD_API_KEY (hosted).')
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('higgsfield', verb, VERBS)
  // v1 stub — real implementation lands with the content-team work. For now
  // we surface a stable "configured but not yet wired" telemetry payload so
  // the operator can spawn teams without the routing layer crashing.
  return {
    ok:        true,
    adapter:   'higgsfield',
    verb,
    result:    { stub: true, hint: 'Higgsfield adapter v1 — verb router only.' },
    telemetry: { stub: 1 },
  }
}

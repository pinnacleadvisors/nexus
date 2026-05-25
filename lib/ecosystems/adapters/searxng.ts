/**
 * lib/ecosystems/adapters/searxng.ts — `search` adapter for SearXNG (open source).
 *
 * Open-source alternative to Tavily / Perplexity / Exa. Self-hosted via
 * the searxng Docker image; uses its JSON API. Adapter ships as the
 * fall-back search ecosystem so a research dept can run without burning
 * Tavily credits when self-hosted is preferred.
 *
 * v1 stub — verb router only.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['web_search'] as const
type Verb = (typeof VERBS)[number]

function envBase(): string | undefined {
  return process.env.SEARXNG_BASE_URL
}

export const searxngAdapter: EcosystemAdapter = {
  kind:         'search',
  name:         'searxng',
  label:        'SearXNG (open source)',
  capabilities: VERBS,
  available:    () => Boolean(envBase()),
  invoke:       invokeSearxng,
}

async function invokeSearxng(verb: string, _payload?: unknown): Promise<EcosystemResult> {
  if (!searxngAdapter.available()) return unavailable('searxng', verb, 'Set SEARXNG_BASE_URL (self-hosted SearXNG instance).')
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('searxng', verb, VERBS)
  return {
    ok:        true,
    adapter:   'searxng',
    verb,
    result:    { stub: true, hint: 'SearXNG adapter v1 — verb router only.' },
    telemetry: { stub: 1 },
  }
}

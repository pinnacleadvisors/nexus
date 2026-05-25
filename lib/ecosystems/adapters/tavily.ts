/**
 * lib/ecosystems/adapters/tavily.ts — `search` adapter (real).
 *
 * Wraps lib/tools/tavily.ts. Single verb in v1: `web_search`.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'
import { searchWeb, type SearchOptions } from '@/lib/tools/tavily'

const VERBS = ['web_search'] as const
type Verb = (typeof VERBS)[number]

interface WebSearchPayload {
  query:   string
  options?: SearchOptions
}

export const tavilyAdapter: EcosystemAdapter = {
  kind:         'search',
  name:         'tavily',
  label:        'Tavily web search',
  capabilities: VERBS,
  available:    () => Boolean(process.env.TAVILY_API_KEY),
  invoke:       invokeTavily,
}

async function invokeTavily(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!tavilyAdapter.available()) return unavailable('tavily', verb, 'Set TAVILY_API_KEY in Doppler.')
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('tavily', verb, VERBS)
  const p = (payload ?? {}) as WebSearchPayload
  if (typeof p.query !== 'string' || p.query.trim().length === 0) {
    return { ok: false, adapter: 'tavily', verb, error: 'upstream_error', message: 'web_search requires non-empty `query`' }
  }
  try {
    const results = await searchWeb(p.query, p.options)
    return {
      ok:      true,
      adapter: 'tavily',
      verb,
      result:  { results },
      telemetry: { result_count: results.length },
    }
  } catch (e) {
    return { ok: false, adapter: 'tavily', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'tavily call failed' }
  }
}

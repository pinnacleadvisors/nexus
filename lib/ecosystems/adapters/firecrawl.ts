/**
 * lib/ecosystems/adapters/firecrawl.ts — `doc-parse` adapter (real).
 *
 * Wraps lib/tools/firecrawl.ts scrapeUrl(). v1 exposes one verb —
 * `scrape_url`. Map + crawl land alongside the content-team's trend-scout
 * role once we exercise the contract end-to-end.
 *
 * Doubles as a candidate `browser` adapter, but we register it under
 * doc-parse for now to avoid overlap with a future Playwright adapter.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'
import { scrapeUrl } from '@/lib/tools/firecrawl'

const VERBS = ['scrape_url'] as const
type Verb = (typeof VERBS)[number]

interface ScrapePayload {
  url:       string
  /** Forwarded straight to scrapeUrl(). Kept loose because the upstream
   *  helper's options shape is iterating fast and we don't want this file
   *  to be a typing bottleneck. */
  options?:  Record<string, unknown>
}

export const firecrawlAdapter: EcosystemAdapter = {
  kind:         'doc-parse',
  name:         'firecrawl',
  label:        'Firecrawl scrape',
  capabilities: VERBS,
  available:    () => Boolean(process.env.FIRECRAWL_API_KEY || process.env.FIRECRAWL_API_URL),
  invoke:       invokeFirecrawl,
}

async function invokeFirecrawl(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!firecrawlAdapter.available()) return unavailable('firecrawl', verb, 'Set FIRECRAWL_API_KEY (hosted) or FIRECRAWL_API_URL (self-hosted) in Doppler.')
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('firecrawl', verb, VERBS)
  const p = (payload ?? {}) as ScrapePayload
  if (typeof p.url !== 'string' || !/^https?:\/\//.test(p.url)) {
    return { ok: false, adapter: 'firecrawl', verb, error: 'upstream_error', message: 'scrape_url requires `url` starting with http(s)://' }
  }
  try {
    const res = await scrapeUrl(p.url)
    return {
      ok:        true,
      adapter:   'firecrawl',
      verb,
      result:    res,
      telemetry: { content_length: typeof res?.markdown === 'string' ? res.markdown.length : 0 },
    }
  } catch (e) {
    return { ok: false, adapter: 'firecrawl', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'firecrawl call failed' }
  }
}

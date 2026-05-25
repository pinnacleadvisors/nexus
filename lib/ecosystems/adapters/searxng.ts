/**
 * lib/ecosystems/adapters/searxng.ts — `search` adapter for SearXNG (real).
 *
 * v5: HTTP client. SearXNG exposes a documented JSON search API:
 *
 *   GET {base}/search?q={query}&format=json&categories={cat}
 *
 * Returns { results: [{ title, url, content, score, engine, ... }] }
 *
 * Adapter normalises the result shape to roughly match the existing
 * tavily adapter's output so research-dept code can consume either
 * adapter without per-backend conditionals.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['web_search'] as const
type Verb = (typeof VERBS)[number]

interface WebSearchPayload {
  query:      string
  /** SearXNG-specific. Common values: general, news, science, social_media. */
  categories?: string
  /** Cap returned results. Default 10. */
  limit?:     number
}

interface NormalisedResult {
  title:   string
  url:     string
  content: string
  score:   number
}

function envBase(): string | undefined { return process.env.SEARXNG_BASE_URL }

export const searxngAdapter: EcosystemAdapter = {
  kind:         'search',
  name:         'searxng',
  label:        'SearXNG (open source)',
  capabilities: VERBS,
  available:    () => Boolean(envBase()),
  invoke:       invokeSearxng,
}

async function invokeSearxng(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!searxngAdapter.available()) {
    return unavailable('searxng', verb, 'Set SEARXNG_BASE_URL (self-hosted SearXNG instance).')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('searxng', verb, VERBS)
  const base = envBase()!.replace(/\/+$/, '')

  const p = (payload ?? {}) as WebSearchPayload
  if (typeof p.query !== 'string' || !p.query.trim()) {
    return { ok: false, adapter: 'searxng', verb, error: 'upstream_error', message: 'web_search requires non-empty `query`' }
  }

  const params = new URLSearchParams({
    q:      p.query,
    format: 'json',
  })
  if (p.categories) params.set('categories', p.categories)

  try {
    const t0 = Date.now()
    const res = await fetch(`${base}/search?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    })
    const latency = Date.now() - t0
    if (!res.ok) {
      return {
        ok:        false,
        adapter:   'searxng',
        verb,
        error:     res.status === 429 ? 'rate_limited' : 'upstream_error',
        message:   `searxng search → ${res.status}`,
        telemetry: { http_status: res.status, latency_ms: latency },
      }
    }
    const data = await res.json() as { results?: Array<{ title?: string; url?: string; content?: string; score?: number }> }
    const limit = Math.max(1, Math.min(50, p.limit ?? 10))
    const normalised: NormalisedResult[] = (data.results ?? []).slice(0, limit).map(r => ({
      title:   String(r.title   ?? ''),
      url:     String(r.url     ?? ''),
      content: String(r.content ?? ''),
      score:   typeof r.score === 'number' ? r.score : 0,
    }))
    return {
      ok:        true,
      adapter:   'searxng',
      verb,
      result:    { results: normalised },
      telemetry: { latency_ms: latency, result_count: normalised.length },
    }
  } catch (e) {
    return {
      ok:      false,
      adapter: 'searxng',
      verb,
      error:   'upstream_error',
      message: e instanceof Error ? e.message : 'searxng call failed',
    }
  }
}

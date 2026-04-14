/**
 * lib/tools/tavily.ts
 * Tavily live web search wrapper for Phase 17c.
 *
 * Usage:
 *   import { searchWeb, formatResultsAsContext } from '@/lib/tools/tavily'
 *   const results = await searchWeb('SaaS pricing models 2025')
 *   const context = formatResultsAsContext(results)
 *
 * Requires: TAVILY_API_KEY in Doppler (free: 1k searches/mo, pro: $50/mo for 10k)
 * Register at: https://tavily.com → API Keys
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export interface TavilyResult {
  title:   string
  url:     string
  content: string   // Tavily-extracted page text (~500–2000 chars)
  score:   number   // 0–1 relevance
  publishedDate?: string
}

export interface TavilySearchResponse {
  query:   string
  results: TavilyResult[]
  answer?: string    // AI-generated answer summary (when requested)
}

export type SearchDepth = 'basic' | 'advanced'

export interface SearchOptions {
  maxResults?:    number        // default 5, max 10
  searchDepth?:   SearchDepth   // 'basic' (fast) | 'advanced' (deeper crawl)
  includeAnswer?: boolean       // include Tavily's own AI answer
  includeDomains?: string[]     // restrict to these domains
  excludeDomains?: string[]
  maxTokens?:     number        // auto-truncate total content (default 4000)
}

// ── Main search function ───────────────────────────────────────────────────────
export async function searchWeb(
  query: string,
  opts: SearchOptions = {},
): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    console.warn('[tavily] TAVILY_API_KEY not set — skipping web search')
    return []
  }

  const {
    maxResults    = 5,
    searchDepth   = 'basic',
    includeAnswer = false,
    includeDomains,
    excludeDomains,
    maxTokens     = 4000,
  } = opts

  try {
    const body: Record<string, unknown> = {
      api_key:       apiKey,
      query,
      max_results:   Math.min(maxResults, 10),
      search_depth:  searchDepth,
      include_answer: includeAnswer,
      include_raw_content: false,
    }
    if (includeDomains?.length)  body.include_domains = includeDomains
    if (excludeDomains?.length)  body.exclude_domains = excludeDomains

    const res = await fetch('https://api.tavily.com/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => '(no body)')
      console.error(`[tavily] API error ${res.status}: ${err.slice(0, 200)}`)
      return []
    }

    const data = await res.json() as { results?: TavilyResult[]; answer?: string }
    const raw  = data.results ?? []

    // Auto-truncate: trim content so total tokens stay under budget
    //  ~4 chars ≈ 1 token; 4000 tokens ≈ 16000 chars
    const charBudget = maxTokens * 4
    let used = 0
    return raw.map(r => {
      const remaining = charBudget - used
      if (remaining <= 0) return { ...r, content: '' }
      const trimmed = r.content.slice(0, remaining)
      used += trimmed.length
      return { ...r, content: trimmed }
    }).filter(r => r.content.length > 0)

  } catch (err) {
    console.error('[tavily] search failed:', err)
    return []
  }
}

// ── Multi-query search ────────────────────────────────────────────────────────
export async function searchWebMulti(
  queries: string[],
  opts: SearchOptions = {},
): Promise<TavilyResult[]> {
  const results = await Promise.all(
    queries.slice(0, 4).map(q => searchWeb(q, { ...opts, maxResults: 3 })),
  )

  // Deduplicate by URL, keep highest score
  const seen  = new Map<string, TavilyResult>()
  for (const batch of results) {
    for (const r of batch) {
      const existing = seen.get(r.url)
      if (!existing || r.score > existing.score) seen.set(r.url, r)
    }
  }

  return [...seen.values()].sort((a, b) => b.score - a.score)
}

// ── Format results for LLM context injection ──────────────────────────────────
export function formatResultsAsContext(results: TavilyResult[]): string {
  if (results.length === 0) return ''

  const lines: string[] = [
    '## Live Web Research',
    `*${results.length} sources retrieved via Tavily — ${new Date().toLocaleDateString()}*\n`,
  ]

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    lines.push(`### Source ${i + 1}: ${r.title}`)
    lines.push(`URL: ${r.url}`)
    if (r.publishedDate) lines.push(`Published: ${r.publishedDate}`)
    lines.push('')
    lines.push(r.content)
    lines.push('')
  }

  lines.push('---')
  lines.push('*Use the sources above to ground your response. Cite specific URLs when referencing data.*\n')

  return lines.join('\n')
}

// ── Format citations for Board card / Notion ──────────────────────────────────
export function formatCitations(results: TavilyResult[]): string {
  if (results.length === 0) return ''
  const lines = ['\n\n---\n**Sources**\n']
  results.forEach((r, i) => {
    lines.push(`${i + 1}. [${r.title}](${r.url})`)
  })
  return lines.join('\n')
}

// ── Build research queries from agent inputs ──────────────────────────────────
export function buildResearchQueries(
  capabilityId: string,
  inputs: Record<string, string>,
): string[] {
  const biz    = inputs.businessName        ?? ''
  const market = inputs.targetMarket        ?? ''
  const focus  = inputs.researchFocus       ?? ''
  const kw     = inputs.seedKeywords        ?? inputs.keywords ?? ''
  const ind    = inputs.industry            ?? ''

  switch (capabilityId) {
    case 'research':
      return [
        `${biz} market size TAM SAM competitors ${new Date().getFullYear()}`,
        focus ? `${focus} ${market}` : `${biz} competitor analysis`,
        `${market || biz} industry trends ${new Date().getFullYear()}`,
      ].filter(Boolean)

    case 'seo':
      return [
        `${kw || biz} SEO keyword analysis search volume`,
        `${biz} competitor backlinks domain authority`,
        `${market || biz} content gaps search intent`,
      ].filter(Boolean)

    case 'consultant':
      return [
        `${biz} automation tools ${ind} workflow`,
        `${ind || biz} best practices AI automation ${new Date().getFullYear()}`,
      ].filter(Boolean)

    case 'financial':
      return [
        `${biz} ${market} revenue model pricing benchmarks`,
        `${ind || market} SaaS financial metrics ARR churn`,
      ].filter(Boolean)

    case 'legal':
      return [
        `${biz} ${ind || market} compliance requirements regulations`,
      ].filter(Boolean)

    default:
      return biz ? [`${biz} ${market} latest news ${new Date().getFullYear()}`] : []
  }
}

// ── Capability IDs that benefit from live web search ─────────────────────────
export const SEARCH_ENABLED_CAPABILITIES = new Set([
  'research',
  'seo',
  'consultant',
  'financial',
  'legal',
])

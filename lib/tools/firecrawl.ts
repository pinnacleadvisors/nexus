/**
 * lib/tools/firecrawl.ts
 * Firecrawl scraper — turns a URL into clean markdown + link list.
 *
 * Usage:
 *   import { scrapeUrl, scrapeMany } from '@/lib/tools/firecrawl'
 *   const page = await scrapeUrl('https://instagram.com/cats_of_instagram')
 *   // page.markdown, page.links[], page.metadata
 *
 * Requires: FIRECRAWL_API_KEY in Doppler (free: 500 scrapes/mo).
 * Register at: https://firecrawl.dev
 *
 * Why both Firecrawl AND Tavily?
 *   - Firecrawl = "give me THIS page's contents"
 *   - Tavily    = "search the web for information about X"
 * The idea analyser uses Firecrawl to read the inspiration URL, then Tavily
 * to estimate revenue/stats for the niche.
 */

export interface ScrapedPage {
  url:      string
  title:    string
  markdown: string
  /** Outbound links — useful for discovering how the business sells */
  links:    string[]
  metadata: {
    description?: string
    ogImage?:     string
    author?:      string
    siteName?:    string
  }
  /** true when we returned a degraded/empty result */
  failed?:  boolean
  error?:   string
}

interface FirecrawlResponse {
  success: boolean
  data?: {
    markdown?: string
    links?:    string[]
    metadata?: Record<string, string | undefined>
  }
  error?: string
}

const ENDPOINT = 'https://api.firecrawl.dev/v1/scrape'

export async function scrapeUrl(
  url: string,
  opts: { maxChars?: number; timeoutMs?: number } = {},
): Promise<ScrapedPage> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  const maxChars = opts.maxChars ?? 8000
  const timeoutMs = opts.timeoutMs ?? 20_000

  if (!apiKey) {
    return {
      url,
      title: url,
      markdown: '',
      links: [],
      metadata: {},
      failed: true,
      error: 'FIRECRAWL_API_KEY not set',
    }
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'links'],
        onlyMainContent: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)')
      return {
        url,
        title: url,
        markdown: '',
        links: [],
        metadata: {},
        failed: true,
        error: `firecrawl ${res.status}: ${body.slice(0, 200)}`,
      }
    }

    const payload = await res.json() as FirecrawlResponse
    if (!payload.success || !payload.data) {
      return {
        url,
        title: url,
        markdown: '',
        links: [],
        metadata: {},
        failed: true,
        error: payload.error ?? 'firecrawl returned no data',
      }
    }

    const md = (payload.data.markdown ?? '').slice(0, maxChars)
    const meta = payload.data.metadata ?? {}

    return {
      url,
      title:    (meta.title as string) ?? url,
      markdown: md,
      links:    (payload.data.links ?? []).slice(0, 40),
      metadata: {
        description: meta.description,
        ogImage:     meta['og:image'] ?? meta.ogImage,
        author:      meta.author,
        siteName:    meta['og:site_name'] ?? meta.siteName,
      },
    }
  } catch (err) {
    return {
      url,
      title: url,
      markdown: '',
      links: [],
      metadata: {},
      failed: true,
      error: err instanceof Error ? err.message : 'firecrawl fetch failed',
    }
  }
}

/**
 * Scrape a primary URL + up to N outbound links discovered on it. Keeps the
 * total character budget bounded so we don't blow the LLM context window.
 */
export async function scrapeWithConnected(
  rootUrl: string,
  opts: { maxConnected?: number; totalCharBudget?: number } = {},
): Promise<{ root: ScrapedPage; connected: ScrapedPage[] }> {
  const maxConnected = opts.maxConnected ?? 3
  const totalBudget  = opts.totalCharBudget ?? 20_000

  const root = await scrapeUrl(rootUrl, { maxChars: Math.floor(totalBudget / 2) })
  if (root.failed) return { root, connected: [] }

  // Same-domain links only — prevents accidentally scraping ads / trackers.
  const rootHost = safeHost(rootUrl)
  const candidateLinks = root.links
    .filter(l => safeHost(l) === rootHost && l !== rootUrl)
    .slice(0, maxConnected)

  const remainingBudget = Math.max(0, totalBudget - root.markdown.length)
  const perLink = candidateLinks.length > 0
    ? Math.floor(remainingBudget / candidateLinks.length)
    : 0

  const connected = perLink > 200
    ? await Promise.all(candidateLinks.map(l => scrapeUrl(l, { maxChars: perLink })))
    : []

  return { root, connected: connected.filter(p => !p.failed && p.markdown) }
}

function safeHost(url: string): string {
  try { return new URL(url).host } catch { return '' }
}

export function formatScrapesForContext(
  root: ScrapedPage,
  connected: ScrapedPage[],
): string {
  if (root.failed) {
    return `## Inspiration URL\nScrape failed: ${root.error ?? 'unknown'}\n(Reason from URL only.)\n`
  }
  const lines = [
    `## Inspiration URL — ${root.title}`,
    `URL: ${root.url}`,
    root.metadata.description ? `Description: ${root.metadata.description}` : '',
    root.metadata.siteName ? `Site: ${root.metadata.siteName}` : '',
    '',
    root.markdown,
    '',
  ]
  for (let i = 0; i < connected.length; i++) {
    const c = connected[i]
    lines.push(`### Connected page ${i + 1}: ${c.title}`)
    lines.push(`URL: ${c.url}`)
    lines.push('')
    lines.push(c.markdown)
    lines.push('')
  }
  return lines.filter(Boolean).join('\n')
}

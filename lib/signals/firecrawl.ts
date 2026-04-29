/**
 * lib/signals/firecrawl.ts
 *
 * Thin wrapper for the self-hosted Firecrawl instance running on Coolify.
 * Reads `FIRECRAWL_API_URL` + `FIRECRAWL_API_KEY` from Doppler. When either
 * is unset the helper returns `null` so the council can degrade gracefully —
 * the Scout role simply skips and the rest of the pipeline still runs.
 *
 * The API surface mirrors Firecrawl v1: POST /v1/scrape with `{ url, formats }`
 * returning `{ data: { markdown, metadata } }`. We ask only for markdown to
 * keep the council prompt small and the cost predictable.
 */

const FIRECRAWL_TIMEOUT_MS  = 25_000
const MAX_MARKDOWN_CHARS    = 8_000   // keep council prompts inside the gateway window

export interface FirecrawlScrapeResult {
  url:         string
  title?:      string
  description?: string
  markdown:    string   // truncated to MAX_MARKDOWN_CHARS
  truncated:   boolean
}

export function isFirecrawlConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_URL && process.env.FIRECRAWL_API_KEY)
}

export async function scrapeForCouncil(url: string): Promise<FirecrawlScrapeResult | null> {
  const base  = process.env.FIRECRAWL_API_URL
  const token = process.env.FIRECRAWL_API_KEY
  if (!base || !token) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FIRECRAWL_TIMEOUT_MS)

  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/v1/scrape`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.warn('[signals/firecrawl] scrape failed:', res.status)
      return null
    }

    const json = await res.json() as {
      success?: boolean
      data?: {
        markdown?: string
        metadata?: { title?: string; description?: string; sourceURL?: string }
      }
    }

    const md = json.data?.markdown ?? ''
    const truncated = md.length > MAX_MARKDOWN_CHARS
    return {
      url,
      title:       json.data?.metadata?.title,
      description: json.data?.metadata?.description,
      markdown:    truncated ? md.slice(0, MAX_MARKDOWN_CHARS) : md,
      truncated,
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.warn('[signals/firecrawl] scrape timed out:', url)
    } else {
      console.warn('[signals/firecrawl] scrape error:', err)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

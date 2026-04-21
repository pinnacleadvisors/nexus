---
name: firecrawl_local
description: Token-free local web scraper. Use when the user wants to pull content from a public URL, map a site, or crawl a few pages for research without burning a Firecrawl API credit. Replicates scrape/map/crawl from Firecrawl's v1 API using plain fetch + a dependency-free HTML→markdown converter. Cannot replicate search (needs a search engine) or screenshots (needs a headless browser). For search, suggest Tavily or the built-in WebSearch tool.
---

# /firecrawl_local — Token-free web scraper

Three commands, all exit 0 on success and print JSON to stdout. Designed for Claude to call via Bash and then parse.

## Commands

### `scrape <url> [--max-chars=N]`
Fetches one page. Returns:
```json
{
  "url": "...",
  "title": "...",
  "description": "...",
  "markdown": "...",
  "links": ["https://...", ...],
  "metadata": { "ogImage": "...", "siteName": "...", "author": "..." },
  "truncated": false
}
```

### `map <url> [--limit=N]`
Returns every URL discovered for `<url>`'s origin via (1) `sitemap.xml`, (2) common sitemap index locations, (3) outbound `<a>` tags on the landing page. Same-origin only by default.
```json
{ "origin": "...", "urls": ["...", ...], "source": "sitemap|links|mixed" }
```

### `crawl <url> [--limit=10] [--depth=2]`
Breadth-first crawl from `<url>`, same-origin. Returns an array of scrape results. Caps at `--limit` pages and `--depth` hops.

## Usage from Claude

```bash
node .claude/skills/firecrawl_local/scrape.mjs https://example.com
node .claude/skills/firecrawl_local/map.mjs   https://example.com --limit=100
node .claude/skills/firecrawl_local/crawl.mjs https://example.com --limit=5 --depth=2
```

## When to use this vs the hosted Firecrawl API

| Need                          | Use                               |
| ----------------------------- | --------------------------------- |
| One public page → markdown    | **/firecrawl_local scrape**       |
| Discover URLs on a site       | **/firecrawl_local map**          |
| Walk a small section (≤20 pg) | **/firecrawl_local crawl**        |
| Thousands of pages / JS-heavy | hosted Firecrawl (needs API key)  |
| Screenshots                   | hosted Firecrawl or Playwright    |
| Full-text web search          | Tavily (has key) or WebSearch     |
| Sites that require a login    | none of the above                 |

## Limitations vs hosted Firecrawl
- No JS rendering — static HTML only. SPAs return bare shells.
- No stealth/anti-bot. Pages with Cloudflare Under Attack, hCaptcha, etc. will 403.
- HTML→markdown is regex-based and lossy on heavy table/figure markup.
- Same-origin crawl only; no cross-domain following.
- No retries on rate-limit; fail fast and report.

## If you hit a blocker
1. Cloudflare 403 on a target → fall back to hosted Firecrawl (`lib/tools/firecrawl.ts`).
2. SPA with empty body → user will need to paste the rendered text manually, or use Playwright.
3. Need search → suggest Tavily (already wired in `lib/tools/tavily.ts`).

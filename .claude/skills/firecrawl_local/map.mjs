#!/usr/bin/env node
// map <url> [--limit=500]  — discover URLs via sitemap + landing page links
import { httpGet, extractLinks, parseArgs, sameOrigin, fail } from './lib.mjs'

const { positional, flags } = parseArgs(process.argv.slice(2))
const url = positional[0]
if (!url) fail('usage: map <url> [--limit=500]')
const limit = Number(flags.limit ?? 500)

const origin = new URL(url).origin
const seen = new Set()
let source = 'none'

// 1. robots.txt → sitemap hints
try {
  const r = await httpGet(new URL('/robots.txt', origin).toString(), { timeoutMs: 8000 })
  if (r.ok) {
    for (const m of r.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
      await ingestSitemap(m[1])
    }
  }
} catch {}

// 2. common sitemap locations
for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml']) {
  if (seen.size >= limit) break
  try {
    await ingestSitemap(new URL(path, origin).toString())
  } catch {}
}

// 3. Fall back to scraping links off the landing page
if (seen.size === 0) {
  try {
    const r = await httpGet(url)
    if (r.ok) {
      for (const l of extractLinks(r.body, r.url)) {
        if (sameOrigin(l, origin) && seen.size < limit) seen.add(l)
      }
      source = 'links'
    }
  } catch {}
} else if (source === 'none') {
  source = 'sitemap'
}

console.log(JSON.stringify({ ok: true, origin, urls: [...seen].slice(0, limit), source, count: seen.size }))

async function ingestSitemap(sitemapUrl) {
  const r = await httpGet(sitemapUrl, { timeoutMs: 10000 })
  if (!r.ok) return
  // sitemap index → recurse
  const indexes = [...r.body.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1])
  for (const s of indexes) {
    if (seen.size >= limit) break
    await ingestSitemap(s)
  }
  // urlset entries
  for (const m of r.body.matchAll(/<url>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    if (seen.size >= limit) break
    const u = m[1]
    if (sameOrigin(u, origin)) seen.add(u)
  }
  if (source === 'none' && seen.size > 0) source = 'sitemap'
  else if (source === 'links' && seen.size > 0) source = 'mixed'
}

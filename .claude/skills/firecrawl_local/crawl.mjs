#!/usr/bin/env node
// crawl <url> [--limit=10] [--depth=2]  — BFS same-origin crawl
import { httpGet, extractMeta, extractLinks, htmlToMarkdown, parseArgs, sameOrigin, fail } from './lib.mjs'

const { positional, flags } = parseArgs(process.argv.slice(2))
const seed = positional[0]
if (!seed) fail('usage: crawl <url> [--limit=10] [--depth=2]')
const limit = Number(flags.limit ?? 10)
const maxDepth = Number(flags.depth ?? 2)

const visited = new Set()
const queue = [{ url: seed, depth: 0 }]
const results = []

while (queue.length && results.length < limit) {
  const { url, depth } = queue.shift()
  if (visited.has(url)) continue
  visited.add(url)
  try {
    const r = await httpGet(url, { timeoutMs: 12000 })
    if (!r.ok || !/html|xml|text/.test(r.contentType)) continue
    const meta = extractMeta(r.body)
    const links = extractLinks(r.body, r.url)
    const md = htmlToMarkdown(r.body).slice(0, 80_000)
    results.push({ url: r.url, title: meta.title, markdown: md, linkCount: links.length })
    if (depth < maxDepth) {
      for (const l of links) {
        if (sameOrigin(l, seed) && !visited.has(l)) queue.push({ url: l, depth: depth + 1 })
      }
    }
  } catch {}
}

console.log(JSON.stringify({ ok: true, seed, visited: visited.size, pages: results }))

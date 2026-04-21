#!/usr/bin/env node
// scrape <url> [--max-chars=200000]
import { httpGet, extractMeta, extractLinks, htmlToMarkdown, parseArgs, fail } from './lib.mjs'

const { positional, flags } = parseArgs(process.argv.slice(2))
const url = positional[0]
if (!url) fail('usage: scrape <url> [--max-chars=N]')
const maxChars = Number(flags['max-chars'] ?? 200_000)

try {
  const res = await httpGet(url)
  if (!res.ok) fail(`http ${res.status}`, { url, status: res.status })
  if (!res.contentType.includes('html') && !res.contentType.includes('xml') && !res.contentType.includes('text')) {
    fail(`non-html content-type: ${res.contentType}`, { url })
  }
  const meta = extractMeta(res.body)
  const links = extractLinks(res.body, res.url)
  let md = htmlToMarkdown(res.body)
  const truncated = md.length > maxChars
  if (truncated) md = md.slice(0, maxChars) + '\n\n…[truncated]'
  console.log(JSON.stringify({
    ok: true,
    url: res.url,
    title: meta.title,
    description: meta.description,
    markdown: md,
    links,
    metadata: meta.metadata,
    truncated,
  }))
} catch (e) {
  fail(e.message || String(e), { url })
}

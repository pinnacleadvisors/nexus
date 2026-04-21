// Shared helpers for /firecrawl_local — zero deps, Node 18+ fetch.

const UA =
  'Mozilla/5.0 (compatible; NexusFirecrawlLocal/1.0; +https://nexus.local)'

export async function httpGet(url, { timeoutMs = 15000 } = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/xml,*/*' },
    })
    const body = await res.text()
    return { ok: res.ok, status: res.status, url: res.url, body, contentType: res.headers.get('content-type') || '' }
  } finally {
    clearTimeout(t)
  }
}

export function extractMeta(html) {
  const pick = (re) => {
    const m = html.match(re)
    return m ? decodeHtml(m[1].trim()) : undefined
  }
  const title =
    pick(/<title[^>]*>([\s\S]*?)<\/title>/i) ||
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    ''
  const description =
    pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
  const ogImage = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
  const siteName = pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
  const author = pick(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i)
  return { title, description, metadata: { ogImage, siteName, author } }
}

export function extractLinks(html, baseUrl) {
  const base = new URL(baseUrl)
  const out = new Set()
  const re = /<a\b[^>]*\bhref=["']([^"']+)["']/gi
  let m
  while ((m = re.exec(html))) {
    const raw = m[1].trim()
    if (!raw || raw.startsWith('#') || raw.startsWith('javascript:') || raw.startsWith('mailto:') || raw.startsWith('tel:')) continue
    try {
      out.add(new URL(raw, base).toString().split('#')[0])
    } catch {}
  }
  return [...out]
}

// Strip doc to just the best candidate content region, then convert to markdown.
export function htmlToMarkdown(html) {
  let s = html

  // Strip junk
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<(script|style|noscript|iframe|svg|canvas|form|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, '')

  // Prefer main/article content if present
  const main = s.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i)
  if (main) s = main[2]

  // Block-level conversions
  s = s.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `\n\n# ${stripTags(c)}\n\n`)
  s = s.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `\n\n## ${stripTags(c)}\n\n`)
  s = s.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `\n\n### ${stripTags(c)}\n\n`)
  s = s.replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `\n\n#### ${stripTags(c)}\n\n`)
  s = s.replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, (_, c) => `\n\n##### ${stripTags(c)}\n\n`)
  s = s.replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, (_, c) => `\n\n###### ${stripTags(c)}\n\n`)
  s = s.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `\n\n${inlineMd(c)}\n\n`)
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => `\n\n> ${stripTags(c).trim().replace(/\n/g, '\n> ')}\n\n`)
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => `\n\n\`\`\`\n${stripTags(c)}\n\`\`\`\n\n`)
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${inlineMd(c).trim()}\n`)
  s = s.replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n')

  // Inline
  s = inlineMd(s)

  // Decode entities + whitespace cleanup
  s = decodeHtml(s)
  s = s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim()

  return s
}

function inlineMd(s) {
  s = s.replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `[${stripTags(text).trim()}](${href})`)
  s = s.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*\balt=["']([^"']*)["'][^>]*>/gi, (_, src, alt) => `![${alt}](${src})`)
  s = s.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (_, src) => `![](${src})`)
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
  return stripTags(s)
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '')
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»' }
export function decodeHtml(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, k) => ENTITIES[k.toLowerCase()] || m)
}

export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      flags[k] = v === undefined ? true : v
    } else positional.push(a)
  }
  return { positional, flags }
}

export function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

export function fail(msg, extra = {}) {
  console.log(JSON.stringify({ ok: false, error: msg, ...extra }))
  process.exit(1)
}

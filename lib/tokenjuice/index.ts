/**
 * lib/tokenjuice/index.ts - deterministic pre-LLM text compression.
 *
 * Pattern absorbed (clean-room, NOT copied) from OpenHuman's "TokenJuice"
 * (GPL-3.0 - reimplemented from scratch here). Cuts the tokens we feed the
 * gateway on every large scrape / tool-output round-trip, with no model
 * change. Lives in the h2 (action-realization) layer; provider-agnostic by
 * construction (uses a ~4-chars/token heuristic, no model-specific tokenizer).
 *
 * Pure + synchronous: no network, no fs, no LLM, no Date/Math.random - same
 * input always yields the same output (the smoke test asserts idempotency).
 *
 * Pipeline (each stage opt-gated, run in order):
 *   1. htmlToMarkdown  - only if the input looks like HTML
 *   2. stripDecorative - drop emoji / pictographs / control chars (KEEPS all
 *      letters incl. CJK + accented - conservative, not "strip non-ASCII")
 *   3. shortenUrls     - collapse long inline/bare URLs to host + short path
 *   4. dedupe          - drop consecutive duplicate lines + collapse blank runs
 */

export interface CompressOpts {
  /** Convert HTML->Markdown when the input looks like HTML. Default true. */
  html?:            boolean
  /** Drop emoji / pictographs / control chars. Keeps letters. Default true. */
  stripDecorative?: boolean
  /** Collapse long URLs to host + truncated path. Default true. */
  shortenUrls?:     boolean
  /** Drop consecutive duplicate lines + collapse blank runs. Default true. */
  dedupe?:          boolean
}

export interface CompressResult {
  text:        string
  /** Estimated tokens saved (~4 chars/token heuristic). */
  savedTokens: number
}

const HTML_SIGNAL = /<(\/?[a-z][a-z0-9]*)(\s[^>]*)?>/i

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  copy: '©', reg: '®', trade: '™',
}

const ELLIPSIS = '…'

// Decorative/control code-point ranges to drop. Numbers only -> no literal
// special chars in source. Keeps tab (0x09) + newline (0x0A); keeps all
// letters, digits, and common punctuation (CJK + accented text survive).
const DECORATIVE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0008], [0x000b, 0x000c], [0x000e, 0x001f], [0x007f, 0x009f], // control
  [0x200b, 0x200d], [0xfe00, 0xfe0f],                                     // zero-width + variation selectors
  [0x2190, 0x21ff], [0x2300, 0x27bf], [0x2b00, 0x2bff], [0x2600, 0x26ff], // arrows + symbols/dingbats
  [0x1f000, 0x1faff],                                                     // astral emoji/pictographs
]

const DECORATIVE = new RegExp(
  '[' + DECORATIVE_RANGES.map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join('') + ']',
  'gu',
)

function safeFromCode(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return ''
  try { return String.fromCodePoint(n) } catch { return '' }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCode(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
}

function stripTags(s: string): string {
  return s.replace(/<\/?[a-z][^>]*>/gi, '')
}

function inlineText(s: string): string {
  return decodeEntities(stripTags(s)).replace(/\s+/g, ' ').trim()
}

/** Clean-room HTML->Markdown via regex. Handles the structural tags that carry
 *  meaning; everything else is stripped. Not a full parser. */
function htmlToMarkdown(html: string): string {
  let s = html
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<(script|style|head|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, inner) =>
    `\n\n${'#'.repeat(Number(lvl))} ${inlineText(inner)}\n\n`)
  s = s.replace(/<\/(p|div|section|article|header|footer|tr|ul|ol|table)>/gi, '\n\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n- ${inlineText(inner)}`)
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => `\n> ${inlineText(inner)}\n`)
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => `\n\`\`\`\n${stripTags(inner)}\n\`\`\`\n`)
  s = s.replace(/<a\s[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const t = inlineText(inner).trim()
    return t ? `[${t}](${href})` : ''
  })
  s = s.replace(/<img\s[^>]*alt=["']([^"']*)["'][^>]*>/gi, (_, alt) => (alt ? `(image: ${alt})` : ''))
  s = s.replace(/<img\b[^>]*>/gi, '')
  s = stripTags(s)
  s = decodeEntities(s)
  return s
}

function stripDecorative(s: string): string {
  return s.replace(DECORATIVE, '').replace(/[ \t]{2,}/g, ' ')
}

/** Collapse a long URL to host + short path. Short URLs pass through. */
function shortenOne(url: string): string {
  if (url.length <= 48) return url
  const m = url.match(/^(https?:\/\/)?([^/]+)(\/.*)?$/i)
  if (!m) return url.slice(0, 48) + ELLIPSIS
  const host = m[2]
  const path = m[3] ?? ''
  const shortPath = path.length > 16 ? path.slice(0, 16) + ELLIPSIS : path
  return `${host}${shortPath}`
}

function shortenUrls(s: string): string {
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, (_, text, href) => `[${text}](${shortenOne(href)})`)
  s = s.replace(/(^|\s)(https?:\/\/[^\s)]+)/gi, (_, pre, url) => `${pre}${shortenOne(url)}`)
  return s
}

function dedupe(s: string): string {
  const lines = s.split('\n')
  const out: string[] = []
  let blanks = 0
  let prevNonBlank = ''
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/g, '')
    if (line.trim() === '') {
      blanks++
      if (blanks <= 1) out.push('')
      continue
    }
    blanks = 0
    if (line.trim() === prevNonBlank.trim()) continue
    out.push(line)
    prevNonBlank = line
  }
  return out.join('\n').trim()
}

/**
 * Compress text deterministically. Returns the compressed text + an estimate
 * of tokens saved. Safe on already-plain text.
 */
export function compress(text: string, opts: CompressOpts = {}): CompressResult {
  const o = {
    html:            opts.html            ?? true,
    stripDecorative: opts.stripDecorative ?? true,
    shortenUrls:     opts.shortenUrls     ?? true,
    dedupe:          opts.dedupe          ?? true,
  }
  if (typeof text !== 'string' || text.length === 0) return { text: text ?? '', savedTokens: 0 }

  const before = text.length
  let s = text
  if (o.html && HTML_SIGNAL.test(s)) s = htmlToMarkdown(s)
  if (o.stripDecorative)             s = stripDecorative(s)
  if (o.shortenUrls)                 s = shortenUrls(s)
  if (o.dedupe)                      s = dedupe(s)
  s = s.replace(/\n{3,}/g, '\n\n').trim()

  const savedTokens = Math.max(0, Math.round((before - s.length) / 4))
  return { text: s, savedTokens }
}

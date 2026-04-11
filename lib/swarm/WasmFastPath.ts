/**
 * lib/swarm/WasmFastPath.ts
 *
 * Fast-path for deterministic transforms that don't require an LLM.
 * Implemented in pure JavaScript (WASM modules can be added later as drop-in
 * replacements under lib/swarm/wasm/).
 *
 * Returns null when the transform cannot be applied, so the caller falls
 * back to an LLM invocation.
 */

// ── Type definitions ──────────────────────────────────────────────────────────
export type FastPathResult = { result: string; tokensUsed: 0 } | null

// ── JSON format / validate ────────────────────────────────────────────────────
export function formatJson(input: string): FastPathResult {
  try {
    const parsed = JSON.parse(input)
    return { result: JSON.stringify(parsed, null, 2), tokensUsed: 0 }
  } catch {
    return null
  }
}

// ── Extract URLs from text ────────────────────────────────────────────────────
export function extractUrls(text: string): FastPathResult {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g
  const urls     = [...new Set(text.match(urlRegex) ?? [])]
  if (!urls.length) return { result: '(no URLs found)', tokensUsed: 0 }
  return { result: urls.join('\n'), tokensUsed: 0 }
}

// ── Text normalisation ────────────────────────────────────────────────────────
export function normaliseText(text: string): FastPathResult {
  const result = text
    .replace(/[^\x20-\x7E\n\r\t]/g, '')      // strip non-ASCII
    .replace(/\s+/g, ' ')                     // collapse whitespace
    .replace(/^\s+|\s+$/g, '')                // trim
  return { result, tokensUsed: 0 }
}

// ── Word count ────────────────────────────────────────────────────────────────
export function wordCount(text: string): FastPathResult {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const chars = text.length
  const lines = text.split('\n').length
  return {
    result: `Word count: ${words}\nCharacter count: ${chars}\nLine count: ${lines}`,
    tokensUsed: 0,
  }
}

// ── Date parsing / formatting ─────────────────────────────────────────────────
export function parseDate(input: string): FastPathResult {
  const d = new Date(input)
  if (isNaN(d.getTime())) return null
  return {
    result: [
      `ISO:       ${d.toISOString()}`,
      `UTC:       ${d.toUTCString()}`,
      `Local:     ${d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
      `Unix:      ${Math.floor(d.getTime() / 1000)}`,
    ].join('\n'),
    tokensUsed: 0,
  }
}

// ── Template variable substitution ───────────────────────────────────────────
export function substituteVars(
  template: string,
  vars: Record<string, string>,
): FastPathResult {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }
  // Fail if any unresolved placeholders remain
  if (/\{\{[^}]+\}\}/.test(result)) return null
  return { result, tokensUsed: 0 }
}

// ── Markdown → plain text ─────────────────────────────────────────────────────
export function stripMarkdown(text: string): FastPathResult {
  const result = text
    .replace(/#{1,6}\s+/g, '')           // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')     // bold
    .replace(/\*(.+?)\*/g, '$1')         // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '')  // code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/^\s*[-*+]\s+/gm, '')       // list bullets
    .replace(/^\s*\d+\.\s+/gm, '')       // numbered lists
    .trim()
  return { result, tokensUsed: 0 }
}

// ── Dispatch function — try fast-path before LLM ──────────────────────────────
export type FastPathOp = 'format-json' | 'extract-urls' | 'normalise' | 'word-count' | 'parse-date' | 'strip-markdown'

export function tryFastPath(op: FastPathOp, input: string): FastPathResult {
  switch (op) {
    case 'format-json':   return formatJson(input)
    case 'extract-urls':  return extractUrls(input)
    case 'normalise':     return normaliseText(input)
    case 'word-count':    return wordCount(input)
    case 'parse-date':    return parseDate(input)
    case 'strip-markdown':return stripMarkdown(input)
    default:              return null
  }
}

// ── Detect if a task can use the fast-path ────────────────────────────────────
export function detectFastPathOp(description: string): FastPathOp | null {
  const d = description.toLowerCase()
  if (d.includes('format json') || d.includes('validate json')) return 'format-json'
  if (d.includes('extract url') || d.includes('find url'))     return 'extract-urls'
  if (d.includes('normalise text') || d.includes('clean text')) return 'normalise'
  if (d.includes('word count') || d.includes('count words'))   return 'word-count'
  if (d.includes('parse date') || d.includes('format date'))   return 'parse-date'
  if (d.includes('strip markdown') || d.includes('plain text'))return 'strip-markdown'
  return null
}

/**
 * lib/swarm/TokenOptimiser.ts
 *
 * Reduces context size by 30–50% before sending to the LLM.
 * Techniques (applied in order):
 * 1. Whitespace normalisation (free, instant)
 * 2. Deduplication of repeated paragraphs (free, instant)
 * 3. Hard truncation with summary marker if still too large
 *
 * Target: keep context under `targetTokens` (approximated as chars/4).
 */

// ── Char-based token approximation ───────────────────────────────────────────
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ── Normalise whitespace ──────────────────────────────────────────────────────
function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')          // Windows line endings
    .replace(/\t/g, '  ')            // tabs → 2 spaces
    .replace(/[ \t]+$/gm, '')        // trailing whitespace per line
    .replace(/\n{4,}/g, '\n\n\n')    // max 3 consecutive blank lines
    .trim()
}

// ── Remove duplicate paragraphs ───────────────────────────────────────────────
function deduplicateParagraphs(text: string): string {
  const paragraphs  = text.split(/\n{2,}/)
  const seen        = new Set<string>()
  const unique: string[] = []

  for (const para of paragraphs) {
    const key = para.trim().slice(0, 80) // use first 80 chars as fingerprint
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(para)
    }
  }

  return unique.join('\n\n')
}

// ── Truncate preserving structure ─────────────────────────────────────────────
function smartTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text

  // Try to cut at a paragraph boundary
  const cutoff   = maxChars - 200 // leave room for truncation note
  const boundary = text.lastIndexOf('\n\n', cutoff)
  const cut      = boundary > cutoff / 2 ? boundary : cutoff

  return text.slice(0, cut) + '\n\n[...content truncated for token efficiency...]'
}

// ── Strip code blocks to summaries if oversized ───────────────────────────────
function compressCodeBlocks(text: string, targetChars: number): string {
  if (text.length <= targetChars) return text

  return text.replace(/```[\s\S]{500,}?```/g, match => {
    const lines  = match.split('\n')
    const lang   = lines[0].replace('```', '').trim()
    const lineCount = lines.length - 2
    return `\`\`\`${lang}\n[${lineCount} lines of ${lang || 'code'} — omitted for brevity]\n\`\`\``
  })
}

// ── Main entry point ──────────────────────────────────────────────────────────
export function optimiseContext(
  text:          string,
  targetTokens?: number,
): { text: string; originalTokens: number; optimisedTokens: number; savingPct: number } {
  const originalTokens = approxTokens(text)
  const maxChars       = (targetTokens ?? 12_000) * 4 // default 12k token target

  let result = normaliseWhitespace(text)
  result     = deduplicateParagraphs(result)
  result     = compressCodeBlocks(result, maxChars)
  result     = smartTruncate(result, maxChars)

  const optimisedTokens = approxTokens(result)
  const savingPct       = originalTokens > 0
    ? Math.round(((originalTokens - optimisedTokens) / originalTokens) * 100)
    : 0

  return { text: result, originalTokens, optimisedTokens, savingPct }
}

// ── Compress a list of prior results for swarm context ────────────────────────
export function buildSwarmContext(
  goal:          string,
  priorResults:  Array<{ phase: number; title: string; result: string }>,
  targetTokens   = 8_000,
): string {
  const parts: string[] = [`## Swarm Goal\n${goal}`]

  for (const r of priorResults) {
    const resultSnippet = r.result.slice(0, 1000)
    parts.push(`## Phase ${r.phase}: ${r.title}\n${resultSnippet}${r.result.length > 1000 ? '\n[...truncated...]' : ''}`)
  }

  const raw = parts.join('\n\n---\n\n')
  const { text } = optimiseContext(raw, targetTokens)
  return text
}

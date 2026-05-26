#!/usr/bin/env node
/**
 * Static-pattern audit for the three CodeQL alert families that
 * repeatedly land on Nexus PRs and consume a fix-cycle each time:
 *
 *   1. js/request-forgery               (SSRF)
 *   2. js/clear-text-logging            (secrets in console)
 *   3. js/path-injection                (unsanitised paths in fs/path)
 *
 * Run via:
 *   npm run check:codeql-patterns
 *   node scripts/check-codeql-patterns.mjs
 *   node scripts/check-codeql-patterns.mjs --strict   (exit 1 on warnings)
 *
 * Designed for speed (~1-2s on a cold cache) and zero false positives
 * in the current tree. Each finding has a one-line fix hint matching
 * the pattern the operator already shipped (URL-rebuild base literal,
 * `requireHostInAllowlist`, `slugIsSafe`, `process.stdout.write`).
 *
 * Exempt comments:
 *   // codeql-check: ignore        — single-line exemption with rationale
 *   // lgtm[js/request-forgery]    — CodeQL's own exemption marker (honoured)
 *
 * NOT a substitute for CodeQL itself — CodeQL's data-flow analysis
 * catches paths these regex patterns miss. This script catches the
 * shapes that DEFINITELY trigger CodeQL so the operator doesn't burn
 * a PR cycle round-tripping the same fix.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(import.meta.dirname, '..')
const STRICT = process.argv.includes('--strict')

// ── Utilities (parallel to check-retry-storm.mjs) ───────────────────────────

function listFiles(dir, filter = /\.(ts|tsx)$/) {
  if (!existsSync(dir)) return []
  const out = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try { entries = readdirSync(cur) } catch { continue }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.next' || name === '.git' || name === 'dist') continue
      const full = join(cur, name)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) stack.push(full)
      else if (filter.test(name)) out.push(full)
    }
  }
  return out
}

function rel(f) { return relative(ROOT, f) }

function isLineExempt(lines, i) {
  // Look at this line and the previous one for an inline exempt comment.
  const window = (lines[i] ?? '') + '\n' + (lines[i - 1] ?? '')
  return /\/\/\s*codeql-check\s*:\s*ignore|lgtm\[js\/(?:request-forgery|clear-text-logging|path-injection)\]/.test(window)
}

/** Line is inside a comment (//, /* … *​/, or a leading `*` in a JSDoc body). */
function isCommentLine(line) {
  const t = line.trimStart()
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/')
}

// ── 1. SSRF — fetches with req-origin-derived URLs ──────────────────────────
//
// The canonical pattern CodeQL catches:
//     const origin = new URL(req.url).origin
//     await fetch(`${origin}/api/internal-thing`, ...)
//
// Operator's fixed pattern (since PR #361):
//     import { getInternalBaseUrl } from '@/lib/internal-fetch'
//     const base = getInternalBaseUrl()
//     await fetch(`${base}/api/internal-thing`, ...)
//
// We detect the bad pattern by walking app/api/ for `new URL(req.url)`
// followed by a fetch in the next ~10 lines. Safe lib/internal-fetch
// usage skips because it doesn't use `new URL(req.url)`.

function checkSsrfReqOrigin() {
  const findings = []
  const files = [
    ...listFiles(join(ROOT, 'app', 'api')),
    ...listFiles(join(ROOT, 'app', '(protected)')).filter(f => f.endsWith('route.ts')),
  ]
  for (const f of files) {
    const text  = readFileSync(f, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue
      if (!/new\s+URL\s*\(\s*req\.url\s*\)/.test(lines[i])) continue
      if (isLineExempt(lines, i)) continue
      // Find a fetch within 12 lines that uses the captured origin/base.
      const window = lines.slice(i, Math.min(i + 12, lines.length)).join('\n')
      if (/await\s+fetch\s*\(|void\s+fetch\s*\(/.test(window) && /\$\{[a-zA-Z_$][\w$]*\}/.test(window)) {
        findings.push({
          file:    rel(f),
          line:    i + 1,
          snippet: lines[i].trim().slice(0, 100),
          hint:    'Use getInternalBaseUrl() from lib/internal-fetch.ts instead of new URL(req.url).origin. CodeQL flags req-derived URLs as SSRF; the helper reads NEXUS_BASE_URL → VERCEL_URL → localhost.',
        })
      }
    }
  }
  return { name: 'ssrf-req-url-origin', findings }
}

// ── 2. SSRF — fetches whose URL is built from user input via substring ──────
//
// `if (url.includes('hooks.slack.com')) fetch(url, ...)` — CodeQL flags
// because data-flow sees the URL as user-controlled. The fix is either:
//   (a) parsed-URL hostname check + URL rebuild with literal base, OR
//   (b) requireHostInAllowlist / hostMatches from lib/url-validation.ts

function checkSsrfIncompleteSubstring() {
  const findings = []
  const files = listFiles(join(ROOT, 'lib')).concat(
    listFiles(join(ROOT, 'app', 'api')),
    listFiles(join(ROOT, 'components')),
  )
  for (const f of files) {
    if (f.endsWith('database.types.ts')) continue
    const text  = readFileSync(f, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue
      // Match `url.includes('host.com')` or `href.includes('host.com')` — a
      // substring-host check is the smoking gun for js/incomplete-url-substring-sanitization.
      if (!/\b(?:url|href|webhookUrl|response_url)\b\s*\.\s*includes\s*\(\s*['"][^'"]*\.(?:com|org|net|io|app|dev|cloud|sh)['"]/i.test(lines[i])) continue
      if (isLineExempt(lines, i)) continue
      findings.push({
        file:    rel(f),
        line:    i + 1,
        snippet: lines[i].trim().slice(0, 100),
        hint:    'Replace `url.includes("host.com")` with `hostMatches(url, "host.com")` from lib/url-validation.ts (parsed URL + suffix-aware). includes() flags as js/incomplete-url-substring-sanitization.',
      })
    }
  }
  return { name: 'ssrf-incomplete-substring', findings }
}

// ── 3. Clear-text logging — secret-shaped env vars reaching console.* ───────
//
// CodeQL flags `console.log(process.env.X)` whenever X looks secret. We
// match the env-var name: TOKEN, KEY, SECRET, PASSWORD, AUTH (case-insens).
// Skip when the value is presence-checked (`!!process.env.X`) or
// length-checked (`.length`) or sliced.

const SECRET_NAME_RE = /process\.env\.[A-Z0-9_]*?(?:TOKEN|KEY|SECRET|PASSWORD|AUTH|API_KEY)\b/

function checkClearTextLogging() {
  const findings = []
  const files = [
    ...listFiles(join(ROOT, 'lib')),
    ...listFiles(join(ROOT, 'app', 'api')),
    ...listFiles(join(ROOT, 'scripts'), /\.(mjs|js|ts)$/),
    ...listFiles(join(ROOT, 'services'), /\.(mjs|js|ts)$/),
  ]
  for (const f of files) {
    if (f.endsWith('database.types.ts')) continue
    const text  = readFileSync(f, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue
      if (!/console\.(log|warn|error|info)\s*\(/.test(lines[i])) continue
      if (isLineExempt(lines, i)) continue
      // Find the closing paren of THIS console call across at most 4 lines.
      // Then check ONLY that argument span for SECRET_NAME_RE — not the
      // surrounding file. Matches the data-flow path CodeQL actually
      // analyses (the value lands in console.* args).
      let argSpan = lines[i]
      let depth   = (lines[i].match(/\(/g) || []).length - (lines[i].match(/\)/g) || []).length
      for (let j = 1; j < 4 && depth > 0 && i + j < lines.length; j++) {
        argSpan += ' ' + lines[i + j]
        depth   += (lines[i + j].match(/\(/g) || []).length - (lines[i + j].match(/\)/g) || []).length
      }
      if (!SECRET_NAME_RE.test(argSpan)) continue
      // Allow safe forms: !!, .length, .slice, Boolean(), redact() / mask() helpers
      if (/!!\s*process\.env|process\.env\.[A-Z0-9_]+(?:\?\.)?\.(length|slice)|Boolean\s*\(\s*process\.env|redact\s*\(|mask\s*\(/.test(argSpan)) continue
      findings.push({
        file:    rel(f),
        line:    i + 1,
        snippet: lines[i].trim().slice(0, 100),
        hint:    'CodeQL flags secret-shaped env vars in console.*. Log presence (!! / .length >= N), use process.stdout.write for non-secret operator output, or strip + redact before logging.',
      })
    }
  }
  return { name: 'clear-text-logging-secrets', findings }
}

// ── 4. Path injection — fs/path operations with unsanitised slug/id input ───
//
// The pattern CodeQL flags: `fs.readFile(path.join(BASE, params.slug), ...)`
// where params.slug is not validated against a known-safe regex.
// Safe forms we accept:
//   - the line is preceded (within 10 lines) by `if (!/^[0-9a-f-]+$/i.test(<var>))`
//     or `if (!slugIsSafe(<var>))` or similar
//   - `path.join(BASE, encodeURIComponent(<var>))` — escaped

const UNSAFE_PATH_RE = /\b(?:fs\.(?:readFile|writeFile|readdir|stat|lstat|access|appendFile|createReadStream|createWriteStream|unlink|rm|rmdir)|require\s*\(\s*`|import\s*\(\s*`)/

function checkPathInjection() {
  const findings = []
  const files = [
    ...listFiles(join(ROOT, 'app', 'api')),
    ...listFiles(join(ROOT, 'lib')),
    ...listFiles(join(ROOT, 'services'), /\.(mjs|js|ts)$/),
    ...listFiles(join(ROOT, 'scripts'), /\.(mjs|js|ts)$/),
  ]
  for (const f of files) {
    if (f.endsWith('database.types.ts')) continue
    const text  = readFileSync(f, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue
      if (!UNSAFE_PATH_RE.test(lines[i])) continue
      if (isLineExempt(lines, i)) continue
      // Allow when the line uses a static path (no `${...}` interpolation
      // AND no concatenated identifier from outside).
      if (!/\$\{|\+\s*[a-zA-Z_$]/.test(lines[i])) continue
      // Examine the preceding 12 lines for a slug-validation check
      const prev = lines.slice(Math.max(0, i - 12), i).join('\n')
      if (/slugIsSafe\s*\(|\/\^\[[0-9a-f.\-A-Z_]+\]/.test(prev)) continue
      if (/encodeURIComponent\s*\(/.test(lines[i])) continue
      findings.push({
        file:    rel(f),
        line:    i + 1,
        snippet: lines[i].trim().slice(0, 100),
        hint:    'Path-like operations on user-controlled values must validate against a slug regex BEFORE the call. Add `if (!/^[0-9a-f-]{36}$/i.test(id)) return error` or use slugIsSafe(), or wrap the value in encodeURIComponent().',
      })
    }
  }
  return { name: 'path-injection', findings }
}

// ── Runner ──────────────────────────────────────────────────────────────────

const checks = [
  checkSsrfReqOrigin,
  checkSsrfIncompleteSubstring,
  checkClearTextLogging,
  checkPathInjection,
]

let hadFailure = false

console.log('\n🔍  CodeQL-pattern static audit\n')
for (const fn of checks) {
  const { name, findings } = fn()
  const tag = findings.length === 0 ? '✅  PASS' : `❌  FAIL  (${findings.length} finding${findings.length === 1 ? '' : 's'})`
  console.log(`  ${tag}  ${name}`)
  if (findings.length > 0) {
    hadFailure = true
    for (const f of findings.slice(0, 5)) {
      console.log(`        • ${f.file}:${f.line}`)
      console.log(`          ${f.snippet}`)
      console.log(`          hint: ${f.hint}`)
    }
    if (findings.length > 5) {
      console.log(`        … +${findings.length - 5} more`)
    }
  }
}

console.log('')
if (hadFailure) {
  console.log('❌  CodeQL-pattern checks failed. Fix the patterns above OR add a `// codeql-check: ignore` comment with a one-line rationale.')
  process.exit(STRICT ? 1 : 1)
}
console.log('✅  All CodeQL-pattern checks passed.')
process.exit(0)

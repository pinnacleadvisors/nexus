/**
 * lib/url-validation.ts — defensive URL parsing helpers.
 *
 * Two recurring CodeQL findings the platform kept tripping:
 *
 *   1. js/incomplete-url-substring-sanitization — checking via
 *      `url.includes('github.com')` matches `evil.com/github.com/x`. Fix
 *      requires actually parsing the URL and comparing the hostname.
 *
 *   2. js/request-forgery — outbound fetch URLs constructed from user data
 *      with no host-allowlist. Even when the input "looks like" a Notion
 *      page URL, the host could be anything.
 *
 * These helpers give callers a single safe shape:
 *
 *   if (!hostMatches(url, 'github.com')) throw new Error('not github')
 *   const safe = requireHostInAllowlist(url, ['api.notion.com', 'notion.so'])
 *
 * Both use the standard URL parser — no manual indexOf / endsWith on the
 * raw string, no "starts with https://" heuristics.
 */

/**
 * True iff the URL's hostname EXACTLY equals `host` OR is a subdomain of it.
 * Defends against the classic 'evil.com/github.com' bypass that bites
 * naive `url.includes('github.com')` checks.
 *
 * Returns false on any parsing failure (malformed URL, relative URL, etc).
 */
export function hostMatches(url: string, host: string): boolean {
  if (!url || !host) return false
  let parsed: URL
  try { parsed = new URL(url) } catch { return false }
  const h = parsed.hostname.toLowerCase()
  const target = host.toLowerCase().replace(/^\./, '')   // tolerate '.example.com'
  return h === target || h.endsWith(`.${target}`)
}

/**
 * True iff the URL's hostname matches any host in the allowlist (or a
 * subdomain of one). Use to fix js/incomplete-url-substring-sanitization
 * when you want any of several known hosts to count.
 */
export function hostInAllowlist(url: string, hosts: string[]): boolean {
  return hosts.some(h => hostMatches(url, h))
}

/**
 * Parse + require the URL's hostname to match one of `allowedHosts`.
 * Returns the validated URL object. Throws on parse failure or host
 * mismatch — gives the caller a single throw point for SSRF defence.
 *
 * Usage (the AbortSignal.timeout is the standard retry-storm-safe shape):
 *   const target = requireHostInAllowlist(input, ['api.notion.com'])
 *   await fetch(target.toString(), { signal: AbortSignal.timeout(15_000) })
 */
export function requireHostInAllowlist(url: string, allowedHosts: string[]): URL {
  let parsed: URL
  try { parsed = new URL(url) }
  catch { throw new UrlValidationError(`malformed URL: ${url.slice(0, 80)}`) }
  if (!hostInAllowlist(url, allowedHosts)) {
    throw new UrlValidationError(
      `host "${parsed.hostname}" not in allowlist [${allowedHosts.join(', ')}]`,
    )
  }
  return parsed
}

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlValidationError'
  }
}

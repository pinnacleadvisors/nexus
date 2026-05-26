/**
 * lib/internal-fetch.ts — safe same-origin fetch for route → route calls.
 *
 * The recurring CodeQL `js/request-forgery` finding was: many routes do
 *   const origin = new URL(req.url).origin
 *   fetch(`${origin}/api/...`)
 * which the analyzer flags because `req.url` is technically derived from
 * the Host header — user-influenced behind a misconfigured proxy. In
 * practice we run behind Cloudflare Tunnel + Coolify which pin the Host,
 * but the cleaner fix is to NEVER trust req.url for the outbound URL.
 *
 * This helper resolves the base URL from a fixed, hardcoded source in
 * strict order:
 *   1. process.env.NEXUS_BASE_URL  (production — set in Doppler)
 *   2. process.env.VERCEL_URL      (Vercel preview deploys, transient)
 *   3. http://localhost:<PORT>     (dev fallback)
 *
 * None of those depend on incoming request headers, so CodeQL has nothing
 * to flag. Same-origin behaviour preserved (the resolved base IS the
 * platform's own domain in prod).
 */

const DEFAULT_LOCAL_PORT = '3000'

/**
 * Resolve the canonical base URL for same-origin internal calls. The result
 * is a string like `https://nexus.coolifycloudtunnel.uk` (no trailing slash).
 *
 * Throws when nothing resolves — that's a server misconfiguration; better
 * to fail loudly than silently fetch against an unintended host.
 */
export function getInternalBaseUrl(): string {
  const fromEnv = process.env.NEXUS_BASE_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/$/, '')}`

  const port = process.env.PORT?.trim() || DEFAULT_LOCAL_PORT
  return `http://localhost:${port}`
}

/**
 * Same-origin fetch using a hardcoded base URL — does NOT consume `req.url`.
 *
 * Usage:
 *   // Replace:
 *   //   const origin = new URL(req.url).origin
 *   //   const res = await fetch(`${origin}/api/foo`, { ... })
 *   // With:
 *   const res = await internalFetch('/api/foo', {
 *     method: 'POST',
 *     cookie: req.headers.get('cookie'),
 *     body:   JSON.stringify(payload),
 *   })
 *
 * The `path` MUST start with '/' and MUST NOT contain a host. We refuse to
 * proceed otherwise — preventing path-traversal of any kind into an
 * unintended host.
 */
export interface InternalFetchInit {
  method?:  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  /** Forward operator cookie when the called route needs Clerk session auth. */
  cookie?:  string | null
  body?:    BodyInit | null
  signal?:  AbortSignal
  cache?:   RequestCache
}

export async function internalFetch(
  path: string,
  init: InternalFetchInit = {},
): Promise<Response> {
  if (!path.startsWith('/') || /^\/\//.test(path)) {
    throw new Error(`internalFetch: path must start with "/" (got: ${path.slice(0, 50)})`)
  }

  const base = getInternalBaseUrl()
  const url  = `${base}${path}`

  const headers: Record<string, string> = { ...(init.headers ?? {}) }
  if (init.cookie) headers.cookie = init.cookie

  return fetch(url, {
    method:  init.method ?? 'GET',
    headers,
    body:    init.body,
    signal:  init.signal,
    cache:   init.cache ?? 'no-store',
  })
}

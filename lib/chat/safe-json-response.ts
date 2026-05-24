/**
 * lib/chat/safe-json-response.ts — defensive `Response → JSON` parser.
 *
 * Why: the chat surfaces parse upstream responses with `await res.json()`.
 * When the upstream (Coolify proxy, Cloudflare Tunnel, Vercel runtime) hits
 * a timeout or 5xx fault and returns an HTML error page instead of the
 * route's JSON, Safari throws:
 *
 *   SyntaxError: The string did not match the expected pattern.
 *
 * (Chrome throws `Unexpected token < in JSON`, Firefox `JSON.parse error`.)
 *
 * The user sees a cryptic "Turn failed" banner with that error rather than
 * the actual upstream problem. This helper inspects Content-Type first;
 * if the body isn't JSON, it reads the text and returns a structured
 * `{ ok: false, error, status, snippet }` object so the caller can surface
 * a meaningful diagnostic.
 *
 * Symmetric with `app/api/cron/sweep-orphan-cards/route.ts:31` which
 * documents the same incident class on the server side.
 */

export interface SafeJsonOk<T>  { ok: true;  data: T;       status: number }
export interface SafeJsonFail   {
  ok:       false
  error:    string
  status:   number
  /** First ~300 chars of the body when it wasn't JSON — surfaces upstream HTML error pages so the operator can see what actually broke. */
  snippet?: string
}
export type SafeJsonResult<T> = SafeJsonOk<T> | SafeJsonFail

/**
 * Read a fetch Response and try to parse JSON. Returns a structured result
 * regardless of outcome — never throws. The caller can branch on `result.ok`
 * (same shape as our API conventions) and render `result.error` directly.
 *
 * Usage:
 *   const result = await safeJson<EnqueueResponse>(await fetch(url, opts))  // retry-storm-check: ignore — docstring example, callers add their own AbortSignal
 *   if (!result.ok) {
 *     setError(`${result.status}: ${result.error}${result.snippet ? '\n\n' + result.snippet : ''}`)
 *     return
 *   }
 *   // result.data is the typed payload
 */
export async function safeJson<T>(res: Response): Promise<SafeJsonResult<T>> {
  const status = res.status
  const contentType = res.headers.get('content-type') ?? ''
  const isJson = /\bapplication\/json\b/i.test(contentType)

  // Read body once. Some browsers won't let us read twice; we hold the
  // text and parse from it.
  let bodyText: string
  try {
    bodyText = await res.text()
  } catch (e) {
    return { ok: false, status, error: `failed to read response body: ${e instanceof Error ? e.message : 'unknown'}` }
  }

  // No body at all — proxies sometimes drop the body on timeouts.
  if (!bodyText) {
    return {
      ok:     false,
      status,
      error:  status >= 500
        ? `upstream returned empty ${status} body — likely a proxy timeout (Coolify / Cloudflare Tunnel / Vercel). Retry; if it persists, check service health.`
        : `empty ${status} response`,
    }
  }

  if (!isJson) {
    // The upstream returned non-JSON (HTML error page, plain text, etc.).
    // Surface the first ~300 chars so the operator can diagnose.
    const snippet = bodyText.slice(0, 300).trim()
    // Pull a useful title out of common HTML error pages if we can.
    const titleMatch = /<title[^>]*>\s*([^<]{1,120})\s*<\/title>/i.exec(bodyText)
    const errorHint  = titleMatch
      ? `upstream returned HTML (${status}): ${titleMatch[1].trim()}`
      : `upstream returned non-JSON (${status}; content-type='${contentType || 'unset'}')`
    return {
      ok:      false,
      status,
      error:   errorHint,
      snippet,
    }
  }

  // JSON Content-Type set, but the body could still be malformed.
  try {
    const data = JSON.parse(bodyText) as T
    return { ok: true, data, status }
  } catch (e) {
    return {
      ok:      false,
      status,
      error:   `JSON parse failed: ${e instanceof Error ? e.message : 'unknown'}`,
      snippet: bodyText.slice(0, 300).trim(),
    }
  }
}

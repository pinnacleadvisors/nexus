/**
 * fetch-with-timeout — drop-in `fetch` replacement with an AbortSignal-based
 * timeout and a hard cap on retries.
 *
 * Why this exists: outbound calls to paid services (Tavily, GitHub, Notion,
 * Firecrawl, Anthropic) can hang for minutes if the upstream stalls. A hung
 * fetch holds a Vercel function open until the platform-level 60s timeout
 * fires — and if the parent route is auto-retried (Inngest, n8n webhook
 * callback), each attempt repeats the cost.
 *
 * Default behaviour: one attempt, 15s timeout, no retry. Pass `retries: N`
 * to opt into retries — but only do so when (a) the upstream is idempotent
 * AND (b) the cost-per-call is negligible. For paid LLM / search APIs the
 * default of zero retries is correct; let the user-facing retry button drive
 * follow-up attempts.
 */

export interface FetchTimeoutOptions extends Omit<RequestInit, 'signal'> {
  /** Milliseconds before AbortController fires. Default 15000. */
  timeoutMs?: number
  /** Number of retry attempts AFTER the first try. Default 0 — explicit opt-in. */
  retries?: number
  /** Initial backoff in ms; doubles each attempt. Default 500. */
  retryBackoffMs?: number
  /** Predicate to decide if a non-OK response should be retried. Default: 5xx only. */
  shouldRetry?: (res: Response) => boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const DEFAULT_RETRY_PREDICATE = (res: Response) => res.status >= 500 && res.status < 600

export async function fetchWithTimeout(
  url: string | URL,
  init: FetchTimeoutOptions = {},
): Promise<Response> {
  const {
    timeoutMs       = 15_000,
    retries         = 0,
    retryBackoffMs  = 500,
    shouldRetry     = DEFAULT_RETRY_PREDICATE,
    ...rest
  } = init

  let lastErr: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...rest, signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok && shouldRetry(res) && attempt < retries) {
        await sleep(retryBackoffMs * 2 ** attempt)
        continue
      }
      return res
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      // AbortError on timeout is retryable; explicit caller abort is not.
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      if (isTimeout && attempt < retries) {
        await sleep(retryBackoffMs * 2 ** attempt)
        continue
      }
      throw err
    }
  }
  throw lastErr ?? new Error('fetch-with-timeout: exhausted retries')
}

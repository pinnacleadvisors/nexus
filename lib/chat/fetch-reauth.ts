/**
 * fetch wrapper that tolerates TRANSIENT 401s during a chat session.
 *
 * Why: Clerk session tokens are short-lived (~60s) and the browser SDK refreshes
 * them in the background. During a long Opus turn the chat client polls
 * /api/platform-chat/poll every ~2.5s for minutes. If a request fires in the
 * brief window where the old session cookie has just expired and the refreshed
 * one hasn't landed yet, proxy.ts redirects unauthenticated → the fetch sees a
 * 401. Previously a SINGLE such 401 hard-redirected the operator to /sign-in
 * mid-turn — the "randomly logged out while using platform copilot" bug.
 *
 * Retrying the same request after a short delay lets the SDK's refresh complete,
 * so only a PERSISTENT 401 (a real session loss / removed from ALLOWED_USER_IDS)
 * reaches the caller's redirect path.
 *
 * Safe for every chat fetch: GET poll/sessions/messages are idempotent, and the
 * enqueue/stream POSTs are rejected at the proxy (401) BEFORE the gateway is
 * touched, so a retry never double-dispatches a turn.
 */
export interface ReauthOpts {
  /** Number of extra attempts after the first 401 (default 2). */
  retries?: number
  /** Delay between attempts, ms (default 1500 — ~1 Clerk refresh cycle). */
  delayMs?: number
}

export async function fetchWithReauth(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: ReauthOpts = {},
): Promise<Response> {
  const retries = opts.retries ?? 2
  const delayMs = opts.delayMs ?? 1500
  // Per-attempt timeout so a hung request can't wedge the poll loop or amplify
  // under retry. A fresh AbortSignal.timeout per attempt (the sequence is
  // serial); a caller-provided signal always wins.
  let res = await fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) })
  for (let attempt = 0; res.status === 401 && attempt < retries; attempt++) {
    await new Promise(r => setTimeout(r, delayMs))
    res = await fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) })
  }
  return res
}

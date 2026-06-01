/**
 * Unit test for lib/chat/fetch-reauth.ts — the transient-401 retry that fixes
 * the "randomly logged out during platform-copilot chat" bug. A single 401 must
 * NOT propagate (Clerk is mid token-refresh); only a PERSISTENT 401 should.
 *
 * Run with: `npx --yes tsx __tests__/fetch-reauth.test.ts`
 */
import { fetchWithReauth } from '../lib/chat/fetch-reauth'

let failures = 0
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.error(`  ✗ FAIL: ${msg}`); failures++ }
}

const realFetch = global.fetch
function stubFetch(statuses: number[]): () => number {
  let calls = 0
  global.fetch = (async () => {
    const s = statuses[Math.min(calls, statuses.length - 1)]
    calls++
    return new Response('', { status: s })
  }) as typeof fetch
  return () => calls
}

async function main() {
  // Transient: 401, 401, then 200 → recovers, no propagated 401.
  {
    const calls = stubFetch([401, 401, 200])
    const res = await fetchWithReauth('http://x', undefined, { retries: 2, delayMs: 1 })
    assert(res.status === 200, 'transient 401s recover to 200 (no logout)')
    assert(calls() === 3, 'made 1 + 2 retries before succeeding')
  }

  // Persistent 401 → returns 401 after exhausting retries (real session loss).
  {
    const calls = stubFetch([401])
    const res = await fetchWithReauth('http://x', undefined, { retries: 2, delayMs: 1 })
    assert(res.status === 401, 'persistent 401 still returns 401 (redirect path)')
    assert(calls() === 3, 'persistent 401 made exactly 1 + 2 attempts')
  }

  // Success first try → no retries.
  {
    const calls = stubFetch([200])
    const res = await fetchWithReauth('http://x', undefined, { retries: 2, delayMs: 1 })
    assert(res.status === 200 && calls() === 1, '200 on first try → no retry')
  }

  // Non-401 error (500) → no retry (only 401 is the auth-refresh race).
  {
    const calls = stubFetch([500])
    const res = await fetchWithReauth('http://x', undefined, { retries: 2, delayMs: 1 })
    assert(res.status === 500 && calls() === 1, '500 is not retried (only 401)')
  }

  global.fetch = realFetch
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}
void main()

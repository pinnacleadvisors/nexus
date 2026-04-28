/**
 * Tiny health-probe with cached positive/negative results.
 *
 * The Claude Code gateway exposes GET /health → { ok, loggedIn, queueDepth }.
 * /api/chat and /api/claude-session/dispatch call isGatewayHealthy() before
 * routing traffic so a dead gateway fails fast over to the next priority
 * (OpenClaw, then Anthropic API key) without holding open a 55 s request and
 * surprising the user with a UI hang.
 *
 * Cache windows are short on purpose: 60 s when the gateway is up (avoid
 * hammering it on every chat), 10 s when it's down (recover quickly when the
 * user fixes the deploy).
 */

interface ProbeEntry {
  healthy:  boolean
  expires:  number
}

const cache = new Map<string, ProbeEntry>()
const POSITIVE_TTL_MS = 60_000
const NEGATIVE_TTL_MS = 10_000
const PROBE_TIMEOUT_MS = 1_500

export async function isGatewayHealthy(url: string): Promise<boolean> {
  if (!url) return false
  const now = Date.now()
  const hit = cache.get(url)
  if (hit && hit.expires > now) return hit.healthy

  const probeUrl = url.replace(/\/$/, '') + '/health'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  let healthy = false
  try {
    const res = await fetch(probeUrl, { method: 'GET', signal: controller.signal })
    healthy = res.ok
  } catch {
    healthy = false
  } finally {
    clearTimeout(timer)
  }

  cache.set(url, {
    healthy,
    expires: now + (healthy ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  })
  return healthy
}

/** Test-only: clear the cache. */
export function _resetHealthCache(): void {
  cache.clear()
}

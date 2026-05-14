/**
 * lib/claw/self-signed-fetch.ts — env-gated escape hatch for self-signed certs.
 *
 * Why this exists
 * ───────────────
 * Self-hosted gateways (Coolify on Hostinger) often run behind a real domain
 * + Cloudflare Tunnel, which gives them a valid cert automatically. But some
 * operators use the sslip.io / nip.io wildcard-DNS shortcut (e.g.
 * `k1thj2tszj9vnff6qbv6yhv0.72.62.70.188.sslip.io`) during early provisioning
 * — and Coolify's auto-generated cert for that hostname is self-signed.
 *
 * Node's `fetch` (undici) rejects self-signed certs by default. The result
 * is `fetch failed → unable to verify the first certificate / self-signed
 * certificate`. The proper long-term fix is to put the gateway behind a
 * real cert (Cloudflare Tunnel — see docs/runbooks/per-business-container-rollout.md).
 * Until then, this module provides an opt-in, hostname-allowlisted escape
 * hatch so dev work isn't blocked.
 *
 * Security model
 * ──────────────
 *   - DEFAULT: every cert validated (matches stock fetch behaviour).
 *   - When `GATEWAY_ALLOW_SELF_SIGNED_HOSTS` env is set: only hostnames
 *     matching one of the listed patterns get a self-signed-tolerant
 *     dispatcher. Everything else still goes through the strict default.
 *   - Patterns support a single leading `*.` wildcard:
 *       `*.sslip.io`   matches `xyz.sslip.io`, `abc.def.sslip.io`
 *       `127.0.0.1`    exact match (sub-domains not supported for IPs)
 *       `192.168.*`    NOT supported (literal `*` only as a sub-domain prefix)
 *   - Because the dispatcher is selected per-request, an attacker who
 *     points us at a different host (e.g. via a man-in-the-middle on DNS)
 *     would have to land us on a host in the allowlist to bypass cert
 *     checking — narrows the blast radius substantially.
 *
 * Recommended values
 * ──────────────────
 *   GATEWAY_ALLOW_SELF_SIGNED_HOSTS=*.sslip.io,*.nip.io,localhost,127.0.0.1
 *
 * Once a per-business gateway is moved behind Cloudflare Tunnel + a real
 * cert, drop the corresponding hostname from this list (or unset it
 * entirely) to re-tighten.
 */

import { Agent } from 'undici'

const ALLOW_ENV_KEY = 'GATEWAY_ALLOW_SELF_SIGNED_HOSTS'

/** Parsed allowlist, computed lazily on first call. Hot-restart of the env
 *  is the trigger for re-parsing (Vercel redeploys reload the module). */
let cachedPatterns: { kind: 'exact' | 'suffix'; value: string }[] | null = null

function loadPatterns(): { kind: 'exact' | 'suffix'; value: string }[] {
  if (cachedPatterns) return cachedPatterns
  const raw = process.env[ALLOW_ENV_KEY] ?? ''
  cachedPatterns = raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .map(p => p.startsWith('*.')
      ? { kind: 'suffix' as const, value: p.slice(2) }   // strip leading `*.`
      : { kind: 'exact'  as const, value: p },
    )
  return cachedPatterns
}

export function isSelfSignedAllowed(host: string): boolean {
  const h = host.toLowerCase()
  for (const p of loadPatterns()) {
    if (p.kind === 'exact'  && h === p.value)                                  return true
    if (p.kind === 'suffix' && (h === p.value || h.endsWith('.' + p.value)))  return true
  }
  return false
}

/** Lazily-created Agent that accepts self-signed certs. Reused across calls. */
let permissiveAgent: Agent | null = null

function getPermissiveAgent(): Agent {
  if (!permissiveAgent) {
    permissiveAgent = new Agent({ connect: { rejectUnauthorized: false } })
  }
  return permissiveAgent
}

/**
 * Drop-in replacement for `fetch` that uses a self-signed-tolerant
 * dispatcher when (and only when) the request URL's hostname matches the
 * `GATEWAY_ALLOW_SELF_SIGNED_HOSTS` env allowlist. Falls back to the stock
 * global `fetch` for every other request.
 *
 * Callers should pass the same args they'd pass to the platform fetch.
 * The return type matches global fetch.
 */
export async function fetchAllowSelfSigned(input: string, init?: RequestInit): Promise<Response> {
  let host = ''
  try { host = new URL(input).host } catch { /* fall through to stock fetch */ }
  if (host && isSelfSignedAllowed(host)) {
    // The undici Agent has `Dispatcher`-compatible types but the Node fetch
    // types in @types/node don't surface `dispatcher` — cast to keep TS quiet.
    return fetch(input, { ...init, dispatcher: getPermissiveAgent() } as RequestInit & { dispatcher: unknown }) as Promise<Response>
  }
  return fetch(input, init)
}

/** Re-export the env key so callers can hint at it in error messages. */
export const SELF_SIGNED_ALLOW_ENV = ALLOW_ENV_KEY

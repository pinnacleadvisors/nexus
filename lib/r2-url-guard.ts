/**
 * r2-url-guard — SSRF + size protection for remote-URL fetches in /api/r2.
 *
 * Blocks:
 *   - non-http(s) schemes (file:, gopher:, data:, etc.)
 *   - private IP space (RFC1918, loopback, link-local, IPv6 private)
 *   - cloud metadata endpoints (169.254.169.254)
 *   - redirects that resolve to the above
 *   - downloads larger than MAX_BYTES
 *
 * Use from route handlers:
 *   const guarded = await fetchGuarded(userUrl)
 *   if (!guarded.ok) return NextResponse.json({ error: guarded.error }, { status: 400 })
 *   const buffer = guarded.body
 */

import { lookup } from 'dns/promises'

const MAX_BYTES = 50 * 1024 * 1024 // 50 MB
const MAX_REDIRECTS = 3

// RFC1918 + loopback + link-local + carrier-grade NAT + IANA reserved
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return true
  const [a, b] = parts
  if (a === 10) return true                              // 10.0.0.0/8
  if (a === 127) return true                             // 127.0.0.0/8 loopback
  if (a === 172 && b >= 16 && b <= 31) return true       // 172.16.0.0/12
  if (a === 192 && b === 168) return true                // 192.168.0.0/16
  if (a === 169 && b === 254) return true                // 169.254.0.0/16 link-local / AWS metadata
  if (a === 100 && b >= 64 && b <= 127) return true      // 100.64.0.0/10 carrier NAT
  if (a === 0) return true                               // 0.0.0.0/8
  if (a >= 224) return true                              // multicast + reserved
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('fe80:')) return true // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // ULA
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped — re-check as v4
    const v4 = lower.slice(7)
    return isPrivateIPv4(v4)
  }
  return false
}

export interface GuardedUrl {
  ok: true
  host: string
}

export interface GuardFailure {
  ok: false
  error: string
}

export async function validateUrl(raw: string): Promise<GuardedUrl | GuardFailure> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: `Scheme ${url.protocol} not allowed` }
  }
  const host = url.hostname
  if (!host) return { ok: false, error: 'URL has no host' }

  // Fast-path: literal IP in URL
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateIPv4(host)) return { ok: false, error: `Private IP rejected: ${host}` }
    return { ok: true, host }
  }
  if (host.includes(':')) {
    if (isPrivateIPv6(host)) return { ok: false, error: `Private IPv6 rejected: ${host}` }
    return { ok: true, host }
  }

  // DNS-resolve and validate every A/AAAA record
  try {
    const records = await lookup(host, { all: true })
    for (const r of records) {
      if (r.family === 4 && isPrivateIPv4(r.address)) {
        return { ok: false, error: `Host ${host} resolves to private IP ${r.address}` }
      }
      if (r.family === 6 && isPrivateIPv6(r.address)) {
        return { ok: false, error: `Host ${host} resolves to private IPv6 ${r.address}` }
      }
    }
  } catch {
    return { ok: false, error: `Cannot resolve host ${host}` }
  }

  return { ok: true, host }
}

/**
 * Fetch `rawUrl` with SSRF + size guards. Follows up to MAX_REDIRECTS,
 * re-validating the target of each redirect.
 */
export async function fetchGuarded(
  rawUrl: string,
): Promise<
  | { ok: true; body: Buffer; contentType: string; finalUrl: string }
  | { ok: false; error: string; status?: number }
> {
  let current = rawUrl
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const validation = await validateUrl(current)
    if (!validation.ok) return { ok: false, error: validation.error, status: 400 }

    const res = await fetch(current, { redirect: 'manual' })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return { ok: false, error: 'Redirect without Location header', status: 502 }
      current = new URL(loc, current).toString()
      continue
    }

    if (!res.ok) {
      return { ok: false, error: `Upstream ${res.status}`, status: 502 }
    }

    // Size guard — check Content-Length header first
    const lenHeader = res.headers.get('content-length')
    if (lenHeader && parseInt(lenHeader, 10) > MAX_BYTES) {
      return { ok: false, error: `Asset exceeds ${MAX_BYTES} byte cap`, status: 413 }
    }

    // Stream with a running byte counter for chunked responses
    const reader = res.body?.getReader()
    if (!reader) {
      return { ok: false, error: 'Upstream returned no body', status: 502 }
    }
    const chunks: Uint8Array[] = []
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_BYTES) {
        await reader.cancel().catch(() => {})
        return { ok: false, error: `Asset exceeds ${MAX_BYTES} byte cap`, status: 413 }
      }
      chunks.push(value)
    }

    return {
      ok: true,
      body: Buffer.concat(chunks),
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      finalUrl: current,
    }
  }
  return { ok: false, error: `Exceeded ${MAX_REDIRECTS} redirects`, status: 508 }
}

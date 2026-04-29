/**
 * lib/memory/locator.ts
 *
 * Structured asset pointers for memory atoms. Every atom may carry a
 * `frontmatter.locators[]` array; this module resolves each entry to a
 * fetchable URL (and optionally bytes) for the kinds we support.
 *
 * Each resolver returns a uniform { url, content?, mediaType?, size? } shape.
 * If credentials for a given kind are missing, the resolver returns
 * { url, content: null, error: '...' } rather than throwing — callers can
 * decide whether to fall back to the next locator.
 */

export type Locator =
  | { kind: 'github'; repo: string; path: string; ref?: string; line?: number }
  | { kind: 'r2'; bucket: string; key: string; account_id?: string }
  | { kind: 's3'; bucket: string; key: string; region?: string }
  | { kind: 'url'; href: string }
  | { kind: 'youtube'; video_id: string }
  | { kind: 'vercel-blob'; url: string }
  | { kind: 'local'; path: string }

export interface ResolvedLocator {
  url: string
  content: Buffer | string | null
  mediaType?: string
  size?: number
  error?: string
}

/** Best-effort resolve. Never throws — surfaces failures via `error`. */
export async function resolveLocator(loc: Locator): Promise<ResolvedLocator> {
  switch (loc.kind) {
    case 'github':       return resolveGitHub(loc)
    case 'r2':           return resolveR2(loc)
    case 's3':           return resolveS3(loc)
    case 'url':          return resolveUrl(loc)
    case 'youtube':      return resolveYouTube(loc)
    case 'vercel-blob':  return resolveVercelBlob(loc)
    case 'local':        return resolveLocal(loc)
    default: {
      const exhaustive: never = loc
      return { url: '', content: null, error: `unknown locator kind: ${JSON.stringify(exhaustive)}` }
    }
  }
}

async function resolveGitHub(loc: Extract<Locator, { kind: 'github' }>): Promise<ResolvedLocator> {
  const ref = loc.ref || 'HEAD'
  const url = `https://github.com/${loc.repo}/blob/${ref}/${loc.path}${loc.line ? `#L${loc.line}` : ''}`
  const token = process.env.MEMORY_HQ_TOKEN || process.env.MEMORY_TOKEN
  if (!token) return { url, content: null, error: 'no GitHub token in env' }
  const apiUrl = `https://api.github.com/repos/${loc.repo}/contents/${encodeURIComponent(loc.path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(ref)}`
  const res = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw' },
  })
  if (!res.ok) return { url, content: null, error: `github ${res.status}` }
  const text = await res.text()
  return { url, content: text, mediaType: 'text/plain', size: text.length }
}

async function resolveR2(loc: Extract<Locator, { kind: 'r2' }>): Promise<ResolvedLocator> {
  const accountId = loc.account_id || process.env.R2_ACCOUNT_ID
  const accessKey = process.env.R2_ACCESS_KEY_ID
  const secret    = process.env.R2_SECRET_ACCESS_KEY
  const url = accountId
    ? `https://${loc.bucket}.${accountId}.r2.cloudflarestorage.com/${loc.key}`
    : `r2://${loc.bucket}/${loc.key}`
  if (!accessKey || !secret) return { url, content: null, error: 'R2 credentials not in env' }
  // Cloudflare R2 is S3-compatible. Defer signing to runtime — return URL only.
  // Callers needing bytes should use @aws-sdk/client-s3 directly with R2 endpoint.
  return { url, content: null, mediaType: 'application/octet-stream' }
}

async function resolveS3(loc: Extract<Locator, { kind: 's3' }>): Promise<ResolvedLocator> {
  const region = loc.region || process.env.AWS_REGION || 'us-east-1'
  const url = `https://${loc.bucket}.s3.${region}.amazonaws.com/${loc.key}`
  const accessKey = process.env.AWS_ACCESS_KEY_ID
  if (!accessKey) return { url, content: null, error: 'AWS credentials not in env' }
  return { url, content: null, mediaType: 'application/octet-stream' }
}

async function resolveUrl(loc: Extract<Locator, { kind: 'url' }>): Promise<ResolvedLocator> {
  try {
    const res = await fetch(loc.href, { method: 'HEAD' })
    if (!res.ok) return { url: loc.href, content: null, error: `HEAD ${res.status}` }
    return {
      url: loc.href,
      content: null,
      mediaType: res.headers.get('content-type') ?? undefined,
      size: Number(res.headers.get('content-length')) || undefined,
    }
  } catch (e) {
    return { url: loc.href, content: null, error: (e as Error).message }
  }
}

async function resolveYouTube(loc: Extract<Locator, { kind: 'youtube' }>): Promise<ResolvedLocator> {
  const watch = `https://www.youtube.com/watch?v=${loc.video_id}`
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) return { url: watch, content: null, mediaType: 'video/youtube' }
  // Optional: fetch metadata. Skipped on hot path; can be added when needed.
  return { url: watch, content: null, mediaType: 'video/youtube' }
}

async function resolveVercelBlob(loc: Extract<Locator, { kind: 'vercel-blob' }>): Promise<ResolvedLocator> {
  return resolveUrl({ kind: 'url', href: loc.url })
}

async function resolveLocal(loc: Extract<Locator, { kind: 'local' }>): Promise<ResolvedLocator> {
  if (process.env.VERCEL) {
    return { url: `file://${loc.path}`, content: null, error: 'local locator not usable on Vercel' }
  }
  try {
    const { readFile, stat } = await import('node:fs/promises')
    const s = await stat(loc.path)
    const content = await readFile(loc.path, 'utf8')
    return { url: `file://${loc.path}`, content, size: s.size }
  } catch (e) {
    return { url: `file://${loc.path}`, content: null, error: (e as Error).message }
  }
}

/** Convenience: resolve in priority order, return first successful. */
export async function resolveAny(locators: Locator[]): Promise<ResolvedLocator | null> {
  for (const loc of locators) {
    const out = await resolveLocator(loc)
    if (!out.error) return out
  }
  return null
}

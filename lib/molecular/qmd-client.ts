/**
 * lib/molecular/qmd-client.ts — E4
 *
 * Thin MCP-over-HTTP client for the QMD sidecar (docker/qmd/). Exposes a
 * single `qmdQuery(text, opts)` that returns ranked document hits.
 *
 * QMD's MCP server speaks JSON-RPC 2.0 at POST /mcp. We don't bother with the
 * full streamable-HTTP session handshake — `tools/call` works as a stateless
 * request as long as we send a stable `mcp-session-id` header.
 *
 * Configuration (Doppler):
 *   QMD_ENABLED=1            // hard switch — when unset, every call no-ops
 *   QMD_BASE_URL=https://qmd.<your-domain>
 *   QMD_BEARER_TOKEN=...     // Cloudflare Access service token (recommended)
 *
 * When QMD_ENABLED is unset or QMD_BASE_URL is missing, the client returns
 * `{ enabled: false, hits: [] }` so callers can fall back to graph search
 * without an exception.
 */

import { randomUUID } from 'node:crypto'

export interface QmdHit {
  /** Document path inside the indexed collection, e.g. `atoms/foo.md`. */
  path:    string
  /** QMD's hash docid, e.g. `#abc123`. */
  docid?:  string
  /** Hybrid relevance score (post-RRF, post-rerank). Higher is better. */
  score:   number
  /** Optional snippet — populated when `--explain` mode is requested. */
  snippet?: string
  /** Title from the document's first H1 or frontmatter. */
  title?:  string
}

export interface QmdQueryResult {
  enabled: boolean
  hits:    QmdHit[]
  /** Latency of the underlying HTTP call in ms. */
  latency?: number
  /** Set when the upstream returned non-2xx or threw. */
  error?:   string
}

export interface QmdQueryOpts {
  /** Number of hits to return (default 10, max 50). */
  k?:           number
  /** Minimum score threshold (passed to QMD). */
  minScore?:    number
  /** Restrict to a named collection (default: search all). */
  collection?:  string
  /** Hard timeout in ms (default 8000). */
  timeoutMs?:   number
}

const DEFAULT_TIMEOUT_MS = 8000
const SESSION_ID = randomUUID()

function isEnabled(): boolean {
  return process.env.QMD_ENABLED === '1' && Boolean(process.env.QMD_BASE_URL)
}

interface JsonRpcSuccess<T> { jsonrpc: '2.0'; id: string; result: T }
interface JsonRpcError      { jsonrpc: '2.0'; id: string; error: { code: number; message: string } }
type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcError

interface ToolsCallResult {
  content?: Array<{
    type: 'text' | 'json'
    text?: string
    json?: unknown
  }>
  isError?: boolean
}

async function callTool<T = unknown>(
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const baseUrl = process.env.QMD_BASE_URL!
  const url = new URL('/mcp', baseUrl).toString()
  const body = {
    jsonrpc: '2.0',
    id:      randomUUID(),
    method:  'tools/call',
    params:  { name, arguments: args },
  }
  const headers: Record<string, string> = {
    'content-type':   'application/json',
    accept:           'application/json',
    'mcp-session-id': SESSION_ID,
  }
  if (process.env.QMD_BEARER_TOKEN) {
    headers.authorization = `Bearer ${process.env.QMD_BEARER_TOKEN}`
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body:   JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`qmd ${res.status}: ${await res.text().catch(() => '')}`.trim())
    const json = (await res.json()) as JsonRpcResponse<ToolsCallResult>
    if ('error' in json) throw new Error(`qmd rpc error ${json.error.code}: ${json.error.message}`)
    const result = json.result
    if (result.isError) throw new Error('qmd tool returned isError')
    // Decode result.content: prefer JSON content, fall back to parsing text.
    if (result.content) {
      for (const c of result.content) {
        if (c.type === 'json' && c.json !== undefined) return c.json as T
        if (c.type === 'text' && typeof c.text === 'string') {
          try { return JSON.parse(c.text) as T } catch { /* try next */ }
        }
      }
    }
    return result as unknown as T
  } finally {
    clearTimeout(timer)
  }
}

export async function qmdQuery(text: string, opts: QmdQueryOpts = {}): Promise<QmdQueryResult> {
  if (!isEnabled()) return { enabled: false, hits: [] }
  if (!text.trim()) return { enabled: true, hits: [] }
  const k = Math.max(1, Math.min(opts.k ?? 10, 50))
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const args: Record<string, unknown> = { q: text, n: k }
  if (opts.minScore !== undefined) args.min_score = opts.minScore
  if (opts.collection)              args.collection = opts.collection
  const start = Date.now()
  try {
    const raw = await callTool<unknown>('query', args, timeoutMs)
    const hits = normaliseHits(raw)
    return { enabled: true, hits, latency: Date.now() - start }
  } catch (e) {
    return {
      enabled: true,
      hits:    [],
      error:   e instanceof Error ? e.message : 'unknown',
      latency: Date.now() - start,
    }
  }
}

/** Best-effort liveness check. Useful for /api/health style endpoints. */
export async function qmdStatus(timeoutMs = 3000): Promise<{ enabled: boolean; ok: boolean; latency?: number; error?: string }> {
  if (!isEnabled()) return { enabled: false, ok: false }
  const start = Date.now()
  try {
    const url = new URL('/health', process.env.QMD_BASE_URL!).toString()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    return { enabled: true, ok: res.ok, latency: Date.now() - start }
  } catch (e) {
    return {
      enabled: true,
      ok:      false,
      latency: Date.now() - start,
      error:   e instanceof Error ? e.message : 'unknown',
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function normaliseHits(raw: unknown): QmdHit[] {
  // QMD's `query` tool may return either an array of hits or an object
  // with { results: [...] }. We accept both.
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : (raw as { results?: unknown[] })?.results ?? []
  const out: QmdHit[] = []
  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const h = r as Record<string, unknown>
    const path = pickString(h, ['path', 'file', 'doc_path', 'document_path'])
    if (!path) continue
    const score = Number(h.score ?? h.relevance ?? h.confidence ?? 0)
    out.push({
      path,
      docid:   pickString(h, ['docid', 'id']),
      title:   pickString(h, ['title']),
      snippet: pickString(h, ['snippet', 'preview', 'excerpt']),
      score:   Number.isFinite(score) ? score : 0,
    })
  }
  return out
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

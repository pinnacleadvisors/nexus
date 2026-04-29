/**
 * POST /api/memory/event — universal write surface for the memory-hq graph.
 *
 * Auth:    Bearer MEMORY_HQ_TOKEN (matches the Doppler-injected token).
 *          NOT Clerk — this endpoint is for non-browser writers (OpenClaw,
 *          n8n, managed agents, external webhooks).
 *
 * Rate:    100 writes/min per source (override via MEMORY_EVENT_RATE_PER_MIN).
 *
 * Body:    {
 *            type:     "atom" | "entity" | "moc" | "source" | "synthesis",
 *            source:   string,                    // e.g. "claude-agent:nexus-architect"
 *            scope:    { repo?, business_slug?, namespace? },
 *            payload:  { title, fact?, body?, links?, sources?, kind?, importance? },
 *            locators: Locator[]?,
 *            trace_id: string?,
 *          }
 *
 * Returns: { ok, slug, scopeId, path, html_url, sha, action }
 */

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { canonicalScope, pathFor, type MemoryScope } from '@/lib/memory/scope'
import type { Locator } from '@/lib/memory/locator'
import { writePage, todayPath } from '@/lib/memory/github'

export const runtime = 'nodejs'

const KIND_TO_DIR: Record<string, 'atoms' | 'entities' | 'mocs' | 'sources' | 'synthesis'> = {
  atom: 'atoms',
  entity: 'entities',
  moc: 'mocs',
  source: 'sources',
  synthesis: 'synthesis',
}

interface EventBody {
  type: keyof typeof KIND_TO_DIR
  source: string
  scope: MemoryScope
  payload: {
    title: string
    fact?: string
    body?: string
    links?: string[]
    sources?: string[]
    kind?: string
    importance?: 'critical' | 'high' | 'normal' | 'low'
  }
  locators?: Locator[]
  trace_id?: string
}

function bearerOk(req: NextRequest): boolean {
  const expected = process.env.MEMORY_HQ_TOKEN
  if (!expected) return false
  const auth = req.headers.get('authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return false
  return auth.slice(7).trim() === expected
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function renderNote(fm: Record<string, unknown>, body: string): string {
  const yaml = ['---']
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v) && v.length === 0) continue
    yaml.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  }
  yaml.push('---', '')
  if (body) yaml.push(body, '')
  return yaml.join('\n')
}

function validate(body: unknown): { ok: true; v: EventBody } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be JSON object' }
  const b = body as Record<string, unknown>
  if (typeof b.type !== 'string' || !KIND_TO_DIR[b.type as keyof typeof KIND_TO_DIR]) {
    return { ok: false, error: `type must be one of: ${Object.keys(KIND_TO_DIR).join(', ')}` }
  }
  if (typeof b.source !== 'string' || !b.source.trim()) {
    return { ok: false, error: 'source is required (e.g. "claude-agent:foo")' }
  }
  if (!b.scope || typeof b.scope !== 'object') {
    return { ok: false, error: 'scope is required: { repo?, business_slug?, namespace? }' }
  }
  if (!b.payload || typeof b.payload !== 'object') {
    return { ok: false, error: 'payload is required' }
  }
  const p = b.payload as Record<string, unknown>
  if (typeof p.title !== 'string' || !p.title.trim()) {
    return { ok: false, error: 'payload.title is required' }
  }
  return { ok: true, v: b as unknown as EventBody }
}

export async function POST(req: NextRequest) {
  if (!bearerOk(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const v = validate(body)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  // Per-source rate limit. The source string identifies the writer.
  const limit = Number(process.env.MEMORY_EVENT_RATE_PER_MIN) || 100
  const rl = await rateLimit(req, {
    limit,
    window: '1 m',
    prefix: 'memory:event',
    identifier: v.v.source,
  })
  if (!rl.success) return rateLimitResponse(rl)

  // Canonicalise scope; rejects when neither repo nor business_slug is set.
  let canon
  try {
    canon = canonicalScope(v.v.scope)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const slug = slugify(v.v.payload.title)
  const dir = KIND_TO_DIR[v.v.type]
  const filePath = pathFor(dir, canon, slug)
  const trace_id = v.v.trace_id || crypto.randomUUID()
  const author = v.v.source

  const fm: Record<string, unknown> = {
    type: v.v.type,
    title: v.v.payload.title,
    slug,
    scope: canon,
    author,
    trace_id,
    importance: v.v.payload.importance || 'normal',
    kind: v.v.payload.kind || 'fact',
    locators: v.v.locators || [],
    created: todayPath(),
    sources: v.v.payload.sources || [],
    links: v.v.payload.links || [],
  }
  const fact = v.v.payload.fact || v.v.payload.body || ''
  const noteBody = renderNote(fm, fact)

  // writePage handles SHA-based optimistic concurrency.
  // It points at MEMORY_REPO; we override via MEMORY_HQ_REPO for this endpoint.
  const oldRepo = process.env.MEMORY_REPO
  const oldToken = process.env.MEMORY_TOKEN
  process.env.MEMORY_REPO = process.env.MEMORY_HQ_REPO || 'pinnacleadvisors/memory-hq'
  process.env.MEMORY_TOKEN = process.env.MEMORY_HQ_TOKEN || ''
  try {
    const result = await writePage(filePath, noteBody, `feat(memory): ${v.v.type} ${slug} from ${author}`)
    if (!result) {
      return NextResponse.json({ error: 'github write failed (see server logs)' }, { status: 502 })
    }
    return NextResponse.json({
      ok: true,
      slug,
      scopeId: canon.id,
      path: filePath,
      html_url: result.url,
      sha: result.sha,
      trace_id,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  } finally {
    if (oldRepo === undefined) delete process.env.MEMORY_REPO
    else process.env.MEMORY_REPO = oldRepo
    if (oldToken === undefined) delete process.env.MEMORY_TOKEN
    else process.env.MEMORY_TOKEN = oldToken
  }
}

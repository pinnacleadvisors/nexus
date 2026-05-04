/**
 * GET  /api/memory?path=<path>  — read a page (cache-first, 5-min TTL)
 * POST /api/memory              — write or append a page to GitHub memory repo
 *
 * Body (POST):
 *   { path: string; content: string; message?: string; mode?: 'write' | 'append' }
 *
 * All routes require Clerk authentication.
 * Reads are served from the Supabase memory_cache table first (5-min TTL).
 * Writes go directly to GitHub and invalidate the cache entry.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { readPage, writePage, appendToPage, isMemoryConfigured } from '@/lib/memory/github'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

// ── Cache helpers ─────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// memory_cache is defined in migration 031 but lib/database.types.ts may not
// include it yet (the types file is regenerated manually). Same escape-hatch
// pattern used by lib/business/db.ts and lib/memory/supabase-reader.ts.
interface MemoryCacheRow { path: string; content: string; sha: string; cached_at: string }
type LooseMemoryCache = {
  select: (cols: string) => LooseMemoryCache
  eq:     (k: string, v: unknown) => LooseMemoryCache
  single: () => Promise<{ data: MemoryCacheRow | null }>
  upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ error: { message: string } | null }>
  delete: () => LooseMemoryCache
  then:   <T>(onfulfilled: (v: { error: { message: string } | null }) => T) => Promise<T>
}
function memoryCache(db: ReturnType<typeof createServerClient>): LooseMemoryCache {
  return (db as unknown as { from: (t: string) => LooseMemoryCache }).from('memory_cache')
}

async function getCached(path: string): Promise<{ content: string; sha: string } | null> {
  try {
    const db = createServerClient()
    if (!db) return null
    const { data } = await memoryCache(db)
      .select('content, sha, cached_at')
      .eq('path', path)
      .single()
    if (!data) return null
    const age = Date.now() - new Date(data.cached_at).getTime()
    if (age > CACHE_TTL_MS) return null
    return { content: data.content, sha: data.sha }
  } catch {
    return null
  }
}

async function setCache(path: string, content: string, sha: string): Promise<void> {
  try {
    const db = createServerClient()
    if (!db) return
    await memoryCache(db).upsert(
      { path, content, sha, cached_at: new Date().toISOString() },
      { onConflict: 'path' },
    )
  } catch { /* non-fatal */ }
}

async function invalidateCache(path: string): Promise<void> {
  try {
    const db = createServerClient()
    if (!db) return
    await memoryCache(db).delete().eq('path', path)
  } catch { /* non-fatal */ }
}

// ── GET /api/memory?path= ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isMemoryConfigured()) {
    return NextResponse.json(
      { error: 'Memory engine not configured. Set MEMORY_TOKEN and MEMORY_REPO in Doppler.' },
      { status: 503 },
    )
  }

  const path = req.nextUrl.searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path parameter required' }, { status: 400 })

  // Cache-first read
  const cached = await getCached(path)
  if (cached) {
    return NextResponse.json({ ...cached, path, cached: true })
  }

  // Fetch from GitHub
  const page = await readPage(path)
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Populate cache (fire-and-forget)
  setCache(path, page.content, page.sha).catch(() => {})

  return NextResponse.json({ path: page.path, content: page.content, sha: page.sha, url: page.url, cached: false })
}

// ── POST /api/memory ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isMemoryConfigured()) {
    return NextResponse.json(
      { error: 'Memory engine not configured. Set MEMORY_TOKEN and MEMORY_REPO in Doppler.' },
      { status: 503 },
    )
  }

  const body = await req.json() as { path?: string; content?: string; message?: string; mode?: string }
  const { path, content, message, mode } = body

  if (!path || !content) {
    return NextResponse.json({ error: 'path and content are required' }, { status: 400 })
  }

  const result = mode === 'append'
    ? await appendToPage(path, content, message)
    : await writePage(path, content, message)
  if (!result) return NextResponse.json({ error: 'GitHub write failed' }, { status: 502 })

  // Invalidate cache so next read fetches fresh
  await invalidateCache(path)

  return NextResponse.json({ path, sha: result.sha, url: result.url })
}

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

async function getCached(path: string): Promise<{ content: string; sha: string } | null> {
  try {
    const db = createServerClient()
    if (!db) return null
    const { data } = await db
      .from('memory_cache')
      .select('content, sha, cached_at')
      .eq('path', path)
      .single()
    if (!data) return null
    const age = Date.now() - new Date(data.cached_at as string).getTime()
    if (age > CACHE_TTL_MS) return null
    return { content: data.content as string, sha: data.sha as string }
  } catch {
    return null
  }
}

async function setCache(path: string, content: string, sha: string): Promise<void> {
  try {
    const db = createServerClient()
    if (!db) return
    await db.from('memory_cache').upsert(
      { path, content, sha, cached_at: new Date().toISOString() },
      { onConflict: 'path' },
    )
  } catch { /* non-fatal */ }
}

async function invalidateCache(path: string): Promise<void> {
  try {
    const db = createServerClient()
    if (!db) return
    await db.from('memory_cache').delete().eq('path', path)
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

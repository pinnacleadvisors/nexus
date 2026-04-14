/**
 * app/api/library/route.ts
 * GET  /api/library?type=code&q=supabase&tags=auth,typescript&limit=20&offset=0
 * POST /api/library   { type, ...payload }
 */

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { listEntries, createEntry } from '@/lib/library/client'
import type { LibraryType } from '@/lib/library/types'

const VALID_TYPES: LibraryType[] = ['code', 'agent', 'prompt', 'skill']

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type   = (searchParams.get('type') ?? 'code') as LibraryType
  const q      = searchParams.get('q') ?? ''
  const tags   = searchParams.get('tags')?.split(',').filter(Boolean) ?? []
  const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '20', 10), 100)
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0',  10), 0)

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 })
  }

  const results = await listEntries(type, userId, { q, tags, limit, offset })
  return NextResponse.json({ results, type, q, tags, limit, offset })
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const type = body.type as LibraryType
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 })
  }

  // Strip 'type' from the payload before inserting
  const { type: _t, ...payload } = body

  try {
    const entry = await createEntry(type, userId, payload as Parameters<typeof createEntry>[2])
    return NextResponse.json({ entry }, { status: 201 })
  } catch (err) {
    console.error('[library/route] create error:', err)
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 })
  }
}

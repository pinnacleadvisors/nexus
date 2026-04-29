/**
 * GET /api/memory/query — read API for the memory-hq mirror.
 *
 * Auth: same MEMORY_HQ_TOKEN bearer as POST /api/memory/event so internal
 * + MCP clients use one credential.
 *
 * Query params:
 *   kind     atoms|entities|mocs|sources|synthesis (default atoms)
 *   scope    JSON-encoded { repo?, business_slug?, namespace? }
 *   q        full-text query (atoms only)
 *   author   filter by frontmatter.author
 *   limit    1..100 (default 25)
 *   important only return importance in {critical, high}
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  searchAtoms,
  listByScope,
  byAuthor,
  recentImportant,
  isSupabaseMirrorConfigured,
  type MolKind,
} from '@/lib/memory/supabase-reader'
import type { MemoryScope } from '@/lib/memory/scope'

export const runtime = 'nodejs'

function bearerOk(req: NextRequest): boolean {
  const expected = process.env.MEMORY_HQ_TOKEN
  if (!expected) return false
  const auth = req.headers.get('authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return false
  return auth.slice(7).trim() === expected
}

function parseScope(s: string | null): MemoryScope | undefined {
  if (!s) return undefined
  try {
    const parsed = JSON.parse(s) as MemoryScope
    if (!parsed.repo && !parsed.business_slug) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export async function GET(req: NextRequest) {
  if (!bearerOk(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSupabaseMirrorConfigured()) {
    return NextResponse.json({ error: 'supabase mirror not configured' }, { status: 503 })
  }

  const sp = req.nextUrl.searchParams
  const kindRaw = (sp.get('kind') || 'atoms') as MolKind
  const kinds: MolKind[] = ['atoms', 'entities', 'mocs', 'sources', 'synthesis']
  if (!kinds.includes(kindRaw)) {
    return NextResponse.json({ error: `kind must be one of ${kinds.join(', ')}` }, { status: 400 })
  }
  const scope = parseScope(sp.get('scope'))
  const q = sp.get('q')
  const author = sp.get('author')
  const limit = Math.min(Math.max(parseInt(sp.get('limit') || '25', 10) || 25, 1), 100)
  const important = sp.get('important') === '1'

  try {
    if (q && kindRaw === 'atoms') {
      const rows = await searchAtoms(q, { scope, author: author || undefined, limit })
      return NextResponse.json({ ok: true, mode: 'fts', rows })
    }
    if (important) {
      const rows = await recentImportant({ scope, limit })
      return NextResponse.json({ ok: true, mode: 'important', rows })
    }
    if (author) {
      const rows = await byAuthor(author, { kind: kindRaw, limit })
      return NextResponse.json({ ok: true, mode: 'author', rows })
    }
    if (scope) {
      const rows = await listByScope(kindRaw, scope, limit)
      return NextResponse.json({ ok: true, mode: 'scope', rows })
    }
    return NextResponse.json({ error: 'one of: q, author, important=1, scope is required' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

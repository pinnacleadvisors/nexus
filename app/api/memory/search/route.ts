/**
 * GET /api/memory/search?q=<query>[&limit=10]
 *
 * Search the GitHub memory repo using GitHub code search.
 * Results are cached in Supabase for 5 minutes to stay within GitHub rate limits.
 * Used by agents before each run to inject relevant prior context.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { searchPages, isMemoryConfigured } from '@/lib/memory/github'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isMemoryConfigured()) {
    // Graceful degradation — return empty results so agents still run
    return NextResponse.json({ results: [], configured: false })
  }

  const q     = req.nextUrl.searchParams.get('q') ?? ''
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '10'), 30)

  if (!q.trim()) return NextResponse.json({ results: [], configured: true })

  const results = await searchPages(q, limit)
  return NextResponse.json({ results, configured: true })
}

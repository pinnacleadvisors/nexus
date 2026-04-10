/**
 * GET /api/notion/search?q=<query>&pageId=<id>&limit=<n>
 *
 * Searches Notion pages for RAG context injection.
 * If pageId is provided, returns the text content of that specific page.
 * Otherwise, searches all accessible pages for the query.
 */
import { NextRequest, NextResponse } from 'next/server'
import { searchPages, getPageContent, resolveNotionToken } from '@/lib/notion'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = resolveNotionToken(req.cookies.get('oauth_token_notion')?.value)
  if (!token) return NextResponse.json({ configured: false, results: [], content: '' })

  const { searchParams } = req.nextUrl
  const query  = searchParams.get('q')   ?? ''
  const pageId = searchParams.get('pageId')
  const limit  = parseInt(searchParams.get('limit') ?? '5')

  // Direct page content fetch (for RAG)
  if (pageId) {
    const content = await getPageContent(token, pageId)
    return NextResponse.json({ configured: true, content })
  }

  // Search
  if (!query) return NextResponse.json({ configured: true, results: [] })
  const results = await searchPages(token, query, limit)
  return NextResponse.json({ configured: true, results })
}

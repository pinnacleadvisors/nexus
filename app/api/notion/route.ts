/**
 * GET  /api/notion         — list recent pages in the Notion workspace
 * POST /api/notion         — create a new page under a parent page
 * POST /api/notion?action=database — create a knowledge-base database
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  listPages,
  createPage,
  createKnowledgeDatabase,
  resolveNotionToken,
} from '@/lib/notion'

export const runtime = 'nodejs'

function getToken(req: NextRequest): string | null {
  return resolveNotionToken(req.cookies.get('oauth_token_notion')?.value)
}

export async function GET(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Notion not connected', pages: [] }, { status: 401 })

  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '30')
  const pages = await listPages(token, limit)
  return NextResponse.json({ pages })
}

export async function POST(req: NextRequest) {
  const token = getToken(req)
  if (!token) return NextResponse.json({ error: 'Notion not connected' }, { status: 401 })

  const action = req.nextUrl.searchParams.get('action')
  const body   = await req.json() as Record<string, unknown>

  if (action === 'database') {
    // Create knowledge-base database
    const result = await createKnowledgeDatabase(
      token,
      String(body.parentPageId ?? ''),
      String(body.title ?? 'Nexus Knowledge Base'),
    )
    if (!result) return NextResponse.json({ error: 'Failed to create database' }, { status: 502 })
    return NextResponse.json(result)
  }

  // Default: create a page
  const { parentPageId, title, content } = body as {
    parentPageId: string
    title:        string
    content?:     Array<{ type: string; text?: string; emoji?: string }>
  }

  if (!parentPageId || !title) {
    return NextResponse.json({ error: 'parentPageId and title are required' }, { status: 400 })
  }

  const result = await createPage(token, {
    parentPageId,
    title,
    content: content as Parameters<typeof createPage>[1]['content'],
  })

  if (!result) return NextResponse.json({ error: 'Notion page creation failed' }, { status: 502 })
  return NextResponse.json(result)
}

/**
 * POST /api/notion/append
 *
 * Appends blocks to an existing Notion page.
 * Used by:
 *  - Board approval flow (milestone completion → append to project KB)
 *  - Agent webhook (research note → append to shared doc)
 *
 * Body: { pageId: string, blocks: NotionBlock[], heading?: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { appendBlocks, resolveNotionToken, type NotionBlock } from '@/lib/notion'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const token = resolveNotionToken(req.cookies.get('oauth_token_notion')?.value)
  if (!token) return NextResponse.json({ error: 'Notion not connected' }, { status: 401 })

  const body = await req.json() as {
    pageId:   string
    blocks?:  NotionBlock[]
    heading?: string
    text?:    string
  }

  if (!body.pageId) {
    return NextResponse.json({ error: 'pageId is required' }, { status: 400 })
  }

  const blocks: NotionBlock[] = []

  // Optional section heading
  if (body.heading) {
    blocks.push({ type: 'divider' })
    blocks.push({ type: 'heading_2', text: body.heading })
  }

  // Free-text shortcut
  if (body.text) {
    blocks.push({ type: 'paragraph', text: body.text })
  }

  // Explicit blocks
  if (body.blocks?.length) {
    blocks.push(...body.blocks)
  }

  if (!blocks.length) {
    return NextResponse.json({ error: 'No content to append' }, { status: 400 })
  }

  const ok = await appendBlocks(token, body.pageId, blocks)
  if (!ok) return NextResponse.json({ error: 'Notion append failed' }, { status: 502 })
  return NextResponse.json({ ok: true })
}

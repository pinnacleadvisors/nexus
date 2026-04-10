/**
 * Notion API client helpers.
 * All functions accept a token explicitly so they work from any server context.
 * Notion API version: 2022-06-28
 */

const NOTION_VERSION = '2022-06-28'
const BASE = 'https://api.notion.com/v1'

function headers(token: string) {
  return {
    Authorization:    `Bearer ${token}`,
    'Content-Type':   'application/json',
    'Notion-Version': NOTION_VERSION,
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface NotionPage {
  id:        string
  title:     string
  url:       string
  createdAt: string
  editedAt:  string
}

export interface NotionDatabase {
  id:        string
  title:     string
  url:       string
  createdAt: string
}

export type NotionBlockType =
  | 'paragraph'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'bulleted_list_item'
  | 'numbered_list_item'
  | 'divider'
  | 'callout'
  | 'code'
  | 'bookmark'

export interface NotionBlock {
  type:    NotionBlockType
  text?:   string
  emoji?:  string  // callout icon
  lang?:   string  // code block language
  url?:    string  // bookmark
  caption?: string // bookmark caption
}

// ── Page / database helpers ───────────────────────────────────────────────────
function extractTitle(result: Record<string, unknown>): string {
  const props = (result.properties ?? {}) as Record<string, unknown>
  for (const val of Object.values(props)) {
    const v = val as Record<string, unknown>
    if (Array.isArray(v.title)) {
      const t = (v.title as Array<{ plain_text?: string }>)[0]
      if (t?.plain_text) return t.plain_text
    }
  }
  // Fallback: top-level title (databases)
  if (Array.isArray((result as Record<string, unknown>).title)) {
    const arr = (result as Record<string, Array<{ plain_text?: string }>>).title
    return arr[0]?.plain_text ?? 'Untitled'
  }
  return 'Untitled'
}

function resultToPage(r: Record<string, unknown>): NotionPage {
  return {
    id:        String(r.id ?? ''),
    title:     extractTitle(r),
    url:       String(r.url ?? ''),
    createdAt: String(r.created_time ?? ''),
    editedAt:  String(r.last_edited_time ?? ''),
  }
}

// ── Block serialisation ───────────────────────────────────────────────────────
export function blockToNotion(block: NotionBlock): Record<string, unknown> {
  const richText = block.text
    ? [{ type: 'text', text: { content: block.text.slice(0, 2000) } }]
    : []

  switch (block.type) {
    case 'heading_1':
      return { type: 'heading_1', heading_1: { rich_text: richText } }
    case 'heading_2':
      return { type: 'heading_2', heading_2: { rich_text: richText } }
    case 'heading_3':
      return { type: 'heading_3', heading_3: { rich_text: richText } }
    case 'bulleted_list_item':
      return { type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText } }
    case 'numbered_list_item':
      return { type: 'numbered_list_item', numbered_list_item: { rich_text: richText } }
    case 'divider':
      return { type: 'divider', divider: {} }
    case 'callout':
      return {
        type: 'callout',
        callout: {
          rich_text: richText,
          icon: { type: 'emoji', emoji: block.emoji ?? '💡' },
        },
      }
    case 'code':
      return {
        type: 'code',
        code: { rich_text: richText, language: block.lang ?? 'plain text' },
      }
    case 'bookmark':
      return {
        type: 'bookmark',
        bookmark: {
          url: block.url ?? '',
          caption: block.caption ? [{ type: 'text', text: { content: block.caption } }] : [],
        },
      }
    default: // paragraph
      return { type: 'paragraph', paragraph: { rich_text: richText } }
  }
}

function blocksToText(blocks: Array<Record<string, unknown>>): string {
  const lines: string[] = []
  for (const block of blocks) {
    const type  = String(block.type ?? '')
    const inner = block[type] as { rich_text?: Array<{ plain_text: string }>; url?: string } | undefined
    if (type === 'bookmark') {
      if (inner?.url) lines.push(`[Link] ${inner.url}`)
    } else {
      const text = inner?.rich_text?.map(r => r.plain_text).join('') ?? ''
      if (text) lines.push(text)
    }
  }
  return lines.join('\n')
}

// ── API calls ─────────────────────────────────────────────────────────────────

/** List recent pages accessible to the integration */
export async function listPages(token: string, limit = 20): Promise<NotionPage[]> {
  try {
    const res = await fetch(`${BASE}/search`, {
      method:  'POST',
      headers: headers(token),
      body: JSON.stringify({
        filter: { property: 'object', value: 'page' },
        sort:   { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: Math.min(limit, 100),
      }),
    })
    if (!res.ok) return []
    const data = await res.json() as { results?: Record<string, unknown>[] }
    return (data.results ?? []).map(resultToPage)
  } catch { return [] }
}

/** Search pages by query text */
export async function searchPages(token: string, query: string, limit = 5): Promise<NotionPage[]> {
  try {
    const res = await fetch(`${BASE}/search`, {
      method:  'POST',
      headers: headers(token),
      body: JSON.stringify({
        query,
        filter: { property: 'object', value: 'page' },
        sort:   { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: limit,
      }),
    })
    if (!res.ok) return []
    const data = await res.json() as { results?: Record<string, unknown>[] }
    return (data.results ?? []).map(resultToPage)
  } catch { return [] }
}

/** Get all text content from a page (for RAG injection) */
export async function getPageContent(token: string, pageId: string): Promise<string> {
  try {
    const res = await fetch(`${BASE}/blocks/${pageId.replace(/-/g, '')}/children?page_size=100`, {
      headers: headers(token),
    })
    if (!res.ok) return ''
    const data = await res.json() as { results?: Record<string, unknown>[] }
    return blocksToText(data.results ?? [])
  } catch { return '' }
}

/** Create a new page under a parent page */
export async function createPage(
  token: string,
  opts: {
    parentPageId:  string
    title:         string
    content?:      NotionBlock[]
  },
): Promise<{ id: string; url: string } | null> {
  try {
    const res = await fetch(`${BASE}/pages`, {
      method:  'POST',
      headers: headers(token),
      body: JSON.stringify({
        parent:     { type: 'page_id', page_id: opts.parentPageId },
        properties: {
          title: { title: [{ type: 'text', text: { content: opts.title } }] },
        },
        children: (opts.content ?? []).map(blockToNotion),
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { id: string; url: string }
    return { id: data.id, url: data.url }
  } catch { return null }
}

/** Create a page inside a database */
export async function createDatabaseEntry(
  token: string,
  opts: {
    databaseId:  string
    title:       string
    properties?: Record<string, unknown>
    content?:    NotionBlock[]
  },
): Promise<{ id: string; url: string } | null> {
  try {
    const res = await fetch(`${BASE}/pages`, {
      method:  'POST',
      headers: headers(token),
      body: JSON.stringify({
        parent:     { type: 'database_id', database_id: opts.databaseId },
        properties: {
          Name: { title: [{ type: 'text', text: { content: opts.title } }] },
          ...(opts.properties ?? {}),
        },
        children: (opts.content ?? []).map(blockToNotion),
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { id: string; url: string }
    return { id: data.id, url: data.url }
  } catch { return null }
}

/** Append blocks to an existing page */
export async function appendBlocks(
  token: string,
  pageId: string,
  blocks: NotionBlock[],
): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/blocks/${pageId}/children`, {
      method:  'PATCH',
      headers: headers(token),
      body: JSON.stringify({ children: blocks.map(blockToNotion) }),
    })
    return res.ok
  } catch { return false }
}

/** Create a knowledge base database under a root page */
export async function createKnowledgeDatabase(
  token: string,
  parentPageId: string,
  title: string,
): Promise<{ id: string; url: string } | null> {
  try {
    const res = await fetch(`${BASE}/databases`, {
      method:  'POST',
      headers: headers(token),
      body: JSON.stringify({
        parent: { type: 'page_id', page_id: parentPageId },
        title:  [{ type: 'text', text: { content: title } }],
        properties: {
          Name:      { title: {} },
          Project:   { rich_text: {} },
          Type:      { select: { options: [
            { name: 'Research',   color: 'blue'   },
            { name: 'Milestone',  color: 'green'  },
            { name: 'Note',       color: 'yellow' },
            { name: 'Asset',      color: 'purple' },
          ]}},
          Phase:     { number: {} },
          Status:    { select: { options: [
            { name: 'Draft',     color: 'gray'  },
            { name: 'Complete',  color: 'green' },
          ]}},
          Date:      { date: {} },
        },
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { id: string; url: string }
    return { id: data.id, url: data.url }
  } catch { return null }
}

/** Resolve a token from env (NOTION_API_KEY) or an optional cookie value */
export function resolveNotionToken(cookieValue?: string): string | null {
  return process.env.NOTION_API_KEY ?? cookieValue ?? null
}

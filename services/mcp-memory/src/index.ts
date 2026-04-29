/**
 * @nexus/mcp-memory — MCP server for the memory-hq graph.
 *
 * Tools exposed to any Claude Code session:
 *   memory_atom      — write an atomic fact
 *   memory_entity    — write a person/company/concept
 *   memory_moc       — write/update a Map of Content
 *   memory_query     — slug + frontmatter filter (Supabase-backed)
 *   memory_search    — full-text search (Supabase-backed)
 *
 * Writes always go through /api/memory/event so provenance, scope, and
 * locator validation stay centralised. Reads prefer the Supabase mirror
 * (no rate limits) but fall back to GitHub if SUPABASE_URL is unset.
 *
 * Run from any machine:
 *   NEXUS_BASE_URL=https://nexus.example.com \
 *   MEMORY_HQ_TOKEN=ghp_... \
 *   node dist/index.js
 *
 * Register with Claude Code (per-user) by adding to ~/.claude/settings.json:
 *   "mcpServers": { "memory-hq": { "command": "node", "args": ["/path/to/dist/index.js"] } }
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const NEXUS_BASE_URL = process.env.NEXUS_BASE_URL || ''
const MEMORY_HQ_TOKEN = process.env.MEMORY_HQ_TOKEN || ''

if (!NEXUS_BASE_URL) {
  console.error('NEXUS_BASE_URL is required (e.g. https://nexus.example.com)')
  process.exit(2)
}
if (!MEMORY_HQ_TOKEN) {
  console.error('MEMORY_HQ_TOKEN is required')
  process.exit(2)
}

const ScopeSchema = z.object({
  repo: z.string().optional(),
  business_slug: z.string().optional(),
  namespace: z.string().optional(),
}).refine((s) => s.repo || s.business_slug, { message: 'scope must include repo or business_slug' })

const LocatorSchema = z.union([
  z.object({ kind: z.literal('url'), href: z.string().url() }),
  z.object({ kind: z.literal('youtube'), video_id: z.string() }),
  z.object({ kind: z.literal('github'), repo: z.string(), path: z.string(), ref: z.string().optional(), line: z.number().optional() }),
  z.object({ kind: z.literal('r2'), bucket: z.string(), key: z.string(), account_id: z.string().optional() }),
  z.object({ kind: z.literal('s3'), bucket: z.string(), key: z.string(), region: z.string().optional() }),
  z.object({ kind: z.literal('vercel-blob'), url: z.string().url() }),
  z.object({ kind: z.literal('local'), path: z.string() }),
])

const WriteEvent = z.object({
  type: z.enum(['atom', 'entity', 'moc', 'source', 'synthesis']),
  source: z.string(),
  scope: ScopeSchema,
  payload: z.object({
    title: z.string(),
    fact: z.string().optional(),
    body: z.string().optional(),
    links: z.array(z.string()).optional(),
    sources: z.array(z.string()).optional(),
    kind: z.string().optional(),
    importance: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  }),
  locators: z.array(LocatorSchema).optional(),
  trace_id: z.string().optional(),
})

async function postEvent(input: z.infer<typeof WriteEvent>) {
  const res = await fetch(`${NEXUS_BASE_URL.replace(/\/$/, '')}/api/memory/event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MEMORY_HQ_TOKEN}`,
    },
    body: JSON.stringify(input),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`memory event ${res.status}: ${JSON.stringify(json)}`)
  return json
}

async function getMemoryQuery(args: { kind?: string; scope?: unknown; q?: string; author?: string; limit?: number }) {
  const params = new URLSearchParams()
  if (args.kind) params.set('kind', args.kind)
  if (args.scope) params.set('scope', JSON.stringify(args.scope))
  if (args.q) params.set('q', args.q)
  if (args.author) params.set('author', args.author)
  if (args.limit) params.set('limit', String(args.limit))
  const res = await fetch(`${NEXUS_BASE_URL.replace(/\/$/, '')}/api/memory/query?${params}`, {
    headers: { Authorization: `Bearer ${MEMORY_HQ_TOKEN}` },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`memory query ${res.status}: ${JSON.stringify(json)}`)
  return json
}

const TOOLS = [
  {
    name: 'memory_atom',
    description: 'Write an atomic fact (one fact per atom) to memory-hq. Stamps provenance via the source field.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Writer identity, e.g. "claude-agent:nexus-architect"' },
        scope: { type: 'object', properties: { repo: { type: 'string' }, business_slug: { type: 'string' }, namespace: { type: 'string' } } },
        title: { type: 'string' },
        fact: { type: 'string' },
        importance: { type: 'string', enum: ['critical', 'high', 'normal', 'low'] },
        links: { type: 'array', items: { type: 'string' } },
        locators: { type: 'array' },
      },
      required: ['source', 'scope', 'title', 'fact'],
    },
  },
  {
    name: 'memory_entity',
    description: 'Write a person/company/concept entity to memory-hq.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        scope: { type: 'object' },
        entity_kind: { type: 'string', description: 'e.g. "person", "company", "concept"' },
        name: { type: 'string' },
        description: { type: 'string' },
        locators: { type: 'array' },
      },
      required: ['source', 'scope', 'entity_kind', 'name'],
    },
  },
  {
    name: 'memory_moc',
    description: 'Write/update a Map of Content (topic hub) in memory-hq.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' }, scope: { type: 'object' }, title: { type: 'string' }, body: { type: 'string' },
      },
      required: ['source', 'scope', 'title'],
    },
  },
  {
    name: 'memory_query',
    description: 'Slug + frontmatter filter against the Supabase mirror.',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string' }, scope: { type: 'object' }, author: { type: 'string' }, limit: { type: 'number' } },
    },
  },
  {
    name: 'memory_search',
    description: 'Full-text search across atoms in memory-hq.',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' }, scope: { type: 'object' }, limit: { type: 'number' } },
      required: ['q'],
    },
  },
] as const

const server = new Server(
  { name: 'memory-hq', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS as unknown as object[] }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params
  try {
    if (name === 'memory_atom') {
      const a = args as Record<string, unknown>
      const result = await postEvent({
        type: 'atom',
        source: String(a.source),
        scope: a.scope as z.infer<typeof ScopeSchema>,
        payload: { title: String(a.title), fact: String(a.fact), importance: a.importance as never, links: a.links as string[] },
        locators: a.locators as z.infer<typeof LocatorSchema>[] | undefined,
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
    if (name === 'memory_entity') {
      const a = args as Record<string, unknown>
      const result = await postEvent({
        type: 'entity',
        source: String(a.source),
        scope: a.scope as z.infer<typeof ScopeSchema>,
        payload: { title: String(a.name), body: a.description as string, kind: String(a.entity_kind) },
        locators: a.locators as z.infer<typeof LocatorSchema>[] | undefined,
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
    if (name === 'memory_moc') {
      const a = args as Record<string, unknown>
      const result = await postEvent({
        type: 'moc',
        source: String(a.source),
        scope: a.scope as z.infer<typeof ScopeSchema>,
        payload: { title: String(a.title), body: a.body as string },
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
    if (name === 'memory_query' || name === 'memory_search') {
      const result = await getMemoryQuery(args as Record<string, unknown>)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
    throw new Error(`unknown tool: ${name}`)
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: (e as Error).message }] }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)

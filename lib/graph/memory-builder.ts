/**
 * lib/graph/memory-builder.ts
 *
 * Builds a GraphData payload from the repo's `memory/` folder:
 *   - Every .md file becomes a node.
 *   - Molecular files (atom/entity/moc) are typed from their frontmatter.
 *   - Platform / roadmap / other plain docs become `memory_doc` nodes.
 *   - Edges come from [[wikilinks]], markdown file links, and the
 *     `links:` / `sources:` entries in YAML frontmatter.
 *
 * Runs server-side (Node runtime). Does not touch Supabase.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { GraphData, GraphNode, GraphEdge, NodeType, EdgeRelation } from './types'
import { runForceLayout, assignClusters, assignPageRank } from './builder'

// ── Filesystem walk ───────────────────────────────────────────────────────────

async function walkMarkdown(root: string): Promise<string[]> {
  const out: string[] = []
  async function recurse(dir: string) {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) continue
        await recurse(full)
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(full)
      }
    }
  }
  await recurse(root)
  return out.sort()
}

// ── Minimal YAML frontmatter parser ───────────────────────────────────────────
// Supports: scalar key: value, quoted strings, and string lists prefixed with `- `.
// Enough for the shape used in memory/molecular/**.

interface Frontmatter {
  type?:    string
  title?:   string
  id?:      string
  subtype?: string
  created?: string
  sources?: string[]
  links?:   string[]
  [key: string]: unknown
}

function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  if (!raw.startsWith('---')) return { meta: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { meta: {}, body: raw }
  const header = raw.slice(3, end).replace(/^\n/, '')
  const body   = raw.slice(end + 4).replace(/^\n/, '')

  const meta: Frontmatter = {}
  const lines = header.split('\n')
  let currentListKey: string | null = null

  for (const line of lines) {
    if (/^\s*$/.test(line)) { currentListKey = null; continue }

    // List item belonging to a previous key
    const listMatch = line.match(/^\s*-\s+(.*)$/)
    if (listMatch && currentListKey) {
      const val = unquote(listMatch[1].trim())
      const arr = (meta[currentListKey] as string[] | undefined) ?? []
      arr.push(val)
      meta[currentListKey] = arr
      continue
    }

    // New key
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) { currentListKey = null; continue }
    const [, key, rawVal] = kv
    const val = rawVal.trim()
    if (val === '') {
      currentListKey = key
      meta[key] = []
    } else {
      currentListKey = null
      meta[key] = unquote(val)
    }
  }
  return { meta, body }
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function toNodeType(meta: Frontmatter, relPath: string): NodeType {
  const t = (meta.type ?? '').toLowerCase()
  if (t === 'atom')   return 'memory_atom'
  if (t === 'entity') return 'memory_entity'
  if (t === 'moc')    return 'memory_moc'
  // Heuristic: files under molecular/<kind>/ inherit the kind when frontmatter is missing
  if (/\/molecular\/atoms\//.test(relPath))    return 'memory_atom'
  if (/\/molecular\/entities\//.test(relPath)) return 'memory_entity'
  if (/\/molecular\/mocs\//.test(relPath))     return 'memory_moc'
  return 'memory_doc'
}

function firstH1(body: string): string | null {
  const m = body.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : null
}

function randomPosition() {
  return {
    x: (Math.random() - 0.5) * 120,
    y: (Math.random() - 0.5) * 120,
    z: (Math.random() - 0.5) * 120,
  }
}

// ── Link extraction ───────────────────────────────────────────────────────────

// [[slug]] or [[slug|Label]] or [[path/to/slug|Label]]
const WIKILINK_RE = /\[\[([^\]|\n]+?)(?:\|[^\]\n]*)?\]\]/g

// [text](path.md) or [text](./path.md) or [text](../path.md)
// Skips http(s):, file:, and mailto: targets.
const MDLINK_RE   = /\[[^\]]*\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g

// Backtick-quoted path ending in .md — e.g. INDEX.md lists `platform/STACK.md`
// in a table without a markdown link. Catches these as implicit references.
const BACKTICK_PATH_RE = /`([^`\n]+\.md)`/g

function extractWikilinks(body: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = WIKILINK_RE.exec(body)) !== null) out.push(m[1].trim())
  return out
}

function extractMdFileLinks(body: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = MDLINK_RE.exec(body)) !== null) {
    const target = m[1].trim()
    if (/^(https?|mailto|file):/i.test(target)) continue
    out.push(target)
  }
  return out
}

function extractBacktickPaths(body: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = BACKTICK_PATH_RE.exec(body)) !== null) {
    const target = m[1].trim()
    if (target.includes(' ')) continue
    out.push(target)
  }
  return out
}

// ── Main builder ──────────────────────────────────────────────────────────────

interface MemoryFile {
  absPath: string
  relPath: string         // relative to memory/ root, POSIX-style
  meta:    Frontmatter
  body:    string
}

/**
 * Pull molecular content (atoms / entities / mocs / sources / synthesis) from
 * the memory-hq Supabase mirror and shape it as MemoryFile records that the
 * graph builder can consume the same way it consumes filesystem reads.
 *
 * Why mirror, not GitHub: the mirror is local Supabase + already indexed by
 * scope/slug, so 1000+ atoms is one query. GitHub contents API would be N
 * requests and burns the 5K/hr rate limit. The mirror is updated by a webhook
 * on every push to memory-hq (see /api/memory/event), so it lags by seconds.
 *
 * Returns [] if the mirror isn't configured (offline dev, missing env).
 */
async function loadMemoryHqMolecular(): Promise<MemoryFile[]> {
  // Lazy import — keeps the cold-start cheap when the graph runs without
  // memory-hq (e.g. local dev with no Supabase). Same lazy-import pattern
  // used elsewhere in the repo (see lib/observability.ts).
  let listByScope: typeof import('@/lib/memory/supabase-reader').listByScope
  let isSupabaseMirrorConfigured: typeof import('@/lib/memory/supabase-reader').isSupabaseMirrorConfigured
  try {
    const mod = await import('@/lib/memory/supabase-reader')
    listByScope = mod.listByScope
    isSupabaseMirrorConfigured = mod.isSupabaseMirrorConfigured
  } catch {
    return []
  }
  if (!isSupabaseMirrorConfigured()) return []

  const KINDS = ['atoms', 'entities', 'mocs', 'sources', 'synthesis'] as const
  const SCOPE = { repo: 'pinnacleadvisors/nexus' as const }
  const out: MemoryFile[] = []

  for (const kind of KINDS) {
    let rows: Awaited<ReturnType<typeof listByScope>>
    try {
      rows = await listByScope(kind, SCOPE, 500)
    } catch (err) {
      console.error(`[memory-builder] memory-hq mirror read failed for ${kind}:`, err)
      continue
    }
    for (const r of rows) {
      // Map the molecular kind onto the same relPath shape the local walker
      // produced ("molecular/<kind>/<slug>.md"), so existing alias-resolution
      // logic and toNodeType() heuristic light up unchanged.
      const relPath = `molecular/${kind}/${r.slug}.md`
      const fmTitle = (r.frontmatter as Record<string, unknown> | null)?.title
      const fmId    = (r.frontmatter as Record<string, unknown> | null)?.id
      const links   = (r.frontmatter as Record<string, unknown> | null)?.links
      const sources = (r.frontmatter as Record<string, unknown> | null)?.sources
      const meta: Frontmatter = {
        type:    kind === 'atoms' ? 'atom' : kind === 'entities' ? 'entity' : kind === 'mocs' ? 'moc' : kind,
        title:   typeof fmTitle === 'string' ? fmTitle : r.title,
        id:      typeof fmId === 'string' ? fmId : r.slug,
        created: r.updated_at,
        ...(Array.isArray(links)   ? { links:   links   as string[] } : {}),
        ...(Array.isArray(sources) ? { sources: sources as string[] } : {}),
      }
      out.push({
        absPath: `memory-hq:${r.scope_id}/${kind}/${r.slug}.md`,
        relPath,
        meta,
        body: r.body_md ?? '',
      })
    }
  }
  return out
}

export async function buildMemoryGraph(): Promise<GraphData | null> {
  const root = path.join(process.cwd(), 'memory')
  const files = await walkMarkdown(root)

  // Pull molecular content from memory-hq when the mirror is configured. The
  // local memory/molecular/ folder is treated as a development cache only —
  // memory-hq is canonical (see CLAUDE.md "Memory architecture").
  const memoryHqFiles = await loadMemoryHqMolecular()
  const useMemoryHq   = memoryHqFiles.length > 0

  if (files.length === 0 && memoryHqFiles.length === 0) return null

  const localParsed: MemoryFile[] = await Promise.all(
    files.map(async absPath => {
      const raw = await fs.readFile(absPath, 'utf8')
      const { meta, body } = parseFrontmatter(raw)
      const relPath = path.relative(root, absPath).split(path.sep).join('/')
      return { absPath, relPath, meta, body }
    }),
  )

  // When memory-hq is the source of truth, drop the local molecular files so
  // we don't end up with duplicated nodes pointing at stale dev-cache copies.
  const nonMolecularLocal = useMemoryHq
    ? localParsed.filter(f => !f.relPath.startsWith('molecular/'))
    : localParsed
  const parsed: MemoryFile[] = [...nonMolecularLocal, ...memoryHqFiles]

  // Build nodes + alias map for link resolution.
  const nodes: GraphNode[] = []
  const idByAlias = new Map<string, string>()

  for (const f of parsed) {
    const canonicalId = f.meta.id ? `mem-${f.meta.id}` : `mem-${f.relPath}`
    const type  = toNodeType(f.meta, f.relPath)
    const label = (f.meta.title as string | undefined)
      ?? firstH1(f.body)
      ?? path.basename(f.relPath, '.md')

    nodes.push({
      id:        canonicalId,
      type,
      label,
      metadata: {
        path:    f.relPath,
        ...(f.meta.id      ? { slug:    f.meta.id }      : {}),
        ...(f.meta.subtype ? { subtype: f.meta.subtype } : {}),
        ...(f.meta.created ? { created: f.meta.created } : {}),
      },
      position3d:  randomPosition(),
      clusterId:   0,
      pageRank:    0,
      connections: 0,
      createdAt:   (f.meta.created as string | undefined)
        ?? new Date().toISOString(),
    })

    // Register every alias form we might see in a wikilink / md link.
    const aliases = new Set<string>([
      f.relPath,                              // molecular/atoms/foo.md
      f.relPath.replace(/\.md$/, ''),         // molecular/atoms/foo
      path.basename(f.relPath),               // foo.md
      path.basename(f.relPath, '.md'),        // foo
    ])
    if (f.meta.id) aliases.add(f.meta.id as string)
    // Partial-path forms: "atoms/foo", "entities/agent-generator-agent", etc.
    const segments = f.relPath.replace(/\.md$/, '').split('/')
    for (let i = 1; i < segments.length; i++) {
      aliases.add(segments.slice(i).join('/'))
    }
    for (const alias of aliases) {
      if (!idByAlias.has(alias)) idByAlias.set(alias, canonicalId)
    }
  }

  // Build edges from wikilinks, frontmatter links, and markdown file links.
  const edges: GraphEdge[] = []
  const seenEdge = new Set<string>()

  function addEdge(src: string, dst: string, relation: EdgeRelation, weight: number) {
    if (src === dst) return
    const key = `${src}→${dst}:${relation}`
    if (seenEdge.has(key)) return
    seenEdge.add(key)
    edges.push({
      id: uid(),
      source: src,
      target: dst,
      relation,
      weight,
      createdAt: new Date().toISOString(),
    })
  }

  function resolveAlias(raw: string): string | null {
    const clean = raw.replace(/^\.?\/?/, '').replace(/\.md$/, '').replace(/#.*$/, '').trim()
    if (!clean) return null
    if (idByAlias.has(clean))           return idByAlias.get(clean)!
    if (idByAlias.has(`${clean}.md`))   return idByAlias.get(`${clean}.md`)!
    return null
  }

  for (const f of parsed) {
    const sourceId = f.meta.id ? `mem-${f.meta.id}` : `mem-${f.relPath}`

    // Frontmatter `links:` → wikilink-style targets
    for (const rawLink of (f.meta.links as string[] | undefined) ?? []) {
      const inner = rawLink.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim()
      const targetId = resolveAlias(inner)
      if (targetId) addEdge(sourceId, targetId, 'links_to', 0.85)
    }

    // Frontmatter `sources:` → only create edges if the source points at another
    // memory file. External file:// sources become metadata, not nodes.
    for (const src of (f.meta.sources as string[] | undefined) ?? []) {
      const stripped = src.replace(/^file:\/\//, '')
      const targetId = resolveAlias(stripped)
      if (targetId) addEdge(sourceId, targetId, 'references', 0.5)
    }

    // Body [[wikilinks]]
    for (const raw of extractWikilinks(f.body)) {
      const targetId = resolveAlias(raw.split('|')[0])
      if (targetId) addEdge(sourceId, targetId, 'links_to', 0.7)
    }

    // Body markdown file links (e.g. ./STACK.md, ../roadmap/SUMMARY.md)
    for (const raw of extractMdFileLinks(f.body)) {
      const base = path.posix.dirname(f.relPath)
      const joined = raw.startsWith('/')
        ? raw.replace(/^\//, '')
        : path.posix.normalize(path.posix.join(base, raw))
      const targetId = resolveAlias(joined)
      if (targetId) addEdge(sourceId, targetId, 'links_to', 0.6)
    }

    // Backtick paths (`platform/STACK.md`) — common in our INDEX / GRAPH docs
    for (const raw of extractBacktickPaths(f.body)) {
      const targetId = resolveAlias(raw)
      if (targetId) addEdge(sourceId, targetId, 'links_to', 0.45)
    }
  }

  // Degree count
  const degMap = new Map<string, number>()
  for (const e of edges) {
    degMap.set(e.source, (degMap.get(e.source) ?? 0) + 1)
    degMap.set(e.target, (degMap.get(e.target) ?? 0) + 1)
  }
  for (const n of nodes) n.connections = degMap.get(n.id) ?? 0

  runForceLayout(nodes, edges, 100)
  assignClusters(nodes, edges)
  assignPageRank(nodes, edges)

  return {
    nodes,
    edges,
    builtAt:   new Date().toISOString(),
    nodeCount: nodes.length,
    edgeCount: edges.length,
  }
}

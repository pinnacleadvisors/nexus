/**
 * POST /api/cron/sync-memory — Step 5
 *
 * Webhook receiver for the memory-hq push event. Diffs the changed paths
 * and upserts/deletes the corresponding rows in the mol_* mirror tables.
 * GitHub is the source of truth; this is a derived read cache.
 *
 * Auth: GitHub HMAC sha256 signature using GITHUB_WEBHOOK_SECRET.
 *       Configure the webhook in pinnacleadvisors/memory-hq -> Settings ->
 *       Webhooks. URL: <NEXUS_BASE_URL>/api/cron/sync-memory.
 *       Content-type: application/json. Events: "Just the push event".
 *
 * Also exposed via GET ?reconcile=1 (owner-only) for full re-sync from
 * the GitHub tree — fixes drift if a webhook delivery dropped.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { createHmac, timingSafeEqual } from 'node:crypto'

export const runtime = 'nodejs'
export const maxDuration = 300

const BASE = 'https://api.github.com'

function repo(): string {
  return process.env.MEMORY_HQ_REPO || 'pinnacleadvisors/memory-hq'
}

function token(): string {
  const t = process.env.MEMORY_HQ_TOKEN
  if (!t) throw new Error('MEMORY_HQ_TOKEN not set')
  return t
}

function ghHeaders() {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'memory-hq-sync/1.0',
  }
}

function verifySignature(secret: string, signature: string | null, body: string): boolean {
  if (!signature?.startsWith('sha256=')) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

const KIND_TO_TABLE: Record<string, string> = {
  atoms: 'mol_atoms',
  entities: 'mol_entities',
  mocs: 'mol_mocs',
  sources: 'mol_sources',
  synthesis: 'mol_synthesis',
}

interface ParsedNote {
  frontmatter: Record<string, unknown>
  body: string
}

function parseFrontmatter(content: string): ParsedNote {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { frontmatter: {}, body: content }
  const fm: Record<string, unknown> = {}
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const k = line.slice(0, idx).trim()
    const v = line.slice(idx + 1).trim()
    if (!k) continue
    if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
      try { fm[k] = JSON.parse(v); continue } catch { /* fall through */ }
    }
    if (v.startsWith('"') && v.endsWith('"')) {
      try { fm[k] = JSON.parse(v); continue } catch { /* fall through */ }
    }
    fm[k] = v
  }
  return { frontmatter: fm, body: m[2] }
}

async function getFile(path: string): Promise<{ content: string; sha: string } | null> {
  const res = await fetch(`${BASE}/repos/${repo()}/contents/${encodeURI(path)}`, { headers: ghHeaders() })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`get ${path} ${res.status}`)
  const json = await res.json() as { content: string; sha: string }
  return { content: Buffer.from(json.content, 'base64').toString('utf8'), sha: json.sha }
}

interface ChangedPath { path: string; removed: boolean }
interface PathStats { upserted: number; deleted: number; skipped: number; unchanged: number }

type Sb = ReturnType<typeof createServerClient>

async function processOne(
  sb: NonNullable<Sb>,
  { path, removed }: ChangedPath,
  existingShas?: Map<string, string>,
  treeSha?: string,
): Promise<'upserted' | 'deleted' | 'skipped' | 'unchanged'> {
  const parts = path.split('/')
  if (parts.length < 3 || !parts[2].endsWith('.md')) return 'skipped'
  const kind = parts[0]
  const table = KIND_TO_TABLE[kind]
  if (!table) return 'skipped'
  const scope_id = parts[1]
  const slug = parts[2].replace(/\.md$/, '')
  if (removed) {
    await sb.from(table as never).delete().eq('scope_id', scope_id).eq('slug', slug)
    return 'deleted'
  }
  // Fast path: tree-supplied SHA matches the mirror's stored SHA → skip the file fetch.
  if (treeSha && existingShas?.get(path) === treeSha) return 'unchanged'
  const f = await getFile(path)
  if (!f) return 'skipped'
  const { frontmatter, body } = parseFrontmatter(f.content)
  const title = (frontmatter.title as string) || slug
  const row: Record<string, unknown> = {
    slug, scope_id, title, body_md: body, frontmatter, sha: f.sha, path,
  }
  if (kind === 'entities') row.entity_kind = (frontmatter.kind as string) || null
  await sb.from(table as never).upsert(row as never, { onConflict: 'scope_id,slug' })
  return 'upserted'
}

async function applyPaths(paths: ChangedPath[]): Promise<PathStats> {
  const sb = createServerClient()
  if (!sb) throw new Error('Supabase not configured')
  const stats: PathStats = { upserted: 0, deleted: 0, skipped: 0, unchanged: 0 }
  // Webhook path: usually 1–5 paths per push, no need to batch.
  for (const cp of paths) {
    const r = await processOne(sb, cp)
    stats[r] += 1
  }
  return stats
}

async function loadExistingShas(sb: NonNullable<Sb>): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  await Promise.all(
    Object.entries(KIND_TO_TABLE).map(async ([, table]) => {
      // No filter on scope/slug — paged fetch in case any table is large.
      let from = 0
      const pageSize = 1000
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await sb
          .from(table as never)
          .select('path, sha')
          .range(from, from + pageSize - 1)
        if (error) throw error
        const rows = (data || []) as Array<{ path: string; sha: string }>
        for (const r of rows) if (r.path && r.sha) map.set(r.path, r.sha)
        if (rows.length < pageSize) break
        from += pageSize
      }
    }),
  )
  return map
}

async function reconcileTree(scopePrefix?: string): Promise<PathStats & { total: number; fetched: number }> {
  const sb = createServerClient()
  if (!sb) throw new Error('Supabase not configured')
  const treeRes = await fetch(`${BASE}/repos/${repo()}/git/trees/main?recursive=1`, { headers: ghHeaders() })
  if (!treeRes.ok) throw new Error(`tree ${treeRes.status}`)
  const tree = (await treeRes.json()) as { tree: { path: string; type: string; sha: string }[] }
  const filter = (p: string) =>
    /\.md$/.test(p) &&
    /^(atoms|entities|mocs|sources|synthesis)\//.test(p) &&
    (!scopePrefix || p.split('/')[1] === scopePrefix)
  const blobs = (tree.tree || []).filter((t) => t.type === 'blob' && filter(t.path))
  const existingShas = await loadExistingShas(sb)
  const stats: PathStats = { upserted: 0, deleted: 0, skipped: 0, unchanged: 0 }
  const BATCH = 10
  let fetched = 0
  for (let i = 0; i < blobs.length; i += BATCH) {
    const slice = blobs.slice(i, i + BATCH)
    const results = await Promise.all(
      slice.map((b) => processOne(sb, { path: b.path, removed: false }, existingShas, b.sha)),
    )
    for (const r of results) {
      stats[r] += 1
      if (r === 'upserted') fetched += 1
    }
  }
  return { ...stats, total: blobs.length, fetched }
}

export async function POST(req: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  const sig = req.headers.get('x-hub-signature-256')
  const raw = await req.text()
  if (!secret || !verifySignature(secret, sig, raw)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }
  let payload: { commits?: { added: string[]; modified: string[]; removed: string[] }[] }
  try { payload = JSON.parse(raw) } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }
  const seen = new Map<string, ChangedPath>()
  for (const c of payload.commits || []) {
    for (const p of [...(c.added || []), ...(c.modified || [])]) seen.set(p, { path: p, removed: false })
    for (const p of (c.removed || [])) seen.set(p, { path: p, removed: true })
  }
  try {
    const stats = await applyPaths(Array.from(seen.values()))
    return NextResponse.json({ ok: true, ...stats })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('reconcile') !== '1') {
    return NextResponse.json({ error: 'reconcile=1 required' }, { status: 400 })
  }
  // Two auth paths: Vercel cron sends Authorization: Bearer <CRON_SECRET>;
  // owner Clerk session (manual reconcile) is also accepted.
  const cronSecret = process.env.CRON_SECRET
  const provided = req.headers.get('authorization') || ''
  const fromCron = cronSecret && provided === `Bearer ${cronSecret}`
  if (!fromCron) {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const allowed = (process.env.ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (allowed.length && !allowed.includes(userId)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Walk full tree, skip paths whose tree-SHA already matches the mirror,
  // and process the rest in parallel batches. Optional ?scope=<id> narrows
  // to one scope (e.g. ?scope=55bedf46-nexus) when full reconcile is too big.
  const scopePrefix = req.nextUrl.searchParams.get('scope') || undefined
  try {
    const stats = await reconcileTree(scopePrefix)
    return NextResponse.json({ ok: true, mode: 'reconcile', scopePrefix: scopePrefix || null, ...stats })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

/**
 * POST /api/cron/rebuild-graph-hq — Step 4
 *
 * Walks the memory-hq tree, regenerates INDEX.md, and folds yesterday's
 * log/<iso>-<op>-<slug>.md files into a single digest/<YYYY-MM-DD>.md.
 *
 * Why server-cron-only: Step 4 makes generated files (INDEX.md, digest)
 * cron-owned so concurrent client writes never conflict on them.
 *
 * Auth: bearer token (CRON_SECRET) or owner Clerk session.
 * Schedule: every 6h (vercel.json crons).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { recordSamples } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 60

const BASE = 'https://api.github.com'

function repo(): string {
  return process.env.MEMORY_HQ_REPO || 'pinnacleadvisors/memory-hq'
}

function token(): string {
  const t = process.env.MEMORY_HQ_TOKEN
  if (!t) throw new Error('MEMORY_HQ_TOKEN is not set')
  return t
}

function ghHeaders() {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'memory-hq-cron/1.0',
  }
}

interface TreeEntry { path: string; type: 'blob' | 'tree'; sha: string }

async function getTree(): Promise<TreeEntry[]> {
  const res = await fetch(`${BASE}/repos/${repo()}/git/trees/main?recursive=1`, {
    headers: ghHeaders(),
  })
  if (!res.ok) throw new Error(`tree ${res.status}`)
  const json = await res.json() as { tree: TreeEntry[] }
  return json.tree || []
}

async function getFile(path: string): Promise<{ content: string; sha: string } | null> {
  const res = await fetch(`${BASE}/repos/${repo()}/contents/${encodeURI(path)}`, { headers: ghHeaders() })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`get ${path} ${res.status}`)
  const json = await res.json() as { content: string; sha: string }
  return { content: Buffer.from(json.content, 'base64').toString('utf8'), sha: json.sha }
}

async function putFile(path: string, content: string, sha: string | undefined, message: string) {
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
  }
  if (sha) body.sha = sha
  const res = await fetch(`${BASE}/repos/${repo()}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    headers: ghHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`put ${path} ${res.status}: ${await res.text()}`)
}

interface IndexCounts {
  atoms: number
  entities: number
  mocs: number
  sources: number
  synthesis: number
  scopes: Set<string>
  authors: Map<string, number>
}

function emptyCounts(): IndexCounts {
  return { atoms: 0, entities: 0, mocs: 0, sources: 0, synthesis: 0, scopes: new Set(), authors: new Map() }
}

async function rebuildIndex(tree: TreeEntry[]): Promise<{ counts: IndexCounts; sha?: string }> {
  const counts = emptyCounts()
  for (const entry of tree) {
    if (entry.type !== 'blob') continue
    const parts = entry.path.split('/')
    if (parts.length < 3 || !parts[2].endsWith('.md')) continue
    const kind = parts[0]
    const scopeId = parts[1]
    if (kind === 'atoms' || kind === 'entities' || kind === 'mocs' || kind === 'sources' || kind === 'synthesis') {
      counts[kind] += 1
      counts.scopes.add(scopeId)
    }
  }
  const lines = [
    '# memory-hq — Index',
    '',
    `_Regenerated: ${new Date().toISOString()}_`,
    '',
    '## Counts',
    `- atoms: ${counts.atoms}`,
    `- entities: ${counts.entities}`,
    `- mocs: ${counts.mocs}`,
    `- sources: ${counts.sources}`,
    `- synthesis: ${counts.synthesis}`,
    `- scopes: ${counts.scopes.size}`,
    '',
    '## Scopes (scope-id)',
    ...Array.from(counts.scopes).sort().map((s) => `- \`${s}\``),
    '',
  ]
  const existing = await getFile('INDEX.md')
  await putFile('INDEX.md', lines.join('\n'), existing?.sha, 'chore(memory): rebuild INDEX.md (cron)')
  return { counts, sha: existing?.sha }
}

async function foldDigest(tree: TreeEntry[]): Promise<number> {
  // Collect any log/* file dated today (UTC). Compose a digest/<date>.md.
  const today = new Date().toISOString().slice(0, 10)
  const todayLogs = tree.filter((t) => t.type === 'blob' && t.path.startsWith('log/') && t.path.includes(today))
  if (todayLogs.length === 0) return 0
  const lines = [
    `# memory-hq — Digest ${today}`,
    '',
    `_Generated: ${new Date().toISOString()} · ${todayLogs.length} events_`,
    '',
  ]
  for (const t of todayLogs) {
    const f = await getFile(t.path)
    if (!f) continue
    lines.push(`## ${t.path.replace(/^log\//, '')}`, '', f.content, '', '---', '')
  }
  const digestPath = `digest/${today}.md`
  const existing = await getFile(digestPath)
  await putFile(digestPath, lines.join('\n'), existing?.sha, `chore(memory): digest ${today}`)
  return todayLogs.length
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const provided = req.headers.get('authorization') || ''
  const okFromCron = cronSecret && provided === `Bearer ${cronSecret}`
  if (!okFromCron) {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const allowed = (process.env.ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (allowed.length && !allowed.includes(userId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  try {
    const tree = await getTree()
    const { counts } = await rebuildIndex(tree)
    const digestEvents = await foldDigest(tree)
    await recordSamples([
      { metric: 'memory_hq.atoms', value: counts.atoms, ts: new Date().toISOString() },
      { metric: 'memory_hq.entities', value: counts.entities, ts: new Date().toISOString() },
      { metric: 'memory_hq.scopes', value: counts.scopes.size, ts: new Date().toISOString() },
      { metric: 'memory_hq.digest_events', value: digestEvents, ts: new Date().toISOString() },
    ]).catch(() => {})
    return NextResponse.json({
      ok: true,
      counts: {
        atoms: counts.atoms,
        entities: counts.entities,
        mocs: counts.mocs,
        sources: counts.sources,
        synthesis: counts.synthesis,
        scopes: counts.scopes.size,
      },
      digestEvents,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}

/**
 * lib/memory/github.ts
 *
 * Local-first memory engine backed by a private GitHub repo.
 * Replaces Notion for agent knowledge storage — free, version-controlled, zero infra.
 *
 * Env vars required:
 *   GITHUB_MEMORY_TOKEN  — PAT with repo scope
 *   GITHUB_MEMORY_REPO   — e.g. "pinnacleadvisors/nexus-memory"
 *
 * Folder schema (mirrors nexus-memory repo):
 *   businesses/<id>/README.md
 *   businesses/<id>/market-research/
 *   businesses/<id>/content/
 *   businesses/<id>/financials/
 *   projects/<id>/spec.md
 *   projects/<id>/decisions/
 *   agent-runs/<YYYY-MM-DD>/
 *   library/
 */

const BASE = 'https://api.github.com'

function repo(): string {
  const r = process.env.GITHUB_MEMORY_REPO
  if (!r) throw new Error('GITHUB_MEMORY_REPO is not set')
  return r
}

function token(): string {
  const t = process.env.GITHUB_MEMORY_TOKEN
  if (!t) throw new Error('GITHUB_MEMORY_TOKEN is not set')
  return t
}

function headers(): Record<string, string> {
  return {
    Authorization:  `Bearer ${token()}`,
    Accept:         'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent':   'nexus-memory/1.0',
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface MemoryFile {
  path:    string
  name:    string
  sha:     string
  size:    number
  type:    'file' | 'dir'
  url:     string
}

export interface MemoryPage {
  path:    string
  content: string   // decoded UTF-8 markdown
  sha:     string   // needed for updates
  url:     string   // HTML URL on GitHub
}

export interface MemorySearchResult {
  path:    string
  url:     string
  excerpt: string  // fragment of matching text
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function b64encode(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64')
}

function b64decode(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf-8')
}

/** Today as YYYY-MM-DD */
export function todayPath(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Write (create or update) a markdown file at `path` in the memory repo.
 * If the file already exists its SHA is fetched automatically for the update.
 *
 * @param path    Repo-relative path, e.g. "businesses/acme/README.md"
 * @param content UTF-8 markdown content
 * @param message Optional commit message (auto-generated if omitted)
 */
export async function writePage(
  path: string,
  content: string,
  message?: string,
): Promise<{ sha: string; url: string } | null> {
  try {
    const r = repo()
    // Fetch existing SHA (if any) so GitHub allows the update
    let existingSha: string | undefined
    try {
      const getRes = await fetch(`${BASE}/repos/${r}/contents/${encodeURIComponent(path)}`, {
        headers: headers(),
      })
      if (getRes.ok) {
        const data = await getRes.json() as { sha: string }
        existingSha = data.sha
      }
    } catch { /* file doesn't exist yet — that's fine */ }

    const body: Record<string, unknown> = {
      message: message ?? `nexus: update ${path}`,
      content: b64encode(content),
    }
    if (existingSha) body.sha = existingSha

    const res = await fetch(`${BASE}/repos/${r}/contents/${encodeURIComponent(path)}`, {
      method:  'PUT',
      headers: headers(),
      body:    JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error(`[memory/github] writePage failed (${res.status}):`, err)
      return null
    }

    const data = await res.json() as { content: { sha: string; html_url: string } }
    return { sha: data.content.sha, url: data.content.html_url }
  } catch (err) {
    console.error('[memory/github] writePage error:', err)
    return null
  }
}

/**
 * Read a markdown file at `path` from the memory repo.
 * Returns null if the file does not exist.
 */
export async function readPage(path: string): Promise<MemoryPage | null> {
  try {
    const r = repo()
    const res = await fetch(`${BASE}/repos/${r}/contents/${encodeURIComponent(path)}`, {
      headers: headers(),
    })
    if (!res.ok) return null
    const data = await res.json() as { content: string; sha: string; html_url: string; encoding: string }
    const content = data.encoding === 'base64'
      ? b64decode(data.content.replace(/\n/g, ''))
      : data.content
    return { path, content, sha: data.sha, url: data.html_url }
  } catch {
    return null
  }
}

/**
 * List files and directories in a folder.
 * Returns [] if the folder does not exist.
 */
export async function listPages(folder: string): Promise<MemoryFile[]> {
  try {
    const r = repo()
    const res = await fetch(`${BASE}/repos/${r}/contents/${encodeURIComponent(folder)}`, {
      headers: headers(),
    })
    if (!res.ok) return []
    const data = await res.json() as Array<{
      path: string; name: string; sha: string; size: number; type: string; html_url: string
    }>
    if (!Array.isArray(data)) return []
    return data.map(f => ({
      path: f.path,
      name: f.name,
      sha:  f.sha,
      size: f.size,
      type: f.type === 'dir' ? 'dir' : 'file',
      url:  f.html_url,
    }))
  } catch {
    return []
  }
}

/**
 * Search pages in the memory repo using GitHub code search.
 * Returns up to `limit` results (default 10).
 * Note: GitHub code search has rate limits (30 req/min unauthenticated, 10/min authenticated with lower quota).
 * The cache layer in the API route mitigates this.
 */
export async function searchPages(query: string, limit = 10): Promise<MemorySearchResult[]> {
  try {
    const r = repo()
    const q  = encodeURIComponent(`${query} repo:${r}`)
    const res = await fetch(`${BASE}/search/code?q=${q}&per_page=${Math.min(limit, 30)}`, {
      headers: headers(),
    })
    if (!res.ok) return []
    const data = await res.json() as {
      items?: Array<{ path: string; html_url: string; text_matches?: Array<{ fragment: string }> }>
    }
    return (data.items ?? []).slice(0, limit).map(item => ({
      path:    item.path,
      url:     item.html_url,
      excerpt: item.text_matches?.[0]?.fragment ?? '',
    }))
  } catch {
    return []
  }
}

/**
 * Append text to an existing page (or create it if absent).
 * Convenience wrapper around readPage + writePage.
 */
export async function appendToPage(
  path: string,
  text: string,
  message?: string,
): Promise<{ sha: string; url: string } | null> {
  const existing = await readPage(path)
  const newContent = existing
    ? `${existing.content.trimEnd()}\n\n${text}`
    : text
  return writePage(path, newContent, message)
}

/**
 * Write an agent-run log entry under agent-runs/<YYYY-MM-DD>/<capabilityId>-<ts>.md
 */
export async function writeAgentRun(
  capabilityId: string,
  businessName: string,
  output: string,
  citations?: string,
): Promise<{ sha: string; url: string } | null> {
  const date  = todayPath()
  const ts    = Date.now()
  const path  = `agent-runs/${date}/${capabilityId}-${ts}.md`
  const content = [
    `# ${capabilityId} — ${businessName}`,
    `_Generated: ${new Date().toISOString()}_`,
    '',
    output,
    citations ? `\n---\n\n## Sources\n${citations}` : '',
  ].join('\n')
  return writePage(path, content, `nexus: agent run ${capabilityId} for "${businessName}"`)
}

/** Returns true if the memory env vars are configured. */
export function isMemoryConfigured(): boolean {
  return Boolean(process.env.GITHUB_MEMORY_TOKEN && process.env.GITHUB_MEMORY_REPO)
}

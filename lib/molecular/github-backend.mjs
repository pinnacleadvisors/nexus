/**
 * lib/molecular/github-backend.mjs
 *
 * GitHub Contents API backend for the molecular memory CLI.
 * Used by .claude/skills/molecularmemory_local/cli.mjs when --backend=github.
 *
 * Storage layout (created in pinnacleadvisors/memory-hq):
 *   <kind>/<scope-id>/<slug>.md
 * where kind = atoms|entities|mocs|sources|synthesis|log|digest.
 *
 * Env:
 *   MEMORY_HQ_REPO   default "pinnacleadvisors/memory-hq"
 *   MEMORY_HQ_TOKEN  PAT scoped to that repo (contents r/w)
 *
 * SHA-based optimistic concurrency: putFile() refetches sha on 409 and
 * retries up to 3 times. Two writers on the same path eventually serialise.
 */
import { createHash } from 'node:crypto'

const BASE = 'https://api.github.com'
const DEFAULT_REPO = 'pinnacleadvisors/memory-hq'

function repo() {
  return process.env.MEMORY_HQ_REPO || DEFAULT_REPO
}

function token() {
  const t = process.env.MEMORY_HQ_TOKEN
  if (!t) throw new Error('MEMORY_HQ_TOKEN is not set (Doppler)')
  return t
}

function headers() {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'memory-hq-cli/1.0',
  }
}

const b64enc = (s) => Buffer.from(s, 'utf8').toString('base64')
const b64dec = (s) => Buffer.from(s, 'base64').toString('utf8')

// ── Scope canonicaliser (mirror of lib/memory/scope.ts) ─────────────────────

const SAFE_RE = /[^a-z0-9-]/g

function humanSuffix(scope) {
  const raw =
    scope.business_slug ||
    (scope.repo ? scope.repo.split('/').pop() : null) ||
    'unknown'
  return String(raw).toLowerCase().replace(SAFE_RE, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export function scopeIdFor(input) {
  const repoVal = input.repo?.trim() || undefined
  const business_slug = input.business_slug?.trim() || undefined
  const namespace = input.namespace?.trim() || undefined
  if (!repoVal && !business_slug) {
    throw new Error('scope must include at least one of {repo, business_slug}')
  }
  const canonical = { business_slug, namespace, repo: repoVal }
  const json = JSON.stringify(canonical)
  const hash = createHash('sha1').update(json).digest('hex').slice(0, 8)
  return `${hash}-${humanSuffix({ repo: repoVal, business_slug })}`
}

export function pathFor(kind, scope, slug) {
  return `${kind}/${scopeIdFor(scope)}/${slug}.md`
}

// ── Low-level Contents API ──────────────────────────────────────────────────

/** Returns { content, sha } or null when path does not exist. */
export async function getFile(path) {
  const url = `${BASE}/repos/${repo()}/contents/${encodeURI(path)}`
  const res = await fetch(url, { headers: headers() })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`github GET ${path} -> ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return { content: b64dec(json.content), sha: json.sha, html_url: json.html_url }
}

/** Create or update. Pass `sha` for updates. Returns { sha, html_url, action }. */
export async function putFile(path, content, sha, message) {
  const body = {
    message: message || `chore(memory): write ${path}`,
    content: b64enc(content),
  }
  if (sha) body.sha = sha

  let attempt = 0
  while (true) {
    const res = await fetch(`${BASE}/repos/${repo()}/contents/${encodeURI(path)}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const json = await res.json()
      return { sha: json.content.sha, html_url: json.content.html_url, action: sha ? 'update' : 'create' }
    }
    if (res.status === 409 && attempt < 3) {
      attempt += 1
      const cur = await getFile(path)
      if (cur) body.sha = cur.sha
      continue
    }
    throw new Error(`github PUT ${path} -> ${res.status}: ${await res.text()}`)
  }
}

/** Delete a file. Requires its current sha. */
export async function deleteFile(path, sha, message) {
  const res = await fetch(`${BASE}/repos/${repo()}/contents/${encodeURI(path)}`, {
    method: 'DELETE',
    headers: headers(),
    body: JSON.stringify({ message: message || `chore(memory): delete ${path}`, sha }),
  })
  if (!res.ok) throw new Error(`github DELETE ${path} -> ${res.status}: ${await res.text()}`)
  return { deleted: path }
}

/** List files under a path prefix (non-recursive). */
export async function listDir(prefix) {
  const url = `${BASE}/repos/${repo()}/contents/${encodeURI(prefix)}`
  const res = await fetch(url, { headers: headers() })
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`github LIST ${prefix} -> ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return Array.isArray(json) ? json : []
}

/** Recursive tree walk (one call). Returns flat list of {path, sha, type, size}. */
export async function getTree(branch = 'main') {
  const url = `${BASE}/repos/${repo()}/git/trees/${branch}?recursive=1`
  const res = await fetch(url, { headers: headers() })
  if (!res.ok) throw new Error(`github TREE -> ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json.tree || []
}

// ── High-level memory helpers (used by cli.mjs) ─────────────────────────────

/** kind: 'atoms' | 'entities' | 'mocs' | 'sources' | 'synthesis' */
export async function getItem(kind, scope, slug) {
  return getFile(pathFor(kind, scope, slug))
}

export async function putItem(kind, scope, slug, body, sha, message) {
  return putFile(pathFor(kind, scope, slug), body, sha, message)
}

export async function deleteItem(kind, scope, slug, sha) {
  return deleteFile(pathFor(kind, scope, slug), sha)
}

/** List slugs for a given kind+scope (returns just the slug strings). */
export async function listItems(kind, scope) {
  const dir = `${kind}/${scopeIdFor(scope)}`
  const entries = await listDir(dir)
  return entries
    .filter((e) => e.type === 'file' && e.name.endsWith('.md'))
    .map((e) => e.name.replace(/\.md$/, ''))
}

/** Append a log event as its own file (file-per-event — see Step 4). */
export async function appendLogEvent(scope, op, title, ref) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const slug = `${ts}-${op}-${(title || 'untitled').toLowerCase().replace(SAFE_RE, '-').slice(0, 40)}`
  const body = `# ${op}: ${title}\n\n- ts: ${new Date().toISOString()}\n- op: ${op}\n- ref: ${ref || ''}\n- author: ${process.env.MEMORY_AUTHOR || 'cli'}\n`
  return putFile(pathFor('log', scope, slug), body, undefined, `log(${op}): ${title}`)
}

export const _internal = { repo, token, headers }

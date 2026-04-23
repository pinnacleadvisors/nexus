/**
 * lib/git/diff.ts — GitHub diff + merge helpers for the A12 Phase-19 closeout.
 *
 * Detects whether a card's assetUrl is a git branch, fetches the diff + CI
 * status via the GitHub REST API, and exposes merge / close helpers for the
 * Review modal's approve / reject paths.
 *
 * Authentication: takes a Bearer token (PAT with repo scope). Callers fetch
 * it from user_secrets (kind='github', name='pat') or GITHUB_TOKEN env.
 */

const GH_API = 'https://api.github.com'

export interface BranchRef {
  owner:   string
  repo:    string
  ref:     string           // branch name or PR head (e.g. "feature/xyz")
  kind:    'branch' | 'pull'
  prNumber?: number
}

/**
 * Parse a GitHub URL. Returns null when the URL does not look like a branch /
 * PR reference. Accepts:
 *   - https://github.com/{owner}/{repo}/tree/{branch}
 *   - https://github.com/{owner}/{repo}/pull/{n}
 *   - git+https://github.com/{owner}/{repo}#{branch}
 */
export function parseBranchUrl(raw: string): BranchRef | null {
  if (!raw) return null
  try {
    const url = raw.startsWith('git+') ? new URL(raw.slice(4)) : new URL(raw)
    if (!url.hostname.endsWith('github.com')) return null
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
    if (parts.length < 2) return null
    const [owner, repo, kind, ...rest] = parts
    if (!owner || !repo) return null

    if (kind === 'tree' && rest.length > 0) {
      return { owner, repo, ref: rest.join('/'), kind: 'branch' }
    }
    if (kind === 'pull' && rest.length > 0) {
      const n = parseInt(rest[0], 10)
      if (Number.isFinite(n)) return { owner, repo, ref: `refs/pull/${n}`, kind: 'pull', prNumber: n }
    }
    if (url.hash) {
      return { owner, repo, ref: url.hash.replace(/^#/, ''), kind: 'branch' }
    }
  } catch {
    return null
  }
  return null
}

interface GhOptions {
  token: string
}

async function ghFetch<T>(path: string, opts: GhOptions & { method?: string; body?: unknown } = { token: '' }): Promise<T> {
  const res = await fetch(`${GH_API}${path}`, {
    method:  opts.method ?? 'GET',
    headers: {
      Authorization:       `Bearer ${opts.token}`,
      Accept:              'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent':        'nexus-diff-viewer',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GitHub ${res.status} on ${path}: ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

export interface DiffFile {
  filename:  string
  status:    string             // 'added' | 'modified' | 'removed' | 'renamed' | ...
  additions: number
  deletions: number
  changes:   number
  patch?:    string             // unified diff text (may be absent for binary / huge files)
}

export interface BranchDiff {
  base:   string                // usually the default branch
  head:   string                // the branch/PR head ref
  headSha: string
  aheadBy:  number
  behindBy: number
  files:    DiffFile[]
  commits:  Array<{ sha: string; message: string; authorDate: string }>
}

/**
 * For a plain branch ref, diff it against the repo's default branch.
 * For a PR ref, use the PR's own base. Truncates patches > 50 KB each to keep
 * the modal responsive.
 */
export async function fetchBranchDiff(ref: BranchRef, opts: GhOptions): Promise<BranchDiff> {
  if (ref.kind === 'pull' && ref.prNumber != null) {
    const pr = await ghFetch<{
      base: { ref: string }
      head: { ref: string; sha: string }
    }>(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.prNumber}`, opts)
    return compareRefs(ref.owner, ref.repo, pr.base.ref, pr.head.ref, opts)
  }
  // Branch kind — compare against default branch
  const repoInfo = await ghFetch<{ default_branch: string }>(`/repos/${ref.owner}/${ref.repo}`, opts)
  return compareRefs(ref.owner, ref.repo, repoInfo.default_branch, ref.ref, opts)
}

async function compareRefs(
  owner: string, repo: string, base: string, head: string, opts: GhOptions,
): Promise<BranchDiff> {
  const cmp = await ghFetch<{
    status:      string
    ahead_by:    number
    behind_by:   number
    merge_base_commit: { sha: string }
    commits:     Array<{ sha: string; commit: { message: string; author: { date: string } } }>
    files:       DiffFile[]
  }>(`/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, opts)

  const files: DiffFile[] = (cmp.files ?? []).map(f => ({
    filename:  f.filename,
    status:    f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes:   f.changes,
    patch:     f.patch && f.patch.length > 50_000 ? f.patch.slice(0, 50_000) + '\n[... truncated ...]' : f.patch,
  }))

  return {
    base,
    head,
    headSha:  cmp.commits?.[cmp.commits.length - 1]?.sha ?? cmp.merge_base_commit.sha,
    aheadBy:  cmp.ahead_by,
    behindBy: cmp.behind_by,
    files,
    commits:  (cmp.commits ?? []).map(c => ({
      sha:        c.sha,
      message:    c.commit.message,
      authorDate: c.commit.author.date,
    })),
  }
}

export interface CommitStatus {
  state:    'success' | 'pending' | 'failure' | 'error' | 'unknown'
  contexts: Array<{ context: string; state: string; description?: string; targetUrl?: string }>
}

export async function fetchCommitStatus(
  owner: string, repo: string, sha: string, opts: GhOptions,
): Promise<CommitStatus> {
  try {
    const data = await ghFetch<{
      state: CommitStatus['state']
      statuses: Array<{ context: string; state: string; description?: string; target_url?: string }>
    }>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}/status`, opts)
    return {
      state:    data.state,
      contexts: (data.statuses ?? []).map(s => ({
        context:     s.context,
        state:       s.state,
        description: s.description,
        targetUrl:   s.target_url,
      })),
    }
  } catch {
    return { state: 'unknown', contexts: [] }
  }
}

export async function mergeBranch(
  ref: BranchRef, opts: GhOptions, commitMessage?: string,
): Promise<{ merged: boolean; sha?: string; message?: string }> {
  if (ref.kind === 'pull' && ref.prNumber != null) {
    const data = await ghFetch<{ merged: boolean; sha: string; message?: string }>(
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.prNumber}/merge`,
      { ...opts, method: 'PUT', body: { commit_title: commitMessage ?? 'Nexus: approve from Board', merge_method: 'squash' } },
    )
    return { merged: data.merged, sha: data.sha, message: data.message }
  }
  // Plain branch — merge into default via the /merges endpoint
  const repoInfo = await ghFetch<{ default_branch: string }>(`/repos/${ref.owner}/${ref.repo}`, opts)
  const data = await ghFetch<{ sha?: string; message?: string }>(
    `/repos/${ref.owner}/${ref.repo}/merges`,
    { ...opts, method: 'POST', body: { base: repoInfo.default_branch, head: ref.ref, commit_message: commitMessage ?? 'Nexus: approve from Board' } },
  )
  return { merged: Boolean(data.sha), sha: data.sha, message: data.message }
}

export async function deleteBranch(ref: BranchRef, opts: GhOptions): Promise<boolean> {
  if (ref.kind === 'pull') return false   // don't delete from PR context — reviewer should close the PR itself
  try {
    await ghFetch<void>(
      `/repos/${ref.owner}/${ref.repo}/git/refs/heads/${encodeURIComponent(ref.ref)}`,
      { ...opts, method: 'DELETE' },
    )
    return true
  } catch {
    return false
  }
}

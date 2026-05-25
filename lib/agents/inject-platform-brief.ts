/**
 * Platform-brief injector — bridges the autonomy gap between gateway-driven
 * work (where Claude sees the full memory graph + active task plans) and
 * dispatched-agent work (where the agent gets only the n8n step brief).
 *
 * When a managed agent is spawned via /api/claude-session/dispatch, the
 * dispatch route calls `buildPlatformBrief()` (gated by
 * `agent_library.inject_platform_brief`) and prepends the returned string
 * to the agent's task message. The spawned agent then sees:
 *
 *   1. The 3-layer memory architecture (memory/INDEX.md head)
 *   2. The most relevant task_plan-*.md for this dispatch (matched by
 *      keyword overlap with the task string)
 *   3. (Optional, env-gated) Top memory-hq atoms via /api/memory/query
 *
 * The brief is FAIL-SOFT. If a file is missing, the HTTP probe times out,
 * or the assembled brief exceeds the budget, we drop the offending section
 * and continue. The dispatch always proceeds — context-poor is better than
 * a 500 from the dispatcher.
 *
 * Budget defaults to ~5k tokens (≈ 20 KB). Anthropic Sonnet has a 200K
 * context window, so the brief is < 3% of available context — leaves plenty
 * of room for the agent's own work + the task's specific inputs.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const DEFAULT_REPO_ROOT  = path.resolve(__dirname, '..', '..')
const DEFAULT_MAX_BYTES  = 20_000  // ≈ 5k tokens at ~4 chars/token
const MEMORY_INDEX_PATH  = 'memory/INDEX.md'
const STACK_PATH         = 'memory/platform/STACK.md'
const ROADMAP_PATH       = 'memory/roadmap/SUMMARY.md'

export interface BuildPlatformBriefOptions {
  /** The task string from the dispatch — used to match the most relevant task_plan-*.md. */
  task:        string
  /** The agent slug being spawned — logged in the brief footer for traceability. */
  agentSlug:   string
  /** Repo root to read memory files from. Defaults to the file's compiled location. */
  repoRoot?:   string
  /** Maximum bytes for the assembled brief. Defaults to 20_000. */
  maxBytes?:   number
  /**
   * If set, the helper will POST {q, scope, limit} to this URL to fetch
   * memory-hq atoms matching the task keywords. Leave undefined to skip
   * the HTTP probe — useful in tests and in environments where memory-hq
   * is unreachable.
   */
  memoryQueryUrl?: string
  /** Optional bearer for the memory-query URL. */
  memoryQueryToken?: string
}

export interface PlatformBrief {
  /**
   * The assembled brief. Empty string when injection is disabled or every
   * source failed — the dispatch should detect empty and not prepend it.
   */
  brief:           string
  /** Sections that successfully loaded. */
  sources:         string[]
  /** Estimated token count (chars/4 — rough approximation). */
  estimatedTokens: number
  /** Any soft failures encountered while assembling. */
  warnings:        string[]
}

/**
 * Build the platform brief. Always returns — never throws. Empty `brief`
 * means "nothing useful to inject"; the caller should skip prepending.
 */
export async function buildPlatformBrief(opts: BuildPlatformBriefOptions): Promise<PlatformBrief> {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const sources:  string[] = []
  const warnings: string[] = []

  const sections: string[] = []
  let bytesUsed = 0

  // Header — sets the agent's expectation that what follows is context, not task.
  const header = [
    '# Platform brief (read first)',
    '',
    'You are spawned inside Nexus — a platform that builds and runs autonomous',
    'businesses end-to-end. The sections below are the same context a Claude',
    'session sees when working in this repo directly. Read once, then return to',
    'your specific task at the bottom.',
    '',
  ].join('\n')
  sections.push(header)
  bytesUsed += Buffer.byteLength(header, 'utf8')

  // 1. memory/INDEX.md — topic map.
  try {
    const indexRaw = await fs.readFile(path.join(repoRoot, MEMORY_INDEX_PATH), 'utf8')
    const block = `## ${MEMORY_INDEX_PATH}\n\n${indexRaw}\n\n`
    if (bytesUsed + Buffer.byteLength(block, 'utf8') <= maxBytes) {
      sections.push(block)
      bytesUsed += Buffer.byteLength(block, 'utf8')
      sources.push(MEMORY_INDEX_PATH)
    } else {
      warnings.push(`${MEMORY_INDEX_PATH} skipped — would exceed budget`)
    }
  } catch (err) {
    warnings.push(`${MEMORY_INDEX_PATH} read failed: ${(err as Error).message}`)
  }

  // 2. memory/platform/STACK.md — dev rules headline.
  try {
    const stackRaw = await fs.readFile(path.join(repoRoot, STACK_PATH), 'utf8')
    const block = `## ${STACK_PATH}\n\n${stackRaw}\n\n`
    if (bytesUsed + Buffer.byteLength(block, 'utf8') <= maxBytes) {
      sections.push(block)
      bytesUsed += Buffer.byteLength(block, 'utf8')
      sources.push(STACK_PATH)
    } else {
      warnings.push(`${STACK_PATH} skipped — would exceed budget`)
    }
  } catch (err) {
    warnings.push(`${STACK_PATH} read failed: ${(err as Error).message}`)
  }

  // 3. memory/roadmap/SUMMARY.md — feature status.
  try {
    const roadmapRaw = await fs.readFile(path.join(repoRoot, ROADMAP_PATH), 'utf8')
    const block = `## ${ROADMAP_PATH}\n\n${roadmapRaw}\n\n`
    if (bytesUsed + Buffer.byteLength(block, 'utf8') <= maxBytes) {
      sections.push(block)
      bytesUsed += Buffer.byteLength(block, 'utf8')
      sources.push(ROADMAP_PATH)
    } else {
      warnings.push(`${ROADMAP_PATH} skipped — would exceed budget`)
    }
  } catch (err) {
    warnings.push(`${ROADMAP_PATH} read failed: ${(err as Error).message}`)
  }

  // 4. Most-relevant task_plan-*.md — matched by keyword overlap with `opts.task`.
  const matchedPlan = await findMostRelevantPlan({
    repoRoot,
    keywords: extractKeywords(opts.task),
  })
  if (matchedPlan) {
    try {
      const planRaw  = await fs.readFile(path.join(repoRoot, matchedPlan), 'utf8')
      // Plans can be very long — only include the first ~120 lines (North Star
      // + Status + Progress headline). The agent can read the full file via
      // its own Read tool if it needs more.
      const planHead = planRaw.split('\n').slice(0, 120).join('\n')
      const block    = `## Relevant plan — ${matchedPlan}\n\n${planHead}\n\n` +
                       `> Truncated to the first 120 lines. Use Read on \`${matchedPlan}\` for the full plan.\n\n`
      if (bytesUsed + Buffer.byteLength(block, 'utf8') <= maxBytes) {
        sections.push(block)
        bytesUsed += Buffer.byteLength(block, 'utf8')
        sources.push(matchedPlan)
      } else {
        warnings.push(`${matchedPlan} skipped — would exceed budget`)
      }
    } catch (err) {
      warnings.push(`${matchedPlan} read failed: ${(err as Error).message}`)
    }
  }

  // 5. Optional — memory-hq atoms via HTTP. Skipped when no URL provided.
  if (opts.memoryQueryUrl) {
    const atoms = await fetchMemoryAtoms({
      url:       opts.memoryQueryUrl,
      token:     opts.memoryQueryToken,
      keywords:  extractKeywords(opts.task),
      maxAtoms:  10,
    })
    if (atoms.length > 0) {
      const lines = atoms.map(a => `- **${a.title}** — ${a.body}`).join('\n')
      const block = `## Relevant memory-hq atoms (top ${atoms.length})\n\n${lines}\n\n`
      if (bytesUsed + Buffer.byteLength(block, 'utf8') <= maxBytes) {
        sections.push(block)
        bytesUsed += Buffer.byteLength(block, 'utf8')
        sources.push(`memory-hq (${atoms.length} atoms)`)
      } else {
        warnings.push('memory-hq atoms skipped — would exceed budget')
      }
    }
  }

  // Footer — tells the agent the brief is over and its actual task begins next.
  const footer = [
    `## End of platform brief`,
    '',
    `Spawned agent: ${opts.agentSlug}`,
    `Sources loaded: ${sources.length === 0 ? '(none)' : sources.join(', ')}`,
    '',
    `Your specific task follows below.`,
    '',
    '---',
    '',
  ].join('\n')
  if (bytesUsed + Buffer.byteLength(footer, 'utf8') <= maxBytes) {
    sections.push(footer)
    bytesUsed += Buffer.byteLength(footer, 'utf8')
  }

  const brief = sections.join('')

  return {
    brief:           sources.length === 0 ? '' : brief,
    sources,
    estimatedTokens: Math.ceil(brief.length / 4),
    warnings,
  }
}

/**
 * Extract simple keywords from a task string for plan matching. Lowercases,
 * splits on non-word chars, drops stopwords + length-≤-3 tokens.
 */
function extractKeywords(task: string): string[] {
  const STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'over',
    'task', 'plan', 'agent', 'nexus', 'platform', 'work', 'make', 'build',
    'create', 'write', 'add', 'update', 'fix', 'use', 'have', 'has', 'are',
    'was', 'were', 'will', 'should', 'when', 'what', 'which', 'them', 'they',
  ])
  return Array.from(new Set(
    task.toLowerCase()
        .split(/[^a-z0-9-]+/)
        .filter(w => w.length > 3 && !STOPWORDS.has(w)),
  ))
}

/**
 * Find the task_plan-*.md whose filename + first-line goal has the most
 * keyword overlap with the dispatch task. Returns the relative path or null.
 */
async function findMostRelevantPlan(opts: { repoRoot: string; keywords: string[] }): Promise<string | null> {
  if (opts.keywords.length === 0) return null
  let entries: string[] = []
  try {
    entries = await fs.readdir(opts.repoRoot)
  } catch {
    return null
  }
  const candidates = entries.filter(f => f.startsWith('task_plan-') && f.endsWith('.md'))
  if (candidates.length === 0) return null

  let best:      string | null = null
  let bestScore: number        = 0

  for (const filename of candidates) {
    const name = filename.toLowerCase()
    let score  = 0
    for (const kw of opts.keywords) if (name.includes(kw)) score += 2
    if (score > 0 && score > bestScore) {
      // For top-scoring candidates also peek the first 8 lines for Goal: line
      // bonus — small read, sharpens disambiguation.
      try {
        const head = await fs.readFile(path.join(opts.repoRoot, filename), 'utf8')
        const goal = head.split('\n').slice(0, 8).join('\n').toLowerCase()
        for (const kw of opts.keywords) if (goal.includes(kw)) score += 1
      } catch {
        // ignore — keep the filename-only score
      }
      if (score > bestScore) {
        best      = filename
        bestScore = score
      }
    }
  }
  return best
}

interface MemoryAtom {
  title: string
  body:  string
}

/**
 * Fetch top memory-hq atoms matching the task keywords. Returns [] on any
 * error — never throws. Caller is expected to handle the empty case.
 */
async function fetchMemoryAtoms(opts: {
  url:      string
  token?:   string
  keywords: string[]
  maxAtoms: number
}): Promise<MemoryAtom[]> {
  if (opts.keywords.length === 0) return []
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`

  try {
    const res = await fetch(opts.url, {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        q:     opts.keywords.join(' '),
        limit: opts.maxAtoms,
      }),
      signal:  AbortSignal.timeout(3_000),
    })
    if (!res.ok) return []
    const json = await res.json() as { results?: Array<{ title?: unknown; body?: unknown }> }
    if (!Array.isArray(json.results)) return []
    return json.results
      .filter((r): r is { title: string; body: string } =>
        typeof r.title === 'string' && typeof r.body === 'string')
      .slice(0, opts.maxAtoms)
      .map(r => ({
        title: r.title,
        // Truncate atom bodies — the agent can fetch more via memory_search.
        body:  r.body.length > 200 ? `${r.body.slice(0, 200)}…` : r.body,
      }))
  } catch {
    return []
  }
}

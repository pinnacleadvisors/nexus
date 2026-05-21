import { promises as fs } from 'node:fs'
import path from 'node:path'

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/

export function isSafeSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

/**
 * Returns the system-prompt body for an agent slug, or null when the slug
 * is missing / not present in the cloned repo. Strips YAML frontmatter so
 * the body can be prepended to the user prompt (codex has no
 * --append-system-prompt equivalent — see runCodex in spawn.ts).
 *
 * Overlay resolution (Task MA1 of task_plan-model-agnostic-platform.md):
 *   1. `.codex/agents/<slug>.md`  (Codex-specific override, if present)
 *   2. `.claude/agents/<slug>.md` (legacy/shared — Codex has been reading
 *                                  this since inception, kept for back-compat)
 *   3. `agents/<slug>.md`         (provider-neutral base)
 *   4. null
 *
 * Note the asymmetry vs claude-gateway: we keep `.claude/agents/` in the
 * Codex resolution path because that's where every agent spec lives today.
 * Migration MA2 moves them to `/agents/`; until then the `.claude` path is
 * the de-facto base. Once MA2 lands, the `.claude/agents/` entry here can
 * be removed.
 */
export async function readAgentSystemPrompt(
  repoPath: string,
  slug: string,
): Promise<string | null> {
  if (!isSafeSlug(slug)) return null
  const candidates = [
    path.join(repoPath, '.codex',  'agents', `${slug}.md`),
    path.join(repoPath, '.claude', 'agents', `${slug}.md`),
    path.join(repoPath, 'agents',            `${slug}.md`),
  ]
  for (const file of candidates) {
    try {
      const raw = await fs.readFile(file, 'utf8')
      return raw.replace(FRONTMATTER, '').trim()
    } catch {
      // Try next candidate
    }
  }
  return null
}

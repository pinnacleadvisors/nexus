import { promises as fs } from 'node:fs'
import path from 'node:path'

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/

export function isSafeSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

/**
 * Returns the system-prompt body for an agent slug, or null when the slug
 * is missing / not present in the cloned repo. Strips YAML frontmatter so the
 * body can go straight into `claude -p --append-system-prompt`.
 *
 * Overlay resolution (Task MA1 of task_plan-model-agnostic-platform.md):
 *   1. `.claude/agents/<slug>.md` (Claude-specific override, if present)
 *   2. `agents/<slug>.md`         (provider-neutral base)
 *   3. null
 *
 * Backward-compatible: existing specs at `.claude/agents/*.md` keep working
 * unchanged. New agents and migrated agents land at the canonical
 * `/agents/` location. The overlay layer lets us tune system prompts for
 * Claude specifically (without forking the base spec) when natural-output
 * idioms warrant it.
 */
export async function readAgentSystemPrompt(
  repoPath: string,
  slug: string,
): Promise<string | null> {
  if (!isSafeSlug(slug)) return null
  const candidates = [
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

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
 * body can be prepended to the user prompt (codex has no
 * --append-system-prompt equivalent — see runCodex in spawn.ts).
 */
export async function readAgentSystemPrompt(
  repoPath: string,
  slug: string,
): Promise<string | null> {
  if (!isSafeSlug(slug)) return null
  const file = path.join(repoPath, '.claude', 'agents', `${slug}.md`)
  try {
    const raw = await fs.readFile(file, 'utf8')
    return raw.replace(FRONTMATTER, '').trim()
  } catch {
    return null
  }
}

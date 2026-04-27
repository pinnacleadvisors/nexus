/**
 * lib/molecular/decay.ts — E3
 *
 * Felixcraft-style atomic-fact decay. Mirrors the touch/supersede logic in
 * `.claude/skills/molecularmemory_local/cli.mjs` but exposes it as a
 * callable Node module so retrievers and API routes can bump access counts
 * without shelling out.
 *
 * Touch semantics (idempotent within a single day):
 *   - lastAccessed: today (YYYY-MM-DD)
 *   - accessCount: previous + 1
 *   - status: 'active' if missing
 *
 * Files outside `memory/molecular/atoms/` are ignored.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(process.cwd(), process.env.MOLECULAR_ROOT || 'memory/molecular')
const ATOMS_DIR = path.join(ROOT, 'atoms')

export interface TouchResult {
  slug:         string
  ok:           boolean
  accessCount?: number
  lastAccessed?: string
  reason?:      string
}

export function slugify(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** Strip the `mem-` prefix produced by `lib/graph/memory-builder.ts`. */
export function nodeIdToSlug(id: string): string | null {
  if (!id.startsWith('mem-')) return null
  const tail = id.slice('mem-'.length)
  if (tail.includes('/')) {
    if (!/molecular\/atoms\//.test(tail)) return null
    return tail.split('/').pop()!.replace(/\.md$/, '')
  }
  return tail
}

function upsertFrontmatterField(raw: string, key: string, value: string): string {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return raw
  const block = fmMatch[1]
  const re = new RegExp(`(^|\\n)${key}:[^\\n]*`)
  const nextBlock = re.test(block)
    ? block.replace(re, (_m, prefix) => `${prefix}${key}: ${value}`)
    : `${block}\n${key}: ${value}`
  return raw.replace(/^---\n[\s\S]*?\n---/, `---\n${nextBlock}\n---`)
}

export async function touchAtom(slugInput: string): Promise<TouchResult> {
  const slug = slugify(slugInput)
  if (!slug) return { slug: slugInput, ok: false, reason: 'empty slug' }
  const filePath = path.join(ATOMS_DIR, `${slug}.md`)
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return { slug, ok: false, reason: 'not found' }
  }
  const today = new Date().toISOString().slice(0, 10)
  const current = parseInt((raw.match(/\naccessCount:\s*(\d+)/) || [, '0'])[1], 10)
  let next = upsertFrontmatterField(raw, 'lastAccessed', today)
  next = upsertFrontmatterField(next, 'accessCount', String(current + 1))
  if (!/\nstatus:\s*\w+/.test(next)) next = upsertFrontmatterField(next, 'status', 'active')
  if (next !== raw) await fs.writeFile(filePath, next, 'utf8')
  return { slug, ok: true, accessCount: current + 1, lastAccessed: today }
}

/**
 * Bulk touch — used by retrievers. Fire-and-forget friendly: returns a promise
 * but never throws, so callers can `void touchAtomsByNodeIds(...)`.
 */
export async function touchAtomsByNodeIds(ids: string[]): Promise<TouchResult[]> {
  const slugs = Array.from(new Set(ids.map(nodeIdToSlug).filter(Boolean) as string[]))
  if (slugs.length === 0) return []
  const out: TouchResult[] = []
  for (const slug of slugs) {
    try {
      out.push(await touchAtom(slug))
    } catch (e) {
      out.push({ slug, ok: false, reason: e instanceof Error ? e.message : 'unknown' })
    }
  }
  return out
}

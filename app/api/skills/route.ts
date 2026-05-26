/**
 * GET /api/skills
 *
 * Returns a JSON list of every skill installed at .claude/skills/<name>/SKILL.md.
 * Reads the filesystem at runtime and parses the YAML-ish frontmatter
 * (name, description, optional status).
 *
 * Used by the Settings → Skills tab to give the operator a visual inventory of
 * what's available + their lifecycle state (draft vs verified). The
 * skill-trainer agent writes `status: draft` on auto-generated skills; hand-
 * curated skills omit the field and default to `verified`.
 *
 * Not authenticated beyond the Clerk session — skill metadata is non-sensitive
 * (the same content is committed to the repo). Rate limit is lighter than
 * configuration endpoints since the data is essentially static.
 *
 * If the .claude/skills directory doesn't ship in a particular deployment
 * artifact, the response is `{ skills: [], note: '...' }` rather than 500 —
 * the tab degrades to an empty state instead of breaking the settings page.
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createServerClient } from '@/lib/supabase'
import { loadOverrides } from '@/lib/skills/overrides'

export const runtime = 'nodejs'

interface SkillRow {
  slug:           string
  name:           string
  description:    string
  status:         'draft' | 'verified'
  hasContent:     boolean
  sizeBytes:      number
  updatedAt:      string | null
  /** Resolved model — override wins, falls back to frontmatter default, then null. */
  model:          string | null
  /** Frontmatter default (informational; null if SKILL.md omits the field). */
  modelDefault:   string | null
  /** True if a per-operator override is active. */
  modelOverridden: boolean
  /** Rationale recorded when the override was set via Recommend. */
  modelRationale: string | null
}

/** Tiny YAML-ish frontmatter parser. Handles the subset the SKILL.md files
 *  actually use — `key: value` pairs only, single-line values, multi-line
 *  descriptions joined by being on the same key line. No nested objects, no
 *  arrays, no quoting nuance. If we ever need more, swap in `gray-matter`. */
function parseFrontmatter(raw: string): Record<string, string> {
  const m = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const out: Record<string, string> = {}
  const lines = m[1].split(/\r?\n/)
  let currentKey: string | null = null
  for (const line of lines) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/)
    if (kv) {
      currentKey = kv[1]
      out[currentKey] = kv[2]
    } else if (currentKey && line.trim()) {
      // continuation line — concat to the current key with a single space
      out[currentKey] = `${out[currentKey]} ${line.trim()}`.trim()
    }
  }
  return out
}

async function readSkills(userId: string): Promise<{ skills: SkillRow[]; warning?: string }> {
  // Per-operator overrides layer on top of frontmatter defaults.
  const db        = createServerClient()
  const overrides = db ? await loadOverrides(db, userId) : new Map()
  // Overlay resolution (Task MA1/MA3 of task_plan-model-agnostic-platform.md):
  // canonical location is `/skills/`; legacy is `.claude/skills/`. Read both,
  // dedupe by slug (canonical wins), so the move can happen incrementally
  // without breaking the tab UI mid-migration.
  const sources: { dir: string; label: string }[] = [
    { dir: join(process.cwd(), 'skills'),            label: 'skills'         },
    { dir: join(process.cwd(), '.claude', 'skills'), label: '.claude/skills' },
  ]

  const bySlug = new Map<string, SkillRow>()
  const sourcesFound: string[] = []
  for (const source of sources) {
    let entries: string[]
    try {
      entries = await readdir(source.dir)
      sourcesFound.push(source.label)
    } catch {
      continue
    }
    for (const slug of entries) {
      if (bySlug.has(slug)) continue   // canonical source already populated this slug
      // Skip hidden / non-directories cheaply by looking only at the SKILL.md.
      const skillFile = join(source.dir, slug, 'SKILL.md')
      let raw: string
      let mtime: Date | null = null
      let sizeBytes = 0
      try {
        const s = await stat(skillFile)
        mtime    = s.mtime
        sizeBytes = s.size
        raw       = await readFile(skillFile, 'utf8')
      } catch {
        // No SKILL.md → not a skill folder, skip silently.
        continue
      }
      const fm = parseFrontmatter(raw)
      const name        = (fm.name        ?? slug).trim()
      const description = (fm.description ?? '').trim()
      // Hand-curated skills omit `status`. skill-trainer auto-generated ones
      // write `status: draft` until the operator promotes them. Treat absence
      // as verified — the existing three skills in the repo are hand-curated.
      const status        = (fm.status === 'draft') ? 'draft' : 'verified'
      const modelDefault  = fm.model?.trim() || null
      const override      = overrides.get(slug)
      bySlug.set(slug, {
        slug,
        name,
        description,
        status,
        hasContent: raw.length > 0,
        sizeBytes,
        updatedAt:  mtime ? mtime.toISOString() : null,
        model:           override?.model ?? modelDefault,
        modelDefault,
        modelOverridden: Boolean(override),
        modelRationale:  override?.rationale ?? null,
      })
    }
  }

  if (sourcesFound.length === 0) {
    return { skills: [], warning: 'no skills directory present (checked /skills and .claude/skills)' }
  }

  const rows = Array.from(bySlug.values())
  // Verified first, then drafts, then alphabetical within each group.
  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'verified' ? -1 : 1
    return a.slug.localeCompare(b.slug)
  })
  return { skills: rows }
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const result = await readSkills(userId)
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

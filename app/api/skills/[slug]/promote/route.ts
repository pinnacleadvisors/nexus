/**
 * POST /api/skills/[slug]/promote
 *
 * Flips a skill's frontmatter `status: draft → verified`. Skills produced
 * by the `skill-trainer` agent ship as draft; the human reviews the SKILL.md
 * + Error Remediation log and explicitly promotes via this endpoint.
 *
 * Skills without a `status` field are treated as verified (backwards compat
 * for the existing skill set written by hand).
 *
 * Auth: Clerk session + owner gate OR Bearer NEXUS_OPS_TOKEN. Same shape as
 * `/api/businesses/[slug]/provision`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { audit } from '@/lib/audit'
import { seedConceptForArtifact, artifactMetaFromSkillMd } from '@/lib/learning/distill-bridge'

export const runtime = 'nodejs'

// Where `skill-trainer` writes outputs (relative to repo root)
const SKILLS_ROOT = path.join(process.cwd(), '.claude', 'skills')

interface PromoteBody {
  notes?:  string  // optional review notes captured in audit log
  userId?: string  // bearer-mode override
}

function isValidSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-_]{0,63}$/.test(s)
}

/**
 * Replace the value of `status:` in YAML frontmatter, or insert it if missing.
 * Returns the patched markdown string and a flag indicating which case fired.
 */
function patchStatus(markdown: string, nextStatus: 'verified'): { patched: string; mode: 'replaced' | 'inserted' | 'no-frontmatter' } {
  const fmMatch = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!fmMatch) return { patched: markdown, mode: 'no-frontmatter' }

  const block = fmMatch[1]
  const hasStatus = /^status:\s*\S+/m.test(block)

  if (hasStatus) {
    const updated = block.replace(/^status:\s*\S+/m, `status: ${nextStatus}`)
    return {
      patched: markdown.replace(fmMatch[0], `---\n${updated}\n---\n`),
      mode: 'replaced',
    }
  }

  return {
    patched: markdown.replace(fmMatch[0], `---\n${block}\nstatus: ${nextStatus}\n---\n`),
    mode: 'inserted',
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params
  if (!isValidSlug(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid slug' }, { status: 400 })
  }

  let body: PromoteBody = {}
  try { body = await req.json() as PromoteBody } catch { /* empty body ok */ }

  const a = await authenticateOps(req, { bodyUserId: body.userId })
  if ('response' in a) return a.response

  const skillPath = path.join(SKILLS_ROOT, slug, 'SKILL.md')

  let markdown: string
  try {
    markdown = await fs.readFile(skillPath, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return NextResponse.json({ ok: false, error: 'skill not found', path: skillPath }, { status: 404 })
    }
    return NextResponse.json({ ok: false, error: `read failed: ${(err as Error).message}` }, { status: 500 })
  }

  const { patched, mode } = patchStatus(markdown, 'verified')
  if (mode === 'no-frontmatter') {
    return NextResponse.json(
      { ok: false, error: 'SKILL.md has no YAML frontmatter — cannot patch status' },
      { status: 422 },
    )
  }

  if (patched === markdown) {
    // Already verified — idempotent success
    return NextResponse.json({ ok: true, slug, status: 'verified', changed: false })
  }

  try {
    await fs.writeFile(skillPath, patched, 'utf8')
  } catch (err) {
    return NextResponse.json({ ok: false, error: `write failed: ${(err as Error).message}` }, { status: 500 })
  }

  // Learning Scope C — best-effort: seed a "how this skill works" concept card
  // onto the operator's /learn deck. Never blocks the promote (fail-soft).
  try { await seedConceptForArtifact(a.userId, artifactMetaFromSkillMd(slug, patched)) } catch { /* never block promote */ }

  audit(req, {
    action:     'skills.promote',
    resource:   'skill',
    resourceId: slug,
    userId:     a.userId,
    metadata:   { authMode: a.mode, mode, notes: body.notes?.slice(0, 500) },
  })

  return NextResponse.json({ ok: true, slug, status: 'verified', changed: true, mode })
}

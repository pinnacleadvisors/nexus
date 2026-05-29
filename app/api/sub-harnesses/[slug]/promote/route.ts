/**
 * POST /api/sub-harnesses/[slug]/promote
 *
 * Flips a sub-harness draft → verified — the human review gate that makes it
 * replayable (same shape as /api/skills/[slug]/promote). The DB row is
 * authoritative; we ALSO best-effort patch the HARNESS.md frontmatter
 * `status:` when the artifact file exists (E2 writes it).
 *
 * Auth: Clerk session + owner OR Bearer NEXUS_OPS_TOKEN (authenticateOps).
 */

import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { audit } from '@/lib/audit'
import { setSubHarnessStatus } from '@/lib/harness/store'
import { isHarnessSlug } from '@/lib/harness/types'

export const runtime = 'nodejs'

const HARNESSES_ROOT = path.join(process.cwd(), '.claude', 'sub-harnesses')

interface PromoteBody { notes?: string; userId?: string }

/** Replace `status:` in YAML frontmatter, or insert it. Mirrors skills promote. */
function patchStatus(markdown: string, next: 'verified'): { patched: string; changed: boolean } {
  const fm = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!fm) return { patched: markdown, changed: false }
  const block = fm[1]
  if (/^status:\s*\S+/m.test(block)) {
    const updated = block.replace(/^status:\s*\S+/m, `status: ${next}`)
    return { patched: markdown.replace(fm[0], `---\n${updated}\n---\n`), changed: true }
  }
  return { patched: markdown.replace(fm[0], `---\n${block}\nstatus: ${next}\n---\n`), changed: true }
}

export async function POST(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  if (!isHarnessSlug(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid slug' }, { status: 400 })
  }

  let body: PromoteBody = {}
  try { body = (await req.json()) as PromoteBody } catch { /* empty body ok */ }

  const a = await authenticateOps(req, { bodyUserId: body.userId })
  if ('response' in a) return a.response

  // Authoritative: flip the DB row. 404 if no such harness for this owner.
  const res = await setSubHarnessStatus(slug, a.userId, 'verified', a.principal)
  if (!res.ok) {
    const status = res.error === 'not_found' ? 404 : 200
    return NextResponse.json({ ok: false, error: res.error }, { status })
  }

  // Best-effort: keep the on-disk artifact frontmatter in sync (E2 writes it).
  // Path built into a variable from a validated slug — no fs op on an
  // interpolated path (CodeQL js/path-injection-safe, like skills promote).
  let fileSynced = false
  const harnessPath = path.join(HARNESSES_ROOT, slug, 'HARNESS.md')
  try {
    const md = await fs.readFile(harnessPath, 'utf8')
    const { patched, changed } = patchStatus(md, 'verified')
    if (changed && patched !== md) { await fs.writeFile(harnessPath, patched, 'utf8'); fileSynced = true }
  } catch { /* artifact file optional — DB row is the gate */ }

  audit(req, {
    action:     'sub-harness.promote',
    resource:   'sub-harness',
    resourceId: slug,
    userId:     a.userId,
    metadata:   { authMode: a.mode, fileSynced, notes: body.notes?.slice(0, 500) },
  })

  return NextResponse.json({ ok: true, slug, status: 'verified', fileSynced })
}

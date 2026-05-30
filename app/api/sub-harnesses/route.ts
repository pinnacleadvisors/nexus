/**
 * /api/sub-harnesses — sub-harness collection (v2 harness synthesis).
 *
 *   GET  → list every sub-harness the operator owns (UI + agent reads).
 *   POST → create a DRAFT sub-harness. Called by a mode=synthesize Loop's
 *          loop-runner after the verifier passes. Drops a Board review card so
 *          the human can promote draft→verified (the replay gate).
 *
 * Auth: operator / agent via authenticateOps (Clerk session OR Bearer
 * NEXUS_OPS_TOKEN). 200 + {ok:false} on transient failure / missing migration
 * (the synthesize agent auto-retries on 5xx).
 *
 * Creating a draft does NOT make it replayable — POST /api/sub-harnesses/
 * [slug]/invoke (E4) refuses anything that isn't `verified`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { createServerClient } from '@/lib/supabase'
import { insertTask } from '@/lib/board/insert-task'
import { createSubHarness, listSubHarnesses } from '@/lib/harness/store'
import { emptyManifest, isHarnessSlug, type SubHarnessManifest } from '@/lib/harness/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const a = await authenticateOps(req, {})
  if ('response' in a) return a.response
  const res = await listSubHarnesses(a.userId)
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error })
  return NextResponse.json({ ok: true, harnesses: res.harnesses })
}

interface CreateBody {
  slug?:     string
  goal_md?:  string
  manifest?: Partial<SubHarnessManifest>
  loop_id?:  string | null
  userId?:   string
}

export async function POST(req: NextRequest) {
  let body: CreateBody = {}
  try { body = (await req.json()) as CreateBody } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' })
  }

  const a = await authenticateOps(req, { bodyUserId: body.userId })
  if ('response' in a) return a.response

  if (!isHarnessSlug(body.slug)) {
    return NextResponse.json({ ok: false, error: 'slug must be lowercase alphanumeric / - / _, ≤ 64 chars' })
  }
  const slug = body.slug
  const loopId = typeof body.loop_id === 'string' && UUID_RE.test(body.loop_id) ? body.loop_id : null

  // Normalise the manifest — small + auditable (Pi.dev 4-core-tool minimalism).
  const base = emptyManifest()
  const m = body.manifest ?? {}
  const manifest: SubHarnessManifest = {
    skills:      Array.isArray(m.skills)     ? m.skills.filter((s): s is string => typeof s === 'string')     : base.skills,
    agent_refs:  Array.isArray(m.agent_refs) ? m.agent_refs.filter((s): s is string => typeof s === 'string') : base.agent_refs,
    tools:       Array.isArray(m.tools)      ? m.tools.filter((s): s is string => typeof s === 'string')      : base.tools,
    tests:       Array.isArray(m.tests)      ? m.tests.slice(0, 50)                                           : base.tests,
    review_spec: m.review_spec ?? base.review_spec,
  }

  const created = await createSubHarness({ slug, goal_md: body.goal_md ?? '', manifest, loop_id: loopId }, a.userId)
  if (!created.ok) return NextResponse.json({ ok: false, error: created.error })

  // Best-effort Board review card (the human promote gate). Non-fatal.
  if (!created.alreadyExists) {
    try {
      const db = createServerClient()
      if (db) {
        await insertTask(db, {
          title:       `Review sub-harness: ${slug}`,
          description: `Synthesized by a Loop (status: draft). Goal: ${(body.goal_md ?? '').slice(0, 240)}\n\nReview .claude/sub-harnesses/${slug}/HARNESS.md, then promote draft→verified via POST /api/sub-harnesses/${slug}/promote. Until verified, the replay endpoint refuses it.`,
          column_id:   'review',
        })
      }
    } catch { /* card is a convenience — never block the harness create */ }
  }

  return NextResponse.json({ ok: true, id: created.id, slug, status: 'draft', alreadyExists: created.alreadyExists ?? false })
}

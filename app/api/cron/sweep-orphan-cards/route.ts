/**
 * POST/GET /api/cron/sweep-orphan-cards
 *
 * Detects and (optionally) deletes Kanban cards whose parent idea / run was
 * deleted. Runs nightly via vercel.json. Two execution modes:
 *
 *   ?dryRun=1   Returns counts and a sample of card IDs without deleting.
 *               Default for the admin "Clean orphans now" button preview.
 *
 *   POST        Deletes the matching rows. The admin button confirms the
 *               dry-run number, then re-POSTs without dryRun=1.
 *
 * Detection rules (any one is enough):
 *   1. `idea_id` was set, then ON DELETE SET NULL fired (we can't tell that
 *      apart from "card never had an idea" without an audit log, so we
 *      treat NULL idea_id as "potential orphan" only when paired with the
 *      legacy heuristic in rule 3).
 *   2. `run_id` set but the run row no longer exists (covers post-025 cards
 *      whose run was deleted directly).
 *   3. **Legacy heuristic** — `idea_id IS NULL AND run_id IS NULL AND
 *      business_slug IS NULL AND project_id IS NULL` AND `column_id IN
 *      ('backlog','in-progress')` AND `updated_at < NOW() - 30 days`. Catches
 *      the cards from idea "Run" clicks that happened before migration 025.
 *
 * Auth: Vercel cron `CRON_SECRET` bearer; OR a signed-in user in
 *       `ALLOWED_USER_IDS` (used by the admin button on `/manage-platform`).
 *
 * Audit: every deletion writes one `audit_log` row with action
 *        `tasks.orphan_sweep_delete` and a metadata.reason describing which
 *        rule matched.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

interface CardRow {
  id:            string
  title:         string | null
  column_id:     string
  updated_at:    string
  idea_id:       string | null
  run_id:        string | null
  business_slug: string | null
  project_id:    string | null
}

interface SweepCandidate {
  card:   CardRow
  reason: string
}

function isCronAuthed(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`
}

async function authorize(req: NextRequest): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (isCronAuthed(req)) return { ok: true }
  const a = await auth()
  if (!a.userId) return { ok: false, status: 401, error: 'unauthorized' }
  const allowed = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (allowed.length > 0 && !allowed.includes(a.userId)) {
    return { ok: false, status: 403, error: 'forbidden' }
  }
  return { ok: true }
}

async function findOrphans(): Promise<SweepCandidate[]> {
  const db = createServerClient()
  if (!db) return []
  const candidates: SweepCandidate[] = []

  // Rule 2 — run_id set but run row missing.
  const sb = db as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        not: (col: string, op: string, val: unknown) => Promise<{ data: CardRow[] | null }>
        is: (col: string, val: unknown) => {
          is: (col: string, val: unknown) => {
            is: (col: string, val: unknown) => {
              is: (col: string, val: unknown) => {
                in: (col: string, vals: string[]) => {
                  lt: (col: string, val: string) => Promise<{ data: CardRow[] | null }>
                }
              }
            }
          }
        }
      }
    }
  }

  // run_id orphans
  const runOrphansRes = await sb.from('tasks')
    .select('id,title,column_id,updated_at,idea_id,run_id,business_slug,project_id')
    .not('run_id', 'is', null)
  const runIdsRaw = (runOrphansRes.data ?? []).map(c => c.run_id).filter((v): v is string => !!v)
  if (runIdsRaw.length > 0) {
    const runRowsRes = await (db as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          in: (col: string, vals: string[]) => Promise<{ data: { id: string }[] | null }>
        }
      }
    }).from('runs').select('id').in('id', runIdsRaw)
    const liveRunIds = new Set((runRowsRes.data ?? []).map(r => r.id))
    for (const c of runOrphansRes.data ?? []) {
      if (c.run_id && !liveRunIds.has(c.run_id)) {
        candidates.push({ card: c, reason: 'run_deleted' })
      }
    }
  }

  // Rule 3 — legacy heuristic (>30d untouched, fully NULL lineage, in backlog/in-progress).
  const legacyCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const legacyRes = await sb.from('tasks')
    .select('id,title,column_id,updated_at,idea_id,run_id,business_slug,project_id')
    .is('idea_id', null)
    .is('run_id', null)
    .is('business_slug', null)
    .is('project_id', null)
    .in('column_id', ['backlog', 'in-progress'])
    .lt('updated_at', legacyCutoff)
  for (const c of legacyRes.data ?? []) {
    candidates.push({ card: c, reason: 'legacy_orphan_30d' })
  }

  // Dedupe by id (a card can match both rules)
  const seen = new Set<string>()
  return candidates.filter(c => {
    if (seen.has(c.card.id)) return false
    seen.add(c.card.id)
    return true
  })
}

async function deleteCards(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const db = createServerClient()
  if (!db) return 0
  const res = await (db as unknown as {
    from: (t: string) => {
      delete: () => { in: (col: string, vals: string[]) => Promise<{ error: { message: string } | null; count?: number }> }
    }
  }).from('tasks').delete().in('id', ids)
  if (res.error) {
    console.error('[sweep-orphan-cards] delete error:', res.error.message)
    return 0
  }
  return ids.length
}

async function logAudit(req: NextRequest, payload: {
  reason: string; ids: string[]; dryRun: boolean
}): Promise<void> {
  const db = createServerClient()
  if (!db) return
  await (db as unknown as {
    from: (t: string) => {
      insert: (rec: Record<string, unknown>) => Promise<unknown>
    }
  }).from('audit_log').insert({
    action:      payload.dryRun ? 'tasks.orphan_sweep_dry_run' : 'tasks.orphan_sweep_delete',
    resource:    'tasks',
    resource_id: null,
    metadata:    {
      reason:    payload.reason,
      count:     payload.ids.length,
      sample:    payload.ids.slice(0, 10),
      ip:        req.headers.get('x-forwarded-for') ?? null,
    },
  }).catch(() => { /* audit_log is best-effort */ })
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const authz = await authorize(req)
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status })

  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1' || req.method === 'GET'
  const candidates = await findOrphans()
  const byReason: Record<string, number> = {}
  for (const c of candidates) byReason[c.reason] = (byReason[c.reason] ?? 0) + 1

  const sample = candidates.slice(0, 10).map(c => ({
    id: c.card.id, title: c.card.title, reason: c.reason,
    column_id: c.card.column_id, updated_at: c.card.updated_at,
  }))

  if (dryRun) {
    await logAudit(req, { reason: 'preview', ids: candidates.map(c => c.card.id), dryRun: true })
    return NextResponse.json({
      ok: true, dryRun: true, total: candidates.length, byReason, sample,
    })
  }

  const deleted = await deleteCards(candidates.map(c => c.card.id))
  await logAudit(req, { reason: 'sweep', ids: candidates.map(c => c.card.id), dryRun: false })
  return NextResponse.json({
    ok: true, dryRun: false, deleted, total: candidates.length, byReason, sample,
  })
}

export async function POST(req: NextRequest) { return handle(req) }
export async function GET(req: NextRequest)  { return handle(req) }

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
 *   1. `run_id` set but the run row no longer exists (covers post-025 cards
 *      whose run was deleted directly).
 *   2. **Legacy heuristic** — `idea_id IS NULL AND run_id IS NULL AND
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
 *
 * Error policy: every code path returns JSON. The route NEVER lets an
 * unhandled exception bubble up — Next.js would otherwise return a 500 HTML
 * page, which the client's `await res.json()` cannot parse (Safari throws
 * "The string did not match the expected pattern", Chrome throws
 * "Unexpected token < in JSON"). On any DB error the response includes the
 * Supabase message so the operator can debug from the panel.
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

// Loose Supabase shape — the generated `Database` types don't yet include the
// 025-lineage columns on every consumer, and the chained filter API has too
// many overloads to type without `any`. The cast is local to this file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any }

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

interface SweepResult {
  candidates: SweepCandidate[]
  warnings:   string[]
}

async function findOrphans(db: LooseClient): Promise<SweepResult> {
  const candidates: SweepCandidate[] = []
  const warnings:   string[]         = []

  // ── Rule 1 — run_id set but run row missing ─────────────────────────────
  // If the column doesn't exist (migration 025 not applied), Supabase returns
  // an error here; we capture it as a warning and skip to the legacy rule so
  // the operator still gets useful output instead of a 500.
  try {
    const runOrphansRes = await db.from('tasks')
      .select('id,title,column_id,updated_at,idea_id,run_id,business_slug,project_id')
      .not('run_id', 'is', null)
    if (runOrphansRes.error) {
      const msg = runOrphansRes.error.message ?? String(runOrphansRes.error)
      if (/column .*run_id.* does not exist/i.test(msg)) {
        warnings.push('Migration 025 (tasks.run_id) not applied — skipping run-deleted check.')
      } else {
        warnings.push(`run-orphans query failed: ${msg}`)
      }
    } else {
      const cards: CardRow[] = runOrphansRes.data ?? []
      const runIdsRaw = cards.map(c => c.run_id).filter((v): v is string => !!v)
      if (runIdsRaw.length > 0) {
        const runRowsRes = await db.from('runs').select('id').in('id', runIdsRaw)
        if (runRowsRes.error) {
          warnings.push(`runs lookup failed: ${runRowsRes.error.message ?? 'unknown'}`)
        } else {
          const liveRunIds = new Set(((runRowsRes.data ?? []) as { id: string }[]).map(r => r.id))
          for (const c of cards) {
            if (c.run_id && !liveRunIds.has(c.run_id)) {
              candidates.push({ card: c, reason: 'run_deleted' })
            }
          }
        }
      }
    }
  } catch (err) {
    warnings.push(`run-orphans threw: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── Rule 2 — legacy heuristic ───────────────────────────────────────────
  // Build the chain only with columns that exist on the row at runtime. If
  // migration 025 hasn't landed, the lineage `.is(null)` filters fail; fall
  // back to a project-only legacy check so the operator can still clean up
  // the pre-025 backlog from the admin button.
  const legacyCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  try {
    const fullChain = await db.from('tasks')
      .select('id,title,column_id,updated_at,idea_id,run_id,business_slug,project_id')
      .is('idea_id', null)
      .is('run_id', null)
      .is('business_slug', null)
      .is('project_id', null)
      .in('column_id', ['backlog', 'in-progress'])
      .lt('updated_at', legacyCutoff)
    if (fullChain.error) {
      const msg = fullChain.error.message ?? String(fullChain.error)
      if (/column .*(idea_id|run_id|business_slug).* does not exist/i.test(msg)) {
        warnings.push('Migration 025 not applied — falling back to project_id-only legacy heuristic.')
        // Fallback: only use project_id (which existed in migration 002)
        const fallback = await db.from('tasks')
          .select('id,title,column_id,updated_at,project_id')
          .is('project_id', null)
          .in('column_id', ['backlog', 'in-progress'])
          .lt('updated_at', legacyCutoff)
        if (fallback.error) {
          warnings.push(`legacy fallback failed: ${fallback.error.message ?? 'unknown'}`)
        } else {
          for (const r of (fallback.data ?? []) as Partial<CardRow>[]) {
            candidates.push({
              card: {
                id:            r.id ?? '',
                title:         r.title ?? null,
                column_id:     r.column_id ?? 'backlog',
                updated_at:    r.updated_at ?? new Date(0).toISOString(),
                idea_id:       null,
                run_id:        null,
                business_slug: null,
                project_id:    null,
              },
              reason: 'legacy_orphan_30d_pre025',
            })
          }
        }
      } else {
        warnings.push(`legacy query failed: ${msg}`)
      }
    } else {
      for (const c of (fullChain.data ?? []) as CardRow[]) {
        candidates.push({ card: c, reason: 'legacy_orphan_30d' })
      }
    }
  } catch (err) {
    warnings.push(`legacy heuristic threw: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Dedupe by id (a card can match both rules)
  const seen = new Set<string>()
  const deduped = candidates.filter(c => {
    if (seen.has(c.card.id)) return false
    seen.add(c.card.id)
    return true
  })
  return { candidates: deduped, warnings }
}

async function deleteCards(db: LooseClient, ids: string[]): Promise<{ deleted: number; error?: string }> {
  if (ids.length === 0) return { deleted: 0 }
  try {
    const res = await db.from('tasks').delete().in('id', ids)
    if (res.error) {
      return { deleted: 0, error: res.error.message ?? 'unknown delete error' }
    }
    return { deleted: ids.length }
  } catch (err) {
    return { deleted: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

async function logAudit(req: NextRequest, db: LooseClient, payload: {
  reason: string; ids: string[]; dryRun: boolean
}): Promise<void> {
  try {
    await db.from('audit_log').insert({
      action:      payload.dryRun ? 'tasks.orphan_sweep_dry_run' : 'tasks.orphan_sweep_delete',
      resource:    'tasks',
      resource_id: null,
      metadata:    {
        reason:    payload.reason,
        count:     payload.ids.length,
        sample:    payload.ids.slice(0, 10),
        ip:        req.headers.get('x-forwarded-for') ?? null,
      },
    })
  } catch {
    // audit_log is best-effort; don't fail the response on its account
  }
}

async function handle(req: NextRequest): Promise<NextResponse> {
  try {
    const authz = await authorize(req)
    if (!authz.ok) return NextResponse.json({ ok: false, error: authz.error }, { status: authz.status })

    const db = createServerClient() as LooseClient | null
    if (!db) {
      return NextResponse.json({
        ok:    false,
        error: 'Supabase service-role client not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      }, { status: 503 })
    }

    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1' || req.method === 'GET'
    const { candidates, warnings } = await findOrphans(db)

    const byReason: Record<string, number> = {}
    for (const c of candidates) byReason[c.reason] = (byReason[c.reason] ?? 0) + 1

    const sample = candidates.slice(0, 10).map(c => ({
      id:         c.card.id,
      title:      c.card.title,
      reason:     c.reason,
      column_id:  c.card.column_id,
      updated_at: c.card.updated_at,
    }))

    if (dryRun) {
      await logAudit(req, db, { reason: 'preview', ids: candidates.map(c => c.card.id), dryRun: true })
      return NextResponse.json({
        ok: true, dryRun: true, total: candidates.length, byReason, sample, warnings,
      })
    }

    const { deleted, error } = await deleteCards(db, candidates.map(c => c.card.id))
    if (error) {
      return NextResponse.json({
        ok: false, dryRun: false, total: candidates.length, byReason, sample, warnings,
        error: `Delete failed: ${error}`,
      }, { status: 500 })
    }
    await logAudit(req, db, { reason: 'sweep', ids: candidates.map(c => c.card.id), dryRun: false })
    return NextResponse.json({
      ok: true, dryRun: false, deleted, total: candidates.length, byReason, sample, warnings,
    })
  } catch (err) {
    // Final safety net — never let the route return non-JSON.
    console.error('[sweep-orphan-cards] unhandled error:', err)
    return NextResponse.json({
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}

export async function POST(req: NextRequest) { return handle(req) }
export async function GET(req: NextRequest)  { return handle(req) }

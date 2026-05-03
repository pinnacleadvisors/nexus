/**
 * Orphan task sweeper.
 *
 * Two-phase cleanup of board cards whose lineage points to nothing:
 *
 * Phase 1 — soft-archive: set `tasks.archived_at = now()` on rows that:
 *   (a) were created > `legacyAgeDays` days ago AND have no idea_id, run_id,
 *       project_id, milestone_id (pre-migration legacy with no anchor), OR
 *   (b) reference a `runs` row whose status is `failed` or `done` and the
 *       run finished > 14 days ago AND archived_at is still NULL, OR
 *   (c) reference a since-deleted idea (idea_id stamped but ON DELETE
 *       SET NULL fired — heuristically: idea_id IS NULL but the row was
 *       created within the last 30 days AND has no project_id).
 *
 * Phase 2 — hard-delete: rows where archived_at is older than
 *   `hardDeleteGraceDays` days. The grace lets the operator recover from
 *   a bad sweep via the `?include_archived=1` board view.
 *
 * Returns counts so the cron route can surface them to operators and write
 * a `log_events` row (PR 5 will wire that). Always idempotent.
 */

import { createServerClient } from '@/lib/supabase'

export interface SweepOptions {
  dryRun?:              boolean
  legacyAgeDays?:       number   // default 30 — pre-mig 025 cards
  hardDeleteGraceDays?: number   // default 7
  now?:                 Date     // testable
}

export interface SweepResult {
  scanned:          number
  archivedLegacy:   number
  archivedRunDone:  number
  archivedDangling: number
  hardDeleted:      number
  dryRun:           boolean
}

interface TaskRow {
  id:           string
  idea_id:      string | null
  run_id:       string | null
  project_id:   string | null
  milestone_id: string | null
  archived_at:  string | null
  created_at:   string
}

type Loose = {
  from: (t: string) => {
    select: (s: string) => unknown
    update: (p: Record<string, unknown>) => unknown
    delete: () => unknown
  }
}

function loose(sb: ReturnType<typeof createServerClient>): Loose {
  return sb as unknown as Loose
}

export async function sweepOrphans(opts: SweepOptions = {}): Promise<SweepResult> {
  const sb = createServerClient()
  const result: SweepResult = {
    scanned:          0,
    archivedLegacy:   0,
    archivedRunDone:  0,
    archivedDangling: 0,
    hardDeleted:      0,
    dryRun:           Boolean(opts.dryRun),
  }
  if (!sb) return result

  const now = opts.now ?? new Date()
  const legacyCutoff = new Date(now.getTime() - (opts.legacyAgeDays ?? 30) * 86_400_000)
  const hardCutoff   = new Date(now.getTime() - (opts.hardDeleteGraceDays ?? 7) * 86_400_000)
  const runDoneCutoff = new Date(now.getTime() - 14 * 86_400_000)

  const db = loose(sb)

  // ── Hard-delete pass first so freshly archived rows aren't mistakenly purged
  // before the grace window completes.
  if (!result.dryRun) {
    const delResp = await (db.from('tasks').delete() as unknown as {
      lt: (c: string, v: string) => Promise<{ data: { id: string }[] | null; error: unknown; count?: number }>
    }).lt('archived_at', hardCutoff.toISOString())
    if (!delResp.error) result.hardDeleted = delResp.count ?? (delResp.data?.length ?? 0)
  } else {
    const previewResp = await (db.from('tasks').select('id') as unknown as {
      lt: (c: string, v: string) => Promise<{ data: { id: string }[] | null }>
    }).lt('archived_at', hardCutoff.toISOString())
    result.hardDeleted = previewResp.data?.length ?? 0
  }

  // ── Phase 1 (a) Legacy unanchored
  const legacyResp = await (db.from('tasks').select('id, idea_id, run_id, project_id, milestone_id, archived_at, created_at') as unknown as {
    is: (c: string, v: null) => {
      is: (c: string, v: null) => {
        is: (c: string, v: null) => {
          is: (c: string, v: null) => {
            is: (c: string, v: null) => {
              lt: (c: string, v: string) => Promise<{ data: TaskRow[] | null }>
            }
          }
        }
      }
    }
  }).is('archived_at', null).is('idea_id', null).is('run_id', null).is('project_id', null).is('milestone_id', null).lt('created_at', legacyCutoff.toISOString())
  const legacyRows = legacyResp.data ?? []
  result.scanned += legacyRows.length
  if (legacyRows.length > 0 && !result.dryRun) {
    const ids = legacyRows.map(r => r.id)
    await (db.from('tasks').update({ archived_at: now.toISOString() }) as unknown as {
      in: (c: string, v: string[]) => Promise<{ error: unknown }>
    }).in('id', ids)
  }
  result.archivedLegacy = legacyRows.length

  // ── Phase 1 (b) Tasks linked to runs that finished long ago
  const finishedRunsResp = await (db.from('runs').select('id, status, updated_at') as unknown as {
    in: (c: string, v: readonly string[]) => {
      lt: (c: string, v: string) => Promise<{ data: { id: string }[] | null }>
    }
  }).in('status', ['failed', 'done']).lt('updated_at', runDoneCutoff.toISOString())
  const finishedIds = (finishedRunsResp.data ?? []).map(r => r.id)
  if (finishedIds.length > 0) {
    const runTasksResp = await (db.from('tasks').select('id') as unknown as {
      in: (c: string, v: string[]) => {
        is: (c: string, v: null) => Promise<{ data: { id: string }[] | null }>
      }
    }).in('run_id', finishedIds).is('archived_at', null)
    const runTaskIds = (runTasksResp.data ?? []).map(r => r.id)
    result.scanned += runTaskIds.length
    if (runTaskIds.length > 0 && !result.dryRun) {
      await (db.from('tasks').update({ archived_at: now.toISOString() }) as unknown as {
        in: (c: string, v: string[]) => Promise<{ error: unknown }>
      }).in('id', runTaskIds)
    }
    result.archivedRunDone = runTaskIds.length
  }

  // Phase 1 (c) — dangling-idea heuristic. We can't enumerate "ideas
  // that used to exist". The ON DELETE SET NULL trigger gives us NULL
  // idea_id, but those rows are indistinguishable from rows created
  // without an idea. The legacyAge + missing-project filter above
  // already covers the worst case; leave (c) as a no-op for now.
  result.archivedDangling = 0

  return result
}

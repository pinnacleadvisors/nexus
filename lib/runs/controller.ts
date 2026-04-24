/**
 * lib/runs/controller.ts — persistent Run state machine.
 *
 * A Run is the single entity that ties an idea through spec → decompose →
 * build → review → launch → measure → optimise → done. The controller never
 * mutates state on failure; every phase transition writes a run_events row so
 * the trail is replayable.
 *
 * Usage:
 *   const run = await startRun({ userId, ideaId })
 *   await appendEvent(run.id, 'dispatch.started', { agentSlug })
 *   await advancePhase(run.id, 'spec', { prdRef })
 *
 * When Supabase is unconfigured every call returns null / noop — the caller
 * should treat the system as "ephemeral" and fall back to in-memory state.
 */

import { createServerClient } from '@/lib/supabase'
import type { Run, RunEvent, RunEventKind, RunMetrics, RunPhase, RunStatus } from '@/lib/types'
import { RUN_PHASE_ORDER } from '@/lib/types'

// ── Row shape (DB → TS) ────────────────────────────────────────────────────
interface RunRow {
  id: string
  user_id: string
  idea_id: string | null
  project_id: string | null
  phase: RunPhase
  status: RunStatus
  cursor: Record<string, unknown> | null
  metrics: RunMetrics | null
  created_at: string
  updated_at: string
}

interface RunEventRow {
  id: string
  run_id: string
  kind: RunEventKind
  payload: Record<string, unknown> | null
  created_at: string
}

function rowToRun(r: RunRow): Run {
  return {
    id:        r.id,
    userId:    r.user_id,
    ideaId:    r.idea_id    ?? undefined,
    projectId: r.project_id ?? undefined,
    phase:     r.phase,
    status:    r.status,
    cursor:    r.cursor  ?? {},
    metrics:   r.metrics ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToEvent(r: RunEventRow): RunEvent {
  return {
    id:        r.id,
    runId:     r.run_id,
    kind:      r.kind,
    payload:   r.payload ?? {},
    createdAt: r.created_at,
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface StartRunInput {
  userId: string
  ideaId?: string
  projectId?: string
  cursor?: Record<string, unknown>
}

/**
 * Start a run. If a run already exists for (userId, ideaId), returns it
 * (idempotent resume) — useful when the forge "Build this" button is clicked
 * twice.
 */
export async function startRun(input: StartRunInput): Promise<Run | null> {
  const db = createServerClient()
  if (!db) return null

  // Resume: check for existing active run on this idea
  if (input.ideaId) {
    const { data: existing } = await (db.from('runs' as never) as unknown as {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            in: (c: string, v: readonly string[]) => {
              maybeSingle: () => Promise<{ data: RunRow | null }>
            }
          }
        }
      }
    }).select('*').eq('user_id', input.userId).eq('idea_id', input.ideaId).in('status', ['pending','active','blocked']).maybeSingle()
    if (existing) return rowToRun(existing)
  }

  const { data, error } = await (db.from('runs' as never) as unknown as {
    insert: (rec: unknown) => {
      select: () => {
        single: () => Promise<{ data: RunRow | null; error: { message: string } | null }>
      }
    }
  }).insert({
    user_id:    input.userId,
    idea_id:    input.ideaId ?? null,
    project_id: input.projectId ?? null,
    cursor:     input.cursor ?? {},
  }).select().single()

  if (error || !data) return null

  await appendEvent(data.id, 'phase.advance', { from: null, to: data.phase, reason: 'start' })
  return rowToRun(data)
}

/** Fetch a run by id. RLS ensures cross-user reads are impossible. */
export async function getRun(runId: string): Promise<Run | null> {
  const db = createServerClient()
  if (!db) return null
  const { data } = await (db.from('runs' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        maybeSingle: () => Promise<{ data: RunRow | null }>
      }
    }
  }).select('*').eq('id', runId).maybeSingle()
  return data ? rowToRun(data) : null
}

/**
 * Advance to a new phase. Writes an event and bumps updated_at. Caller can
 * skip phases (e.g. ideate → build) but the transition is logged with its
 * reason for auditability.
 */
export async function advancePhase(
  runId: string,
  to: RunPhase,
  payload: Record<string, unknown> = {},
): Promise<Run | null> {
  const db = createServerClient()
  if (!db) return null
  const current = await getRun(runId)
  if (!current) return null

  const nextStatus: RunStatus = to === 'done' ? 'done' : 'active'

  const { data, error } = await (db.from('runs' as never) as unknown as {
    update: (rec: unknown) => {
      eq: (c: string, v: string) => {
        select: () => {
          single: () => Promise<{ data: RunRow | null; error: { message: string } | null }>
        }
      }
    }
  }).update({
    phase:      to,
    status:     nextStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', runId).select().single()

  if (error || !data) return null

  await appendEvent(runId, 'phase.advance', { from: current.phase, to, ...payload })

  // C4 — fire-and-forget library promotion on successful run completion.
  // Gate is inside `promoteRunToLibrary` so callers never need to remember it.
  if (to === 'done') {
    void (async () => {
      try {
        const { promoteRunToLibrary } = await import('@/lib/library/promoter')
        const promotion = await promoteRunToLibrary(rowToRun(data))
        if (promotion.promoted) {
          await appendEvent(runId, 'optimise.applied', {
            source: 'library-promoter',
            ...promotion,
          })
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[runs/controller] library promotion failed:', err)
        }
      }
    })()
  }

  return rowToRun(data)
}

/** Mark the run as blocked or failed without moving its phase forward. */
export async function setStatus(
  runId: string,
  status: RunStatus,
  payload: Record<string, unknown> = {},
): Promise<Run | null> {
  const db = createServerClient()
  if (!db) return null

  const { data, error } = await (db.from('runs' as never) as unknown as {
    update: (rec: unknown) => {
      eq: (c: string, v: string) => {
        select: () => {
          single: () => Promise<{ data: RunRow | null; error: { message: string } | null }>
        }
      }
    }
  }).update({ status, updated_at: new Date().toISOString() })
    .eq('id', runId).select().single()

  if (error || !data) return null

  const kind: RunEventKind = status === 'blocked' ? 'phase.block' : status === 'failed' ? 'phase.fail' : 'phase.advance'
  await appendEvent(runId, kind, payload)
  return rowToRun(data)
}

/** Merge a partial metrics object into the run's metrics JSONB. */
export async function recordMetrics(runId: string, patch: RunMetrics): Promise<Run | null> {
  const db = createServerClient()
  if (!db) return null

  const current = await getRun(runId)
  if (!current) return null

  const merged: RunMetrics = { ...current.metrics, ...patch, externalIds: {
    ...(current.metrics.externalIds ?? {}),
    ...(patch.externalIds ?? {}),
  } }

  const { data, error } = await (db.from('runs' as never) as unknown as {
    update: (rec: unknown) => {
      eq: (c: string, v: string) => {
        select: () => {
          single: () => Promise<{ data: RunRow | null; error: { message: string } | null }>
        }
      }
    }
  }).update({ metrics: merged, updated_at: new Date().toISOString() })
    .eq('id', runId).select().single()

  if (error || !data) return null
  await appendEvent(runId, 'metric.sample', patch as Record<string, unknown>)
  return rowToRun(data)
}

/** Append an event. Fire-and-forget-safe when the caller does not await. */
export async function appendEvent(
  runId: string,
  kind: RunEventKind,
  payload: Record<string, unknown> = {},
): Promise<RunEvent | null> {
  const db = createServerClient()
  if (!db) return null
  const { data } = await (db.from('run_events' as never) as unknown as {
    insert: (rec: unknown) => {
      select: () => {
        single: () => Promise<{ data: RunEventRow | null }>
      }
    }
  }).insert({ run_id: runId, kind, payload }).select().single()
  return data ? rowToEvent(data) : null
}

export async function listRuns(userId: string, opts: { phase?: RunPhase; limit?: number } = {}): Promise<Run[]> {
  const db = createServerClient()
  if (!db) return []
  const limit = Math.min(opts.limit ?? 50, 200)

  type OrderReturn = Promise<{ data: RunRow[] | null }>
  const base = (db.from('runs' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => {
          order: (c: string, o: { ascending: boolean }) => {
            limit: (n: number) => OrderReturn
          }
        }
        order: (c: string, o: { ascending: boolean }) => {
          limit: (n: number) => OrderReturn
        }
      }
    }
  }).select('*').eq('user_id', userId)

  const { data } = opts.phase
    ? await base.eq('phase', opts.phase).order('updated_at', { ascending: false }).limit(limit)
    : await base.order('updated_at', { ascending: false }).limit(limit)

  return (data ?? []).map(rowToRun)
}

export async function listEvents(runId: string, limit = 100): Promise<RunEvent[]> {
  const db = createServerClient()
  if (!db) return []
  const { data } = await (db.from('run_events' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, o: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: RunEventRow[] | null }>
        }
      }
    }
  }).select('*').eq('run_id', runId).order('created_at', { ascending: true }).limit(Math.min(limit, 500))
  return (data ?? []).map(rowToEvent)
}

/** Default next phase for auto-advance. Skips 'done'. */
export function nextPhase(p: RunPhase): RunPhase | null {
  const i = RUN_PHASE_ORDER.indexOf(p)
  if (i < 0 || i >= RUN_PHASE_ORDER.length - 1) return null
  return RUN_PHASE_ORDER[i + 1]
}

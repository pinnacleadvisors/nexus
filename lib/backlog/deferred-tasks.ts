/**
 * lib/backlog/deferred-tasks.ts — single source of truth for the
 * deferred-audit backlog that seeds into `operator_tasks`.
 *
 * Two consumers:
 *  1. `scripts/seed-deferred-tasks.mjs` — Doppler-CLI path (reads the JSON
 *     directly, no TS dependency).
 *  2. `app/api/admin/seed-deferred-tasks/route.ts` — Clerk-authenticated
 *     POST that lets the operator seed via the /inbox UI (no CLI needed).
 *
 * Both paths are idempotent: callers check (user_id, scope, title) before
 * insert, so already-present rows are preserved with their done state.
 *
 * To edit the backlog: open `lib/backlog/deferred-tasks.json`, edit, save.
 * Both consumers re-read on next run.
 */

import deferred from './deferred-tasks.json'

export interface DeferredTaskTemplate {
  category:    string
  title:       string
  description: string
}

/**
 * The canonical backlog. Frozen so callers can't accidentally mutate it
 * via array .push/.splice during a request.
 */
export const DEFERRED_TASKS: readonly DeferredTaskTemplate[] = Object.freeze(deferred as DeferredTaskTemplate[])

export interface InsertResult {
  upserted: number
  skipped:  number
  failed:   number
  /** Per-row outcome — useful for the UI to render a status list. */
  details:  Array<{ title: string; outcome: 'upserted' | 'skipped' | 'failed'; reason?: string }>
}

/**
 * Insert the backlog under `(user_id, scope='admin', source='operator')`.
 * Idempotent: rows where (user_id, scope, title) already exists are
 * skipped, preserving their done state.
 *
 * `db` is a service-role Supabase client — the caller is responsible for
 * verifying the requesting user is allowed to seed (Clerk session +
 * ALLOWED_USER_IDS check for API callers, raw SUPABASE_SERVICE_ROLE_KEY
 * trust for the CLI script).
 */
export async function seedDeferredTasks(
  db: { from: (t: string) => unknown },
  userId: string,
): Promise<InsertResult> {
  const result: InsertResult = { upserted: 0, skipped: 0, failed: 0, details: [] }

  for (const item of DEFERRED_TASKS) {
    interface ExistsRow { id: string; done: boolean }
    interface MaybeSingleResp { data: ExistsRow | null; error: { message: string } | null }
    interface InsertResp { error: { message: string } | null }

    // The `as never` casts mirror lib/views/tasks.ts — the generated
    // Supabase types don't carry operator_tasks (it was added later) so
    // we bypass them. Runtime row shape is enforced by migration 037.
    const existing = await ((db.from('operator_tasks') as unknown as {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            eq: (c: string, v: string) => {
              maybeSingle: () => Promise<MaybeSingleResp>
            }
          }
        }
      }
    })
      .select('id, done')
      .eq('user_id', userId)
      .eq('scope',   'admin')
      .eq('title',   item.title)
      .maybeSingle())

    if (existing.data) {
      result.skipped++
      result.details.push({ title: item.title, outcome: 'skipped' })
      continue
    }

    const ins = await ((db.from('operator_tasks') as unknown as {
      insert: (r: Record<string, unknown>) => Promise<InsertResp>
    }).insert({
      user_id:     userId,
      scope:       'admin',
      title:       item.title,
      description: item.description,
      source:      'operator',
      done:        false,
    }))

    if (ins.error) {
      result.failed++
      result.details.push({ title: item.title, outcome: 'failed', reason: ins.error.message })
    } else {
      result.upserted++
      result.details.push({ title: item.title, outcome: 'upserted' })
    }
  }

  return result
}

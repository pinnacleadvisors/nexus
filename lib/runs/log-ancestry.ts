/**
 * logRunEventWithAncestry — fail-soft run_event insert that carries optional
 * goal_id / issue_id ancestry (migration 049). When the columns are missing,
 * strips them and falls back to a normal insert so production traffic does
 * not 5xx during the deploy window.
 *
 * Existing run_event writers use raw db.from('run_events').insert(...) —
 * those are unchanged. This helper is opt-in for callers that have ancestry
 * to record (Phase 4 solopreneur-tick integration is the first consumer).
 *
 * Pattern mirrors lib/board/insert-task.ts: detect once, cache per-process,
 * strip-on-missing-column. Cache resets on cold start.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

export interface RunEventWithAncestry {
  run_id?:        string | null
  business_slug?: string | null
  event_type:     string
  payload?:       Record<string, unknown>
  goal_id?:       string | null
  issue_id?:      string | null
}

interface LogResult {
  error: { message: string } | null
}

let ancestryColumnsAvailable: boolean | null = null

const ANCESTRY_KEYS = ['goal_id', 'issue_id'] as const

function stripAncestry(row: RunEventWithAncestry): RunEventWithAncestry {
  const out = { ...row } as Record<string, unknown>
  for (const k of ANCESTRY_KEYS) delete out[k]
  return out as unknown as RunEventWithAncestry
}

function isMissingAncestryColumn(message: string): boolean {
  if (!message) return false
  return /column .*(goal_id|issue_id).* does not exist/i.test(message)
}

export async function logRunEventWithAncestry(
  db: SupabaseClient<Database>,
  row: RunEventWithAncestry,
): Promise<LogResult> {
  const from = (db as unknown as {
    from: (t: string) => {
      insert: (r: RunEventWithAncestry) => Promise<LogResult>
    }
  }).from('run_events')

  if (ancestryColumnsAvailable === false) {
    return await from.insert(stripAncestry(row))
  }

  const first = await from.insert(row)
  if (first.error && isMissingAncestryColumn(first.error.message)) {
    if (ancestryColumnsAvailable === null) {
      console.warn(
        '[logRunEventWithAncestry] run_events.{goal_id,issue_id} missing — apply migration 049_run_events_ancestry. Falling back to ancestry-stripped inserts for this process.',
      )
    }
    ancestryColumnsAvailable = false
    return await from.insert(stripAncestry(row))
  }

  if (!first.error && ancestryColumnsAvailable === null) ancestryColumnsAvailable = true
  return first
}

'use client'

/**
 * lib/audit/streams.ts — live Realtime deltas for /audit panes (Group B).
 *
 * Mirrors the proven /dashboard pattern (supabase.channel(...).on(
 * 'postgres_changes', …).subscribe()) — one channel per open realtime pane.
 * Only fires for sources whose backing table is in the supabase_realtime
 * publication AND anon-readable (audit_log, approvals, tool_call_audit, and
 * the already-published agents). RLS-locked sources (gateway) and poll
 * sources (crons, heartbeats) never reach here.
 *
 * Server-side filtering: a single `eq` read-scope (e.g. errors →
 * result_status=eq.error) is pushed into the subscription filter. `in`
 * scopes (skills) and all eq scopes are ALSO re-checked client-side via
 * matchesRead so a streamed row can never leak across a pane's scope.
 */

import { supabase } from '@/lib/supabase'
import type { AuditRecord, AuditSource } from './types'

export interface StreamHandle {
  unsubscribe: () => void
}

/** True when a streamed row belongs in this source's scope. */
export function matchesRead(row: AuditRecord, source: AuditSource): boolean {
  const r = source.read
  if (!r) return true
  if (r.eq && String(row[r.eq.field] ?? '') !== r.eq.value) return false
  if (r.in && !r.in.values.includes(String(row[r.in.field] ?? ''))) return false
  return true
}

/**
 * Subscribe to live deltas for a realtime source. Returns a handle to
 * unsubscribe, or null when realtime can't apply (non-realtime source,
 * no table, or Supabase unconfigured). Never throws.
 */
export function subscribeToSource(
  source: AuditSource,
  onRow: (row: AuditRecord) => void,
): StreamHandle | null {
  if (!source.realtime || !source.table || !supabase) return null

  const sb = supabase
  const binding: Record<string, string> = {
    event:  source.realtimeEvent ?? 'INSERT',
    schema: 'public',
    table:  source.table,
  }
  // Push a single-value scope into the subscription to cut server-side noise.
  if (source.read?.eq) binding.filter = `${source.read.eq.field}=eq.${source.read.eq.value}`

  const channel = sb
    .channel(`audit:${source.id}`)
    // @ts-expect-error — supabase-js overloads the binding object; our dynamic
    // shape (optional `filter`) is valid at runtime, matching /dashboard.
    .on('postgres_changes', binding, (payload: { new?: unknown; old?: unknown }) => {
      const row = (payload.new ?? payload.old) as AuditRecord | undefined
      if (row && matchesRead(row, source)) onRow(row)
    })
    .subscribe()

  return { unsubscribe: () => { sb.removeChannel(channel) } }
}

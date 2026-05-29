/**
 * lib/audit/types.ts — shared types for the Bloomberg-terminal /audit view.
 *
 * The /audit page is a multi-pane "trading terminal" over existing platform
 * activity tables. Each pane ("source") is described declaratively here +
 * in sources.ts, so the same generic <AuditStreamTable> renders all of them
 * and a new pane is one registry entry — not a new component.
 *
 * Three source KINDS, distinguished by how rows arrive:
 *   - 'realtime-table' — anon-readable table; live deltas via Supabase
 *     Realtime postgres_changes (Group B), initial/refresh via Server Action.
 *   - 'action-table'   — RLS-locked-to-service-role table (no anon read, so
 *     no browser Realtime); initial + manual refresh via the Server Action.
 *   - 'poll-endpoint'  — an existing owner-only GET endpoint polled on an
 *     interval (no new long-polling routes added).
 *
 * See task_plan-bloomberg-audit.md. No JSX in this module — cell renderers
 * return plain {text,tone} descriptors so the table owns all markup and this
 * stays importable from both Server Actions and Client Components.
 */

/** A generic activity row. Heterogeneous across tables, so untyped bag. */
export type AuditRecord = Record<string, unknown>

/** Visual tone for a cell or badge. */
export type CellTone =
  | 'default'
  | 'muted'
  | 'ok'
  | 'error'
  | 'warn'
  | 'info'
  | 'pending'

/** A rendered cell descriptor — interpreted by <AuditStreamTable>. */
export interface Cell {
  text: string
  tone?: CellTone
  /** Render in a tabular/monospace font (ids, latencies, models). */
  mono?: boolean
  /** Render as a pill badge rather than plain text. */
  badge?: boolean
}

/** One column in a source's dense table. */
export interface AuditColumn {
  key: string
  header: string
  /** Tailwind width/align classes, e.g. 'w-32 text-right'. */
  className?: string
  /** Derive the cell from a row. Pure. `now` is render-time epoch ms,
   *  passed so relative-timestamp cells re-compute as the clock advances. */
  cell: (row: AuditRecord, now: number) => Cell
}

/** Cross-cutting filter pills the terminal can show above a pane. */
export type FilterKind = 'window' | 'business' | 'agent' | 'outcome' | 'mcp'

/** How a source supports one filter kind. */
export interface SourceFilterDef {
  kind: FilterKind
  /** Row field a value-filter (business/agent/mcp) matches against. */
  field?: string
  /** Maps a row to a coarse outcome bucket for the outcome pill. */
  outcomeOf?: (row: AuditRecord) => Exclude<CellTone, 'default' | 'muted' | 'info'> | null
}

export type SourceKind = 'realtime-table' | 'action-table' | 'poll-endpoint'

/** Declarative description of one terminal pane. */
export interface AuditSource {
  id: string
  label: string
  /** lucide-react icon name (verified to exist). */
  icon: string
  kind: SourceKind
  /** Supabase table for table-kinds. */
  table?: string
  /** GET endpoint for poll-kinds. */
  endpoint?: string
  /** Maps a poll-endpoint's JSON response into rows (poll-kinds only). */
  mapResponse?: (json: unknown) => AuditRecord[]
  /** Field holding the row id (React key + dedupe). */
  idField: string
  /** Field holding the sort timestamp (ISO string). */
  tsField: string
  /** True when live deltas stream via Supabase Realtime (Group B). */
  realtime: boolean
  /** Which postgres_changes event(s) to subscribe to. */
  realtimeEvent?: '*' | 'INSERT'
  /** Server-side narrowing applied by the Server Action read. */
  read?: {
    /** Restrict to rows whose `field` is one of these values. */
    in?: { field: string; values: string[] }
    /** Restrict to rows whose `field` equals this value. */
    eq?: { field: string; value: string }
  }
  columns: AuditColumn[]
  /** Filter pills this source supports, in display order. */
  filters: SourceFilterDef[]
  /** One-line description shown in the "+ add tab" picker. */
  description: string
}

/** Result of a table-source read (Server Action) or poll fetch. */
export interface AuditFetchResult {
  ok: boolean
  rows: AuditRecord[]
  error?: string
}

/** Window-filter option → milliseconds (null = all time). */
export const WINDOW_OPTIONS: { value: string; label: string; ms: number | null }[] = [
  { value: '5m',  label: 'Last 5m',  ms: 5 * 60_000 },
  { value: '1h',  label: 'Last 1h',  ms: 60 * 60_000 },
  { value: '24h', label: 'Last 24h', ms: 24 * 60 * 60_000 },
  { value: '7d',  label: 'Last 7d',  ms: 7 * 24 * 60 * 60_000 },
  { value: 'all', label: 'All time', ms: null },
]

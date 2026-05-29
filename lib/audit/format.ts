/**
 * lib/audit/format.ts — pure cell-formatting helpers for /audit panes.
 *
 * Shared by every source's column config (sources.ts). No JSX, no React —
 * returns {text,tone} Cell descriptors the table interprets.
 */

import type { AuditRecord, Cell, CellTone } from './types'

/** Read a field as a trimmed string, '—' when empty/null. */
export function str(row: AuditRecord, key: string): string {
  const v = row[key]
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

/** Compact relative time, e.g. "12s", "4m", "3h", "2d". '—' when absent. */
export function rel(iso: unknown, now: number): string {
  if (!iso) return '—'
  const t = typeof iso === 'number' ? iso : Date.parse(String(iso))
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/** Compact forward relative time, e.g. "in 4m", "due", "—". */
export function relAhead(iso: unknown, now: number): string {
  if (!iso) return '—'
  const t = typeof iso === 'number' ? iso : Date.parse(String(iso))
  if (Number.isNaN(t)) return '—'
  const s = Math.round((t - now) / 1000)
  if (s <= 0) return 'due'
  if (s < 60) return `in ${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `in ${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `in ${h}h`
  return `in ${Math.round(h / 24)}d`
}

/** USD with 2–4 dp depending on magnitude. */
export function money(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
}

/** Integer with thousands separators, '—' when not finite. */
export function num(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US')
}

/** Milliseconds → "812ms" / "1.2s". */
export function ms(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`
}

/** Truncate long free text for dense rows. */
export function clip(v: unknown, max = 48): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (!s) return '—'
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Map a tool_call_audit result_status to a tone. */
export function statusTone(status: unknown): CellTone {
  switch (String(status)) {
    case 'ok':                return 'ok'
    case 'error':             return 'error'
    case 'kill_switch':       return 'error'
    case 'denied':            return 'muted'
    case 'requires_approval': return 'warn'
    case 'rate_limited':      return 'warn'
    default:                  return 'default'
  }
}

/** Map an approvals.status to a tone. */
export function approvalTone(status: unknown): CellTone {
  switch (String(status)) {
    case 'approved':  return 'ok'
    case 'rejected':  return 'error'
    case 'cancelled': return 'muted'
    case 'pending':   return 'pending'
    default:          return 'default'
  }
}

/** Map an agents.status to a tone. */
export function agentTone(status: unknown): CellTone {
  switch (String(status)) {
    case 'active':
    case 'running':  return 'ok'
    case 'error':
    case 'failed':   return 'error'
    case 'paused':   return 'warn'
    case 'idle':     return 'muted'
    default:         return 'info'
  }
}

/** Map a cron-health bucket to a tone. */
export function cronTone(health: unknown): CellTone {
  switch (String(health)) {
    case 'green':  return 'ok'
    case 'red':    return 'error'
    case 'yellow': return 'warn'
    default:       return 'muted'
  }
}

/** Build a Cell tersely. */
export function cell(text: string, opts?: Partial<Omit<Cell, 'text'>>): Cell {
  return { text, ...opts }
}

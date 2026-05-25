/**
 * lib/cron/parse.ts — 5-field standard cron-string ↔ cron-job.org schedule shape.
 *
 * The cron-job.org REST API wants schedules as `{ minutes: number[], hours: ... }`
 * where -1 = any. This module is the canonical bidirectional converter so the
 * /cron-health UI can edit a schedule with a plain text input ("0 3 * * *")
 * AND the v9 PATCH route can re-emit the same schedule back as text for
 * pre-fill.
 *
 * Lifted from scripts/migrate-crons-to-cronjob-org.mjs + scripts/sync-crons-hmem.mjs
 * — same logic, TS this time so the client + server share it.
 */

export interface CronJobOrgSchedule {
  minutes: number[]
  hours:   number[]
  mdays:   number[]
  months:  number[]
  wdays:   number[]
}

/**
 * Parse one field of a standard cron string into the array form cron-job.org wants.
 * Accepts: `*`, `*\/N`, `a,b,c`, `a-b`, `5`.
 * Returns: number[]; `[-1]` means "any" (cron-job.org's wildcard convention).
 */
export function parseField(expr: string, max: number): number[] {
  const trimmed = expr.trim()
  if (trimmed === '*') return [-1]
  if (trimmed.startsWith('*/')) {
    const step = parseInt(trimmed.slice(2), 10)
    if (!Number.isFinite(step) || step <= 0) throw new Error(`bad step in "${expr}"`)
    const out: number[] = []
    for (let i = 0; i <= max; i += step) out.push(i)
    return out
  }
  if (trimmed.includes(',')) {
    const out = trimmed.split(',').map(s => parseInt(s.trim(), 10))
    if (out.some(n => !Number.isFinite(n))) throw new Error(`bad list in "${expr}"`)
    return out
  }
  if (trimmed.includes('-')) {
    const [a, b] = trimmed.split('-').map(s => parseInt(s.trim(), 10))
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) throw new Error(`bad range in "${expr}"`)
    return Array.from({ length: b - a + 1 }, (_, i) => a + i)
  }
  const n = parseInt(trimmed, 10)
  if (!Number.isFinite(n)) throw new Error(`bad value in "${expr}"`)
  return [n]
}

/** Parse a 5-field cron string into the cron-job.org schedule shape. */
export function cronStringToSchedule(cron: string): CronJobOrgSchedule {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`expected 5 fields (m h dom mon dow), got ${parts.length}`)
  }
  const [m, h, mday, mon, wday] = parts
  return {
    minutes: parseField(m,    59),
    hours:   parseField(h,    23),
    mdays:   parseField(mday, 31),
    months:  parseField(mon,  12),
    wdays:   parseField(wday, 6),
  }
}

/**
 * Inverse — pretty-print a cron-job.org schedule back as a 5-field cron string.
 * Used to pre-fill the /cron-health edit input with the CURRENT schedule.
 * Lossy in one direction: an array like [0,15,30,45] becomes "0,15,30,45"
 * not "*\/15" — readable but not minimal. That's the right trade-off for
 * "the operator's about to edit it" use-case.
 */
export function scheduleToCronString(sched: CronJobOrgSchedule): string {
  function fmt(arr: number[]): string {
    if (arr.length === 1 && arr[0] === -1) return '*'
    return arr.join(',')
  }
  return [
    fmt(sched.minutes),
    fmt(sched.hours),
    fmt(sched.mdays),
    fmt(sched.months),
    fmt(sched.wdays),
  ].join(' ')
}

/**
 * Validate a cron string without throwing. Returns either an error message
 * or null when the string parses cleanly. The UI uses this for inline
 * feedback under the schedule input.
 */
export function validateCronString(cron: string): string | null {
  try { cronStringToSchedule(cron); return null }
  catch (e) { return e instanceof Error ? e.message : 'invalid cron string' }
}

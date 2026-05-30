/**
 * lib/life/types.ts — Life-OS domain shapes (migration 102).
 *
 * A life_domain is a NON-revenue operator domain (Health first). It carries no
 * KPI/revenue fields by design — see lib/life/db.ts + the migration.
 */

export interface LifeDomainRow {
  slug:       string
  user_id:    string
  kind:       string
  label:      string
  status:     string
  created_at: string
}

/** One logged habit day. `day` is a YYYY-MM-DD date string. */
export interface LifeHabitDay {
  day:     string
  payload: Record<string, unknown>
}

export const HEALTH_DOMAIN_SLUG = 'health'

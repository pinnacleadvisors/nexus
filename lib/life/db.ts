/**
 * lib/life/db.ts — Life-OS persistence (migration 102). Mirrors lib/business/db
 * shape but with ZERO revenue/kpi/cost-guard surface — life domains never route
 * through checkKillSwitch or revenue aggregation.
 *
 * Fail-soft everywhere: a missing table (migration 102 not applied) / DB error
 * returns the empty/false result so the /health page still renders.
 */

import { createServerClient } from '@/lib/supabase'
import { HEALTH_DOMAIN_SLUG, type LifeDomainRow, type LifeHabitDay } from './types'

/** Idempotently ensure the operator's Health life-domain exists. Fail-soft. */
export async function ensureHealthDomain(userId: string): Promise<void> {
  const sb = createServerClient()
  if (!sb) return
  try {
    await (sb.from('life_domains' as never) as unknown as {
      upsert: (v: Record<string, unknown>, o: { onConflict: string; ignoreDuplicates: boolean }) => Promise<{ error: unknown }>
    }).upsert(
      { user_id: userId, slug: HEALTH_DOMAIN_SLUG, kind: 'life', label: 'Health', status: 'active' },
      { onConflict: 'user_id,slug', ignoreDuplicates: true },
    )
  } catch {
    /* fail-soft */
  }
}

export async function listLifeDomainsForUser(userId: string): Promise<LifeDomainRow[]> {
  const sb = createServerClient()
  if (!sb) return []
  try {
    const res = await (sb.from('life_domains' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => Promise<{ data: LifeDomainRow[] | null; error: unknown }> }
    }).select('slug, user_id, kind, label, status, created_at').eq('user_id', userId)
    if (res.error) return []
    return res.data ?? []
  } catch {
    return []
  }
}

/** Upsert a habit day (re-logging updates the payload). Returns ok. Fail-soft. */
export async function logHabit(
  userId: string, domainSlug: string, day: string, payload: Record<string, unknown>,
): Promise<boolean> {
  const sb = createServerClient()
  if (!sb) return false
  try {
    const res = await (sb.from('life_habit_log' as never) as unknown as {
      upsert: (v: Record<string, unknown>, o: { onConflict: string }) => Promise<{ error: unknown }>
    }).upsert(
      { user_id: userId, domain_slug: domainSlug, day, payload },
      { onConflict: 'user_id,domain_slug,day' },
    )
    return !res.error
  } catch {
    return false
  }
}

/** Recent habit days for a domain (most recent first within the window). Fail-soft → []. */
export async function getHabitLog(userId: string, domainSlug: string, sinceDays = 120): Promise<LifeHabitDay[]> {
  const sb = createServerClient()
  if (!sb) return []
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10)
  try {
    const res = await (sb.from('life_habit_log' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { gte: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: Array<{ day: string; payload: Record<string, unknown> }> | null; error: unknown }> } } } }
    })
      .select('day, payload').eq('user_id', userId).eq('domain_slug', domainSlug).gte('day', cutoff)
      .order('day', { ascending: false })
    if (res.error) return []
    return (res.data ?? []).map(r => ({ day: r.day, payload: r.payload ?? {} }))
  } catch {
    return []
  }
}

/**
 * lib/accomplishments/unlocks.ts — the one-time tier-unlock ledger
 * (migration 100). The /accomplishments board renders tiers live from revenue;
 * this layer exists ONLY so the recompute cron notifies once per crossed tier.
 *
 * recordNewUnlocks upserts the currently-unlocked set ignoring conflicts and
 * returns the achievement_ids that were ACTUALLY inserted (i.e. newly crossed
 * since the last run) — that's the transition guard for the milestone ping.
 *
 * Fail-soft everywhere: a missing table (migration 100 not applied) / DB error
 * returns [] so nothing breaks and — critically — nothing notifies (an empty
 * "newly inserted" set means zero pings, never a flood).
 */

import { createServerClient } from '@/lib/supabase'

export interface UnlockInput { id: string; level: number }

/**
 * Upsert the currently-unlocked tiers; return the ids that were newly inserted
 * (not previously in the ledger). Conflicts are ignored, so a re-run with no
 * new tiers returns []. Fail-soft → [] (no table / DB error = no notification).
 */
export async function recordNewUnlocks(userId: string, unlocked: UnlockInput[]): Promise<string[]> {
  if (unlocked.length === 0) return []
  const sb = createServerClient()
  if (!sb) return []
  try {
    const rows = unlocked.map(a => ({ user_id: userId, achievement_id: a.id, level: a.level }))
    const res = await (sb.from('accomplishments_unlocked' as never) as unknown as {
      upsert: (v: unknown[], o: { onConflict: string; ignoreDuplicates: boolean }) => {
        select: (c: string) => Promise<{ data: Array<{ achievement_id: string }> | null; error: unknown }>
      }
    })
      .upsert(rows, { onConflict: 'user_id,achievement_id', ignoreDuplicates: true })
      .select('achievement_id')
    if (res.error) return []
    return (res.data ?? []).map(r => r.achievement_id)
  } catch {
    return []
  }
}

/** Read the persisted unlock ledger for a user (unlock dates). Fail-soft → []. */
export async function listUnlocked(userId: string): Promise<Array<{ achievement_id: string; level: number; unlocked_at: string }>> {
  const sb = createServerClient()
  if (!sb) return []
  try {
    const res = await (sb.from('accomplishments_unlocked' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => Promise<{ data: Array<{ achievement_id: string; level: number; unlocked_at: string }> | null; error: unknown }> }
    })
      .select('achievement_id, level, unlocked_at')
      .eq('user_id', userId)
    if (res.error) return []
    return res.data ?? []
  } catch {
    return []
  }
}

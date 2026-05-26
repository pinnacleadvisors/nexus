/**
 * lib/skills/overrides.ts — per-operator model overrides for skills.
 *
 * Skills carry a default model in their SKILL.md frontmatter; the
 * operator can override per-skill via /settings → Skills (the
 * Recommend button persists into this table). GET /api/skills layers
 * the override on top of the frontmatter default.
 *
 * All functions are fail-soft: a transient DB error returns the
 * frontmatter default rather than crashing the settings page.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface SkillOverrideRow {
  user_id:    string
  slug:       string
  model:      string
  rationale:  string | null
  updated_at: string
}

export async function loadOverrides(db: SupabaseClient, userId: string): Promise<Map<string, SkillOverrideRow>> {
  try {
    const res = await (db.from('skill_overrides' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => Promise<{ data: SkillOverrideRow[] | null }> }
    }).select('*').eq('user_id', userId)
    const out = new Map<string, SkillOverrideRow>()
    for (const row of res.data ?? []) out.set(row.slug, row)
    return out
  } catch {
    return new Map()
  }
}

export async function setOverride(
  db:        SupabaseClient,
  userId:    string,
  slug:      string,
  model:     string,
  rationale?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!/^[a-z0-9_-]+$/i.test(slug)) {
    return { ok: false, error: 'invalid_slug' }
  }
  if (!model || model.length > 200) {
    return { ok: false, error: 'invalid_model' }
  }
  try {
    const res = await (db.from('skill_overrides' as never) as unknown as {
      upsert: (r: unknown, opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>
    }).upsert({
      user_id:    userId,
      slug,
      model,
      rationale:  rationale ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,slug' })
    if (res.error) return { ok: false, error: res.error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'upsert_failed' }
  }
}

export async function clearOverride(
  db:     SupabaseClient,
  userId: string,
  slug:   string,
): Promise<{ ok: boolean; error?: string }> {
  if (!/^[a-z0-9_-]+$/i.test(slug)) {
    return { ok: false, error: 'invalid_slug' }
  }
  try {
    const res = await (db.from('skill_overrides' as never) as unknown as {
      delete: () => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> } }
    }).delete().eq('user_id', userId).eq('slug', slug)
    if (res.error) return { ok: false, error: res.error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'delete_failed' }
  }
}

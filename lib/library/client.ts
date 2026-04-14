/**
 * lib/library/client.ts
 * CRUD + keyword search for the Phase 15 library layer.
 * Supabase-first; falls back to in-memory seed data when DB is not configured.
 */

import type {
  LibraryType,
  LibraryEntry,
  LibrarySearchResult,
  CodeSnippet,
  AgentTemplate,
  PromptTemplate,
  SkillDefinition,
  CreateCodeSnippet,
  CreateAgentTemplate,
  CreatePromptTemplate,
  CreateSkillDef,
} from './types'
import {
  SEED_CODE_SNIPPETS,
  SEED_AGENT_TEMPLATES,
  SEED_PROMPT_TEMPLATES,
  SEED_SKILL_DEFINITIONS,
} from './seed'

// ── Table name map ────────────────────────────────────────────────────────────
const TABLE: Record<LibraryType, string> = {
  code:   'code_snippets',
  agent:  'agent_templates',
  prompt: 'prompt_templates',
  skill:  'skill_definitions',
}

// ── Lazy Supabase client ──────────────────────────────────────────────────────
function getDb() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  // Dynamic import to avoid bundling supabase on every page
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js')
  return createClient(url, key)
}

// ── In-memory store (seed + runtime inserts when DB absent) ───────────────────
const memStore: {
  code:   CodeSnippet[]
  agent:  AgentTemplate[]
  prompt: PromptTemplate[]
  skill:  SkillDefinition[]
} = {
  code:   [...SEED_CODE_SNIPPETS],
  agent:  [...SEED_AGENT_TEMPLATES],
  prompt: [...SEED_PROMPT_TEMPLATES],
  skill:  [...SEED_SKILL_DEFINITIONS],
}

// ── Keyword search helpers ────────────────────────────────────────────────────
function scoreEntry(entry: LibraryEntry, q: string): { score: number; matchedOn: string[] } {
  if (!q.trim()) return { score: 1, matchedOn: [] }

  const terms   = q.toLowerCase().split(/\s+/).filter(Boolean)
  const matched = new Set<string>()
  let score = 0

  function check(field: string, value: string, weight: number) {
    const lower = value.toLowerCase()
    for (const term of terms) {
      if (lower.includes(term)) {
        score += weight
        matched.add(field)
      }
    }
  }

  // Name / title (highest weight)
  const name = 'name' in entry ? entry.name : (entry as CodeSnippet).title
  check('title', name, 3)

  // Description
  if ('description' in entry && typeof entry.description === 'string') {
    check('description', entry.description, 2)
  }

  // Tags
  if ('tags' in entry) {
    for (const tag of entry.tags) check('tags', tag, 2)
  }

  // Purpose / role / format
  if ('purpose'  in entry && entry.purpose)  check('purpose',  entry.purpose,  1)
  if ('role'     in entry && entry.role)     check('role',     entry.role,     1)
  if ('language' in entry && entry.language) check('language', entry.language, 1)

  return { score: score / (terms.length * 3), matchedOn: [...matched] }
}

function filterByTags<T extends LibraryEntry>(entries: T[], tags: string[]): T[] {
  if (!tags.length) return entries
  return entries.filter(e => tags.every(t => e.tags.includes(t)))
}

// ── List ──────────────────────────────────────────────────────────────────────
export async function listEntries<T extends LibraryEntry>(
  type: LibraryType,
  userId: string,
  opts: { q?: string; tags?: string[]; limit?: number; offset?: number } = {},
): Promise<LibrarySearchResult<T>[]> {
  const { q = '', tags = [], limit = 20, offset = 0 } = opts
  const db = getDb()

  if (db) {
    let query = db
      .from(TABLE[type])
      .select('*')
      .eq('user_id', userId)
      .order('usage_count', { ascending: false })
      .range(offset, offset + limit - 1)

    if (tags.length) query = query.overlaps('tags', tags)

    // Basic ilike search across name/title/description
    if (q.trim()) {
      const like = `%${q.trim()}%`
      if (type === 'code') {
        query = query.or(`title.ilike.${like},description.ilike.${like},purpose.ilike.${like}`)
      } else {
        query = query.or(`name.ilike.${like},description.ilike.${like}`)
      }
    }

    const { data, error } = await query
    if (!error && data) {
      return (data as T[]).map(entry => ({
        entry,
        score: 1,
        matchedOn: q ? ['title'] : [],
      }))
    }
  }

  // Fallback: in-memory
  let entries = (memStore[type] as T[]).filter(
    e => e.user_id === userId || e.user_id === 'system',
  )
  entries = filterByTags(entries, tags)

  const scored = entries.map(entry => ({ entry, ...scoreEntry(entry, q) }))

  return scored
    .filter(r => !q.trim() || r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(offset, offset + limit)
}

// ── Get single ────────────────────────────────────────────────────────────────
export async function getEntry<T extends LibraryEntry>(
  type: LibraryType,
  id: string,
  userId: string,
): Promise<T | null> {
  const db = getDb()

  if (db) {
    const { data } = await db
      .from(TABLE[type])
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single()
    if (data) return data as T
  }

  const entry = (memStore[type] as LibraryEntry[]).find(
    e => e.id === id && (e.user_id === userId || e.user_id === 'system'),
  )
  return (entry as T | undefined) ?? null
}

// ── Create ────────────────────────────────────────────────────────────────────
type CreatePayload =
  | CreateCodeSnippet
  | CreateAgentTemplate
  | CreatePromptTemplate
  | CreateSkillDef

export async function createEntry<T extends LibraryEntry>(
  type: LibraryType,
  userId: string,
  payload: CreatePayload,
): Promise<T> {
  const db = getDb()

  if (db) {
    const { data, error } = await db
      .from(TABLE[type])
      .insert({ ...payload, user_id: userId })
      .select()
      .single()
    if (!error && data) return data as T
  }

  // In-memory fallback
  const entry = {
    ...payload,
    id:                `${type}-${Date.now()}`,
    user_id:           userId,
    usage_count:       0,
    avg_quality_score: 0,
    auto_extracted:    false,
    created_at:        new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  } as unknown as T

  ;(memStore[type] as LibraryEntry[]).unshift(entry)
  return entry
}

// ── Increment usage count ─────────────────────────────────────────────────────
export async function incrementUsage(
  type: LibraryType,
  id: string,
  userId: string,
): Promise<void> {
  const db = getDb()

  if (db) {
    await db.rpc('increment_library_usage', { p_table: TABLE[type], p_id: id, p_user_id: userId })
    return
  }

  const entry = (memStore[type] as LibraryEntry[]).find(
    e => e.id === id && (e.user_id === userId || e.user_id === 'system'),
  )
  if (entry) entry.usage_count++
}

// ── Update quality score ──────────────────────────────────────────────────────
export async function updateQualityScore(
  type: LibraryType,
  id: string,
  userId: string,
  score: number,
): Promise<void> {
  const db = getDb()
  const clamped = Math.max(0, Math.min(1, score))

  if (db) {
    const { data } = await db
      .from(TABLE[type])
      .select('avg_quality_score, usage_count')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (data) {
      const n   = (data as { usage_count: number }).usage_count || 1
      const old = (data as { avg_quality_score: number }).avg_quality_score || 0
      const next = (old * (n - 1) + clamped) / n
      await db
        .from(TABLE[type])
        .update({ avg_quality_score: next })
        .eq('id', id)
        .eq('user_id', userId)
    }
    return
  }

  const entry = (memStore[type] as LibraryEntry[]).find(
    e => e.id === id && (e.user_id === userId || e.user_id === 'system'),
  )
  if (entry) {
    const n   = entry.usage_count || 1
    entry.avg_quality_score = (entry.avg_quality_score * (n - 1) + clamped) / n
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
export async function deleteEntry(
  type: LibraryType,
  id: string,
  userId: string,
): Promise<boolean> {
  const db = getDb()

  if (db) {
    const { error } = await db
      .from(TABLE[type])
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
    return !error
  }

  const arr = memStore[type] as LibraryEntry[]
  const idx = arr.findIndex(e => e.id === id && e.user_id === userId)
  if (idx === -1) return false
  arr.splice(idx, 1)
  return true
}

// ── Token savings estimate ────────────────────────────────────────────────────
export function estimateTokensSaved(
  counts: Record<LibraryType, number>,
): number {
  const { TOKENS_PER_HIT } = require('./types') as typeof import('./types')
  return (Object.keys(counts) as LibraryType[]).reduce(
    (sum, type) => sum + counts[type] * TOKENS_PER_HIT[type],
    0,
  )
}

// ── Auto-extract code blocks from agent output ────────────────────────────────
export function extractCodeBlocksFromOutput(
  text: string,
): Array<{ language: string; code: string }> {
  const regex = /```(\w+)?\n([\s\S]*?)```/g
  const blocks: Array<{ language: string; code: string }> = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const language = match[1]?.toLowerCase() ?? 'text'
    const code     = match[2].trim()
    if (code.length > 30) {   // skip trivial snippets
      blocks.push({ language, code })
    }
  }

  return blocks
}

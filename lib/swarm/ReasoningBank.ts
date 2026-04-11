/**
 * lib/swarm/ReasoningBank.ts
 *
 * Stores successful agent patterns in Supabase so future swarms can retrieve
 * prior routing decisions instead of re-solving solved problems.
 *
 * Falls back to an in-memory Map when Supabase is not configured.
 */

import { createHash } from 'crypto'
import { createServerClient } from '@/lib/supabase'
import type { ReasoningPattern, AgentRole } from './types'

// ── In-memory fallback ────────────────────────────────────────────────────────
const MEM_BANK = new Map<string, ReasoningPattern[]>()

// ── Hashing helpers ───────────────────────────────────────────────────────────
export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

// ── Store a pattern ───────────────────────────────────────────────────────────
export async function storePattern(pattern: Omit<ReasoningPattern, 'id' | 'createdAt'>): Promise<void> {
  const db = createServerClient()
  if (db) {
    await db.from('reasoning_patterns').insert({
      task_type:      pattern.taskType,
      task_hash:      pattern.taskHash,
      agent_role:     pattern.agentRole,
      model:          pattern.model,
      prompt_hash:    pattern.promptHash,
      result_quality: pattern.resultQuality,
      tokens_used:    pattern.tokensUsed,
      duration_ms:    pattern.durationMs,
      approved:       pattern.approved,
    }).then(({ error }) => {
      if (error) console.error('[ReasoningBank] store failed:', error.message)
    })
    return
  }

  // Fallback: in-memory
  const key = pattern.taskType
  const existing = MEM_BANK.get(key) ?? []
  existing.push({ ...pattern, id: hashText(pattern.taskHash + Date.now()), createdAt: new Date().toISOString() })
  // Keep only the 50 most recent per task type
  MEM_BANK.set(key, existing.slice(-50))
}

// ── Retrieve best pattern for task type ───────────────────────────────────────
export async function getBestPattern(
  taskType: string,
  agentRole?: AgentRole,
): Promise<ReasoningPattern | null> {
  const db = createServerClient()

  if (db) {
    let query = db
      .from('reasoning_patterns')
      .select('*')
      .eq('task_type', taskType)
      .eq('approved', true)
      .order('result_quality', { ascending: false })
      .limit(1)

    if (agentRole) query = query.eq('agent_role', agentRole)

    const { data, error } = await query
    if (error) {
      console.error('[ReasoningBank] query failed:', error.message)
      return null
    }
    if (!data?.length) return null

    const row = data[0] as Record<string, unknown>
    return {
      id:            String(row.id ?? ''),
      taskType:      String(row.task_type ?? ''),
      taskHash:      String(row.task_hash ?? ''),
      agentRole:     String(row.agent_role ?? '') as AgentRole,
      model:         String(row.model ?? ''),
      promptHash:    String(row.prompt_hash ?? ''),
      resultQuality: Number(row.result_quality ?? 0),
      tokensUsed:    Number(row.tokens_used ?? 0),
      durationMs:    Number(row.duration_ms ?? 0),
      approved:      Boolean(row.approved ?? true),
      createdAt:     String(row.created_at ?? ''),
    }
  }

  // Fallback: in-memory
  const patterns = MEM_BANK.get(taskType) ?? []
  const filtered = agentRole ? patterns.filter(p => p.agentRole === agentRole) : patterns
  const approved = filtered.filter(p => p.approved)
  if (!approved.length) return null
  return approved.sort((a, b) => b.resultQuality - a.resultQuality)[0]
}

// ── Get routing stats ─────────────────────────────────────────────────────────
export async function getRoutingStats(): Promise<{
  totalPatterns: number
  avgQuality:    number
  topRoles:      Array<{ role: string; count: number }>
}> {
  const db = createServerClient()
  if (db) {
    const { data } = await db
      .from('reasoning_patterns')
      .select('agent_role, result_quality')
      .eq('approved', true)

    if (data?.length) {
      const byRole = new Map<string, number>()
      let totalQ = 0
      for (const row of data) {
        const r = row as Record<string, unknown>
        byRole.set(String(r.agent_role), (byRole.get(String(r.agent_role)) ?? 0) + 1)
        totalQ += Number(r.result_quality ?? 0)
      }
      return {
        totalPatterns: data.length,
        avgQuality: data.length ? totalQ / data.length : 0,
        topRoles: [...byRole.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([role, count]) => ({ role, count })),
      }
    }
  }

  // Fallback
  const all = [...MEM_BANK.values()].flat()
  return { totalPatterns: all.length, avgQuality: 0, topRoles: [] }
}

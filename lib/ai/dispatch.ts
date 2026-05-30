/**
 * lib/ai/dispatch.ts — effective-model resolution for agent / skill dispatch.
 *
 * The seam that makes the operator's per-agent / per-skill model pick (set in
 * /settings/agents + /settings → Skills) actually reach the gateway's
 * `--model` flag. Precedence: explicit per-turn model > agent_library.model >
 * skill_overrides.model > undefined (→ gateway / OAuth default).
 *
 * Split so the precedence + family mapping are PURE and unit-testable
 * (`pickModel`, `familyForModel`); only `resolveEffectiveModel` touches the DB
 * and it is fail-soft end-to-end — any read error degrades to the per-turn
 * model (or undefined). Model resolution must NEVER break a dispatch.
 *
 * The gateway already honours a per-request model via `body.modelOverride`
 * (services/claude-gateway/src/index.ts → spawn `--model`); this module only
 * decides WHICH model. The dispatch route forwards it.
 *
 * This is the `lib/ai/dispatch.ts` seam from task_plan-model-agnostic-chat.md
 * Task M2 — extend it, never fork a parallel resolver.
 */

import { getModelById } from '@/lib/models/catalog'
import { shouldRouteToCodex } from '@/lib/claw/codex-gateway'
import { createServerClient } from '@/lib/supabase'
import type { AiProviderKey } from '@/lib/models/types'

export interface ModelInputs {
  /** Explicit per-turn model from the request body — always wins when set. */
  bodyModel?:  string | null
  /** The agent's stored default (agent_library.model). */
  agentModel?: string | null
  /** The operator's per-skill override (skill_overrides.model). */
  skillModel?: string | null
}

/** Pure precedence: per-turn > agent > skill > undefined. Blank strings ignored. */
export function pickModel(inputs: ModelInputs): string | undefined {
  for (const m of [inputs.bodyModel, inputs.agentModel, inputs.skillModel]) {
    if (typeof m === 'string' && m.trim()) return m.trim()
  }
  return undefined
}

export type ModelFamily = 'codex' | AiProviderKey | 'unknown'

/**
 * Pure: which runtime family a model id belongs to. GPT/codex ids route to the
 * Codex gateway; otherwise the catalog provider (anthropic/google/nim/...);
 * an unrecognised id is 'unknown' (caller treats it as the default Claude path).
 */
export function familyForModel(modelId: string | undefined): ModelFamily {
  if (!modelId) return 'unknown'
  if (shouldRouteToCodex(modelId)) return 'codex'
  const def = getModelById(modelId)
  return def ? def.provider : 'unknown'
}

export interface EffectiveModel {
  /** The resolved model id, or undefined to use the gateway / OAuth default. */
  model?:  string
  /** Runtime family of the resolved model. */
  family:  ModelFamily
  /** Where the model came from — for audit / debug. */
  source:  'body' | 'agent' | 'skill' | 'default'
}

/** Load `agent_library.model` by slug. Fail-soft → null. */
async function loadAgentModel(agentSlug: string): Promise<string | null> {
  if (!agentSlug) return null
  try {
    const db = createServerClient()
    if (!db) return null
    const res = await (db.from('agent_library') as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { model?: string | null } | null; error: unknown }>
        }
      }
    })
      .select('model')
      .eq('slug', agentSlug)
      .maybeSingle()
    if (res.error || !res.data) return null
    return res.data.model ?? null
  } catch {
    return null
  }
}

/** Load `skill_overrides.model` for (userId, skillSlug). Fail-soft → null. */
async function loadSkillModel(userId: string | undefined, skillSlug: string | undefined): Promise<string | null> {
  if (!userId || !skillSlug) return null
  try {
    const db = createServerClient()
    if (!db) return null
    const res = await (db.from('skill_overrides' as never) as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{ data: { model?: string | null } | null; error: unknown }>
          }
        }
      }
    })
      .select('model')
      .eq('user_id', userId)
      .eq('slug', skillSlug)
      .maybeSingle()
    if (res.error || !res.data) return null
    return res.data.model ?? null
  } catch {
    return null
  }
}

export interface ResolveInputs {
  agentSlug?:  string
  skillSlug?:  string
  bodyModel?:  string | null
  userId?:     string
}

/**
 * Resolve the effective model for a dispatch. Fail-soft: any DB error degrades
 * to the per-turn body model (or undefined), never throws. An explicit
 * per-turn model short-circuits the DB reads entirely.
 */
export async function resolveEffectiveModel(inputs: ResolveInputs): Promise<EffectiveModel> {
  if (typeof inputs.bodyModel === 'string' && inputs.bodyModel.trim()) {
    const model = inputs.bodyModel.trim()
    return { model, family: familyForModel(model), source: 'body' }
  }
  const [agentModel, skillModel] = await Promise.all([
    inputs.agentSlug ? loadAgentModel(inputs.agentSlug) : Promise.resolve(null),
    loadSkillModel(inputs.userId, inputs.skillSlug),
  ])
  const model = pickModel({ agentModel, skillModel })
  const source: EffectiveModel['source'] = !model
    ? 'default'
    : (agentModel && model === agentModel.trim() ? 'agent' : 'skill')
  return { model, family: familyForModel(model), source }
}

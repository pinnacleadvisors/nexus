/**
 * lib/ai/auto-route.ts — opt-in dispatch-time smart model routing (PR8).
 *
 * Called by lib/ai/dispatch.ts (via a lazy import to avoid a static cycle
 * through the recommender → callClaude → dispatch chain) ONLY when an agent has
 * auto_route=true and no stored/per-turn model. Reuses the existing recommender
 * — which caches its judgement for 24h per (agent-spec, candidate-set) — so a
 * repeated dispatch of the same agent is a near-instant cache HIT.
 *
 * Fail-soft → undefined: any error (no spec, no providers, recommender failure)
 * degrades to the resolver's default path. The model is frozen; this is an h4
 * trajectory-regulation hook, not a behaviour change for opted-out agents.
 */

import { listAgents } from '@/lib/agents/registry'
import { detectAvailableProviders } from '@/lib/models/providers'
import { recommendModelForAgent } from '@/lib/models/recommender'

export async function autoRouteModel(agentSlug: string, userId: string | undefined): Promise<string | undefined> {
  if (!agentSlug || !userId) return undefined
  try {
    const agents = await listAgents()
    const spec = agents.find(a => a.slug === agentSlug)
    if (!spec) return undefined

    const providers = await detectAvailableProviders(userId)
    if (providers.length === 0) return undefined

    const rec = await recommendModelForAgent(userId, {
      agent: {
        slug:         spec.slug,
        name:         spec.name,
        description:  spec.description,
        tools:        spec.tools,
        currentModel: (spec as { model?: string | null }).model ?? '',
      },
      availableProviders: providers,
    })
    return rec.model || undefined
  } catch {
    return undefined
  }
}

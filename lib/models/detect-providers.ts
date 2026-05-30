/**
 * Provider detection — resolve which catalog providers are reachable *right
 * now* from the gateway status + connected-accounts list. Pure + side-effect
 * free so the Agentdex and Skills model pickers can both reuse it AND it's
 * unit-testable without a browser (see __tests__/detect-providers.test.ts).
 *
 * The bug this fixes: the picker used to derive its provider set from only
 * `gateway.provider==='gateway'→anthropic` + active connected-accounts rows,
 * so in lean-mode (Claude gateway, no API-key rows) it collapsed to the 3
 * Claude models even when Codex / OpenRouter / env keys were reachable.
 */

import type { AiProviderKey } from './types'

export interface GatewayStatusLike {
  provider:       'gateway' | 'openclaw' | 'api' | 'none'
  gatewayHealthy: boolean
  /** Codex gateway configured — GPT / o-series reachable. */
  codexConfigured?:      boolean
  /** OpenRouter key present — routes to every major vendor by slug. */
  openrouterConfigured?: boolean
  /** Catalog provider keys reachable from container env (direct keys / Ollama). */
  envProviders?:         AiProviderKey[]
}

export interface ConnectedAccountLike { platform: string; status: string }

/**
 * Vendors OpenRouter can route to by slug AND that have catalog rows — so an
 * OpenRouter key surfaces their models in the picker (real reachability, not
 * just the 'openrouter' meta-key which has no catalog rows of its own).
 */
export const OPENROUTER_ROUTABLE: readonly AiProviderKey[] = [
  'anthropic', 'openai', 'google', 'xai', 'deepseek',
]

/** Catalog provider keys that can be selected as a connected provider. */
export const AI_PLATFORMS: readonly AiProviderKey[] = [
  'anthropic', 'openai', 'google', 'xai', 'deepseek',
  'meta', 'mistral', 'replicate', 'openrouter', 'nim', 'ollama',
]

/**
 * Resolve reachable catalog providers from gateway status + connected
 * accounts. Returns a de-duplicated list of `AiProviderKey`.
 */
export function detectConnectedProviders(
  gateway:  GatewayStatusLike | null,
  accounts: ConnectedAccountLike[] = [],
): AiProviderKey[] {
  const connected = new Set<AiProviderKey>()

  if (gateway) {
    // Claude — reachable via the gateway, the API key, or legacy openclaw.
    if (
      (gateway.provider === 'gateway' && gateway.gatewayHealthy) ||
      gateway.provider === 'api' ||
      gateway.provider === 'openclaw'
    ) {
      connected.add('anthropic')
    }
    // Codex gateway serves GPT / o-series.
    if (gateway.codexConfigured) connected.add('openai')
    // OpenRouter routes to every major vendor by slug.
    if (gateway.openrouterConfigured) {
      connected.add('openrouter')
      for (const p of OPENROUTER_ROUTABLE) connected.add(p)
    }
    // Direct API keys / local Ollama present in the container env.
    for (const p of gateway.envProviders ?? []) connected.add(p)
  }

  // Per-business / user connected accounts (Composio + encrypted API keys).
  for (const a of accounts) {
    if (a.status !== 'active') continue
    if ((AI_PLATFORMS as readonly string[]).includes(a.platform)) {
      connected.add(a.platform as AiProviderKey)
    }
  }

  return Array.from(connected)
}

/**
 * lib/llm/task-tier-router.ts — intelligent, cost-aware model selection by task tier.
 *
 * Thin wrapper over `getLlm()` (lib/llm/provider.ts). Maps a coarse task TIER
 * to a provider so high-volume, low-stakes work runs on the free NVIDIA NIM
 * tier instead of burning the Claude plan window, while design-heavy /
 * customer-facing work stays on the default (Claude). Frontier work can route
 * to OpenRouter for a non-Claude model.
 *
 *   background → NVIDIA NIM (free tier)        — digests, scans, extraction
 *   default    → existing resolveProvider()    — DB override → env → claude
 *   frontier   → OpenRouter                     — non-Claude frontier per-task
 *
 * Two safety rules:
 *   1. If a tier's provider isn't configured (e.g. no NVIDIA_NIM_API_KEY), the
 *      tier silently falls back to the DEFAULT chain — never breaks a caller.
 *   2. An EXPLICIT operator choice wins: if the /settings DB override is set
 *      (migration 083, source==='db') OR the caller passes opts.provider, the
 *      tier hint is ignored. The operator's intent always beats the heuristic.
 */

import type { LanguageModel } from 'ai'
import { getLlm, type GetLlmOptions, type LlmProvider } from './provider'

export type TaskTier = 'background' | 'default' | 'frontier'

const TIER_PROVIDER: Record<Exclude<TaskTier, 'default'>, LlmProvider> = {
  background: 'nim',
  frontier:   'openrouter',
}

/** Is a provider actually configured (has its key)? Used so an unconfigured
 *  tier falls back to the default chain instead of throwing. */
function providerConfigured(p: LlmProvider): boolean {
  switch (p) {
    case 'nim':        return Boolean(process.env.NVIDIA_NIM_API_KEY)
    case 'openrouter': return Boolean(process.env.OPENROUTER_API_KEY)
    default:           return true
  }
}

/** Did the operator pin a provider in /settings (DB override)? That intent
 *  beats the tier heuristic. Lazy + guarded so a missing module never breaks. */
function hasDbOverride(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, matches lib/llm/provider.ts
    const { getActiveProviderSync } = require('./provider-settings') as typeof import('./provider-settings')
    return getActiveProviderSync()?.source === 'db'
  } catch {
    return false
  }
}

/**
 * Resolve which provider a tier should use, or `null` to mean "use the default
 * resolution chain". Exposed for logging/telemetry and unit testing.
 */
export function resolveTierProvider(tier: TaskTier): LlmProvider | null {
  if (tier === 'default') return null
  const p = TIER_PROVIDER[tier]
  return providerConfigured(p) ? p : null
}

/**
 * Get a configured `LanguageModel` for a task tier. Drop-in replacement for
 * `getLlm()` at call sites that know their cost/quality posture.
 */
export function getLlmForTask(tier: TaskTier, opts?: GetLlmOptions): LanguageModel {
  // Explicit caller/operator choice wins — never override it with a tier hint.
  if (opts?.provider || hasDbOverride()) return getLlm(opts)

  const tierProvider = resolveTierProvider(tier)
  if (tierProvider) return getLlm({ ...opts, provider: tierProvider })
  return getLlm(opts)
}

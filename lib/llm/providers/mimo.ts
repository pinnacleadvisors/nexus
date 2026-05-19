/**
 * Mimo Pro 2.5 adapter — STUB.
 *
 * Activation plan: switch when the Claude Max subscription ends. Mimo Pro 2.5
 * is a top performer in many areas at a fraction of Claude's price (see the
 * open-orchestration MOC in memory-hq for the comparison atoms).
 *
 * To activate this adapter:
 *   1. Sign up at https://mimo.ai, generate an API key
 *   2. Set MIMO_API_KEY + MIMO_BASE_URL in Doppler
 *   3. Confirm the API shape matches the OpenAI-compatible contract assumed
 *      below — if it doesn't, swap the import for Mimo's official SDK
 *   4. Replace the throw in `getMimoModel` with the real factory
 *   5. Set LLM_PROVIDER=mimo in Doppler
 *
 * The AI SDK 6 has a community provider pattern (`createOpenAICompatible`)
 * that works for any provider exposing an OpenAI-shaped API — most "open"
 * alternatives do. If Mimo deviates, write a tailored provider.
 */

import type { LanguageModel } from 'ai'

export interface MimoConfig {
  apiKey:  string
  baseUrl: string
}

function getConfig(): MimoConfig | null {
  const apiKey  = process.env.MIMO_API_KEY
  const baseUrl = process.env.MIMO_BASE_URL ?? 'https://api.mimo.ai/v1'
  if (!apiKey) return null
  return { apiKey, baseUrl }
}

/**
 * Returns a Mimo-backed `LanguageModel`. Throws when MIMO_API_KEY is missing
 * or the adapter has not yet been wired to a real SDK. Both errors should
 * surface to the user as "Mimo not yet configured — falling back to Claude"
 * rather than crashing the route.
 */
export function getMimoModel(model: string): LanguageModel {
  const cfg = getConfig()
  if (!cfg) {
    throw new Error(
      'Mimo not configured — set MIMO_API_KEY in Doppler. ' +
      'See lib/llm/providers/mimo.ts for activation steps.',
    )
  }

  // TODO(task-12): replace with real provider construction.
  // Likely shape (using @ai-sdk/openai-compatible):
  //
  //   import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
  //   const mimo = createOpenAICompatible({
  //     name:    'mimo',
  //     apiKey:  cfg.apiKey,
  //     baseURL: cfg.baseUrl,
  //   })
  //   return mimo(model)
  //
  // First confirm Mimo's actual API shape — pricing page, docs, and a curl
  // smoke test of /v1/chat/completions before flipping the switch.
  throw new Error(
    `Mimo adapter not yet wired (requested model=${model}). ` +
    'Implement getMimoModel() in lib/llm/providers/mimo.ts.',
  )
}

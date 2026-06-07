/**
 * Mimo Pro 2.5 adapter — LIVE (env-gated).
 *
 * Activation plan: switch when the Claude Max subscription ends. Mimo Pro 2.5
 * is a top performer in many areas at a fraction of Claude's price (see the
 * open-orchestration MOC in memory-hq for the comparison atoms).
 *
 * Activation:
 *   1. Sign up at https://mimo.ai, generate an API key
 *   2. Set MIMO_API_KEY (+ optionally MIMO_BASE_URL) in Doppler
 *   3. Set LLM_PROVIDER=mimo in Doppler OR flip via /settings → AI providers
 *
 * Mimo exposes an OpenAI-compatible endpoint, so we use `createOpenAI` with a
 * custom baseURL — same pattern as the OpenRouter / NIM adapters, no new npm
 * dependency. If Mimo's API shape later diverges from the OpenAI contract,
 * swap to a tailored provider here without touching callers.
 *
 * ⚠️ Upstream-contract note: the OpenAI-compatibility + the default baseURL
 * below are assumed from Mimo's published docs. Smoke-test `/chat/completions`
 * with a real key before relying on it for production traffic.
 */

import type { LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

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
 * Returns a Mimo-backed `LanguageModel`.
 *
 * Throws when MIMO_API_KEY is missing — callers in the chat fallback path
 * should catch and surface "Mimo not configured — falling back to Claude"
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

  const mimo = createOpenAI({
    apiKey:  cfg.apiKey,
    baseURL: cfg.baseUrl,
  })

  return mimo(model) as LanguageModel
}

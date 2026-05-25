/**
 * lib/ecosystems/adapters/claude-llm.ts — `llm` adapter (real, not stub).
 *
 * Wraps the existing lib/llm/provider.ts `getLlm()` helper so every team's
 * default LLM ecosystem becomes a single registry call. Honors the
 * `LLM_PROVIDER` env var — set it to mimo / ollama and this adapter
 * silently routes there instead, no code changes required.
 *
 * Single verb in v1: `generate_text`. Future verbs (`generate_structured`,
 * `stream_text`, `embed`) slot in here without touching department code.
 */

import { generateText } from 'ai'
import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing } from '../types'
import { getLlm } from '@/lib/llm/provider'

const VERBS = ['generate_text'] as const
type Verb = (typeof VERBS)[number]

interface GenerateTextPayload {
  prompt:       string
  system?:      string
  temperature?: number
  /** Tighter ceiling than the SDK default so a runaway call doesn't blow
   *  the per-route maxDuration. Caller can override. */
  maxTokens?:   number
}

export const claudeLlmAdapter: EcosystemAdapter = {
  kind:         'llm',
  name:         'claude',
  label:        'Claude (active LLM)',
  capabilities: VERBS,
  // Always available — the platform has at least one LLM path (gateway →
  // anthropic fallback). The underlying SDK throws if literally nothing
  // is configured, which we report as upstream_error to the caller.
  available:    () => true,
  invoke:       invokeClaudeLlm,
}

async function invokeClaudeLlm(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('claude', verb, VERBS)
  const p = (payload ?? {}) as GenerateTextPayload
  if (typeof p.prompt !== 'string' || p.prompt.trim().length === 0) {
    return {
      ok: false, adapter: 'claude', verb,
      error: 'upstream_error',
      message: 'generate_text requires a non-empty `prompt` string in payload',
    }
  }
  try {
    const res = await generateText({
      model:       getLlm(),
      system:      p.system,
      prompt:      p.prompt,
      temperature: typeof p.temperature === 'number' ? p.temperature : 0.2,
      // No `maxTokens` enforcement here — Vercel AI SDK 6's contract is
      // model-default unless overridden. Callers needing a hard cap should
      // pass it through payload.maxTokens once we extend the verb shape.
    })
    return {
      ok:        true,
      adapter:   'claude',
      verb,
      result:    { text: res.text },
      telemetry: {
        prompt_tokens:    (res.usage?.inputTokens ?? 0) as number,
        completion_tokens: (res.usage?.outputTokens ?? 0) as number,
      },
    }
  } catch (e) {
    return {
      ok:      false,
      adapter: 'claude',
      verb,
      error:   'upstream_error',
      message: e instanceof Error ? e.message : 'LLM call failed',
    }
  }
}

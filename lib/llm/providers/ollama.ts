/**
 * Ollama local-LLM adapter — STUB.
 *
 * Purpose: cheap smoke tests for prompt/agent logic without burning Claude
 * Max budget. Local-only — Ollama runs on the same KVM as the rest of the
 * lean stack (or on the developer's machine for dev).
 *
 * To activate this adapter:
 *   1. Run an Ollama instance:
 *      - Coolify app from the `ollama/ollama` image, attached to the
 *        `coolify` network with alias `ollama` (see services/lean-deploy/
 *        README.md), or
 *      - `brew install ollama && ollama serve` locally
 *   2. Pull a model: `ollama pull llama3.3` (or any other)
 *   3. Set OLLAMA_BASE_URL in Doppler (default: http://localhost:11434)
 *   4. Replace the throw in `getOllamaModel` with the real factory
 *   5. Set LLM_PROVIDER=ollama in Doppler
 *
 * The community provider `ollama-ai-provider` works with AI SDK 6 — the
 * activation step is essentially `npm install ollama-ai-provider` and a
 * one-line factory call.
 */

import type { LanguageModel } from 'ai'

export interface OllamaConfig {
  baseUrl: string
}

function getConfig(): OllamaConfig {
  return {
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  }
}

/**
 * Returns an Ollama-backed `LanguageModel`. Throws until activation —
 * callers in the chat fallback path should catch and downgrade to Claude.
 */
export function getOllamaModel(model: string): LanguageModel {
  const cfg = getConfig()

  // TODO(task-13): replace with real provider construction.
  // Likely shape:
  //
  //   import { createOllama } from 'ollama-ai-provider'
  //   const ollama = createOllama({ baseURL: cfg.baseUrl })
  //   return ollama(model)
  //
  // Smoke-test against a running Ollama before flipping LLM_PROVIDER=ollama.
  throw new Error(
    `Ollama adapter not yet wired (requested model=${model}, baseUrl=${cfg.baseUrl}). ` +
    'Implement getOllamaModel() in lib/llm/providers/ollama.ts.',
  )
}

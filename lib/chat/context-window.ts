/**
 * lib/chat/context-window.ts — model context-window math + token estimation.
 *
 * Replaces the old hard-coded `MAX_TURN_CHARS = 32_000` cap (which was a
 * tiny fraction of any modern model's actual context — Claude Code
 * Desktop comfortably uses 200k tokens per session). The chat surfaces
 * now report "context used as % of model context window" instead of a
 * char count, matching the Claude Code Desktop bottom-right indicator.
 *
 * Token estimation: rough ~4 chars/token. Accurate enough for budgeting;
 * Anthropic's official token counter (`messages.count_tokens` API) is
 * more accurate but requires a round trip per check. The 4× heuristic
 * is good to within ~10% for English prose / code and consistently
 * over-estimates (i.e. errs on the safe side of the cap).
 *
 * Per-model context windows are declared in MODEL_REGISTRY. Anthropic
 * publishes these in their docs; we copy them in (and link in code
 * comments). Tune as new models ship.
 */

export interface ModelInfo {
  /** Alias used as the agent's `model` field in our gateway dispatch. */
  alias:           string
  /** Display name shown in the UI. */
  display:         string
  /** Total context-window size in tokens, per Anthropic docs. */
  contextTokens:   number
  /** Approximate budget for INPUT (system prompt + transcript). Leaves
   *  headroom for the agent's output + tool calls. */
  inputBudget:     number
}

/**
 * Per-Anthropic-docs (as of 2026-05):
 *   - Sonnet 4.x / Opus 4.x — 200k context window
 *   - Haiku 4.x             — 200k context
 *   - Future 1M-context models would land here too
 *
 * Default input budget = 75% of context. Output gets ~25% headroom which
 * is enough for the biggest single response Opus typically produces.
 */
export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  'opus':              { alias: 'opus',              display: 'Claude Opus',    contextTokens: 200_000, inputBudget: 150_000 },
  'opus-4':            { alias: 'opus-4',            display: 'Claude Opus 4',  contextTokens: 200_000, inputBudget: 150_000 },
  'sonnet':            { alias: 'sonnet',            display: 'Claude Sonnet',  contextTokens: 200_000, inputBudget: 150_000 },
  'sonnet-4-6':        { alias: 'sonnet-4-6',        display: 'Claude Sonnet 4.6', contextTokens: 200_000, inputBudget: 150_000 },
  'sonnet-4-7':        { alias: 'sonnet-4-7',        display: 'Claude Sonnet 4.7', contextTokens: 200_000, inputBudget: 150_000 },
  'haiku':             { alias: 'haiku',             display: 'Claude Haiku',   contextTokens: 200_000, inputBudget: 150_000 },
  'haiku-4-5':         { alias: 'haiku-4-5',         display: 'Claude Haiku 4.5', contextTokens: 200_000, inputBudget: 150_000 },
  'gpt-5.5-codex':     { alias: 'gpt-5.5-codex',     display: 'GPT-5.5 Codex',  contextTokens: 200_000, inputBudget: 150_000 },
}

const DEFAULT_MODEL: ModelInfo = MODEL_REGISTRY['opus']

/**
 * Resolve a model alias to its ModelInfo. Loose match — case-insensitive,
 * substring-tolerant. Falls back to the default (Opus 200k) on no match.
 */
export function resolveModel(alias?: string | null): ModelInfo {
  if (!alias) return DEFAULT_MODEL
  const a = alias.toLowerCase()
  if (MODEL_REGISTRY[a]) return MODEL_REGISTRY[a]
  for (const key of Object.keys(MODEL_REGISTRY)) {
    if (a.includes(key)) return MODEL_REGISTRY[key]
  }
  return DEFAULT_MODEL
}

/**
 * Rough char→token estimate. 4 chars per token is the canonical
 * heuristic for English prose; consistently over-estimates for code
 * (which has more punctuation per token) so erring on the safe side of
 * the cap.
 *
 * If we ever need precise counts, call Anthropic's
 * `messages.count_tokens` API — but that's a round trip per check, and
 * for budgeting purposes 10% over-estimation is fine.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export interface ContextUsage {
  model:           ModelInfo
  tokensUsed:      number
  inputBudget:     number
  contextTokens:   number
  /** % of inputBudget used (UI shows this as the primary number). */
  inputUsedPct:    number
  /** % of the full context window used (informational). */
  contextUsedPct:  number
  /** True when over the input budget — agent will refuse the dispatch. */
  overBudget:      boolean
}

export function computeUsage(text: string, modelAlias?: string | null): ContextUsage {
  const model      = resolveModel(modelAlias)
  const tokensUsed = estimateTokens(text)
  return {
    model,
    tokensUsed,
    inputBudget:    model.inputBudget,
    contextTokens:  model.contextTokens,
    inputUsedPct:   (tokensUsed / model.inputBudget)  * 100,
    contextUsedPct: (tokensUsed / model.contextTokens) * 100,
    overBudget:     tokensUsed > model.inputBudget,
  }
}

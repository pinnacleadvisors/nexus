/**
 * Model registry for the chat composer's model dropdown.
 *
 * Phase 1 of task_plan-collaborative-chat.md (PR #285). The operator's
 * answer to question #4 was "include all connected models" — this file is
 * the source of truth for that whitelist. Adding a model = one entry here.
 *
 * What "connected" means in practice today: the claude-gateway runs the
 * official Anthropic `claude` CLI bound to whichever model OAuth gives it
 * (Opus 4.7 by default), so any Anthropic-family model the CLI accepts is
 * "connected" via the gateway's `--model <slug>` flag. Codex direct is a
 * separate dispatch path (see `lib/chat/codex-direct-dispatch.ts`). Other
 * providers (MIMO, Ollama local) are wired to the Nexus app's env but not
 * yet to the chat surface — they'd need their own dispatch wiring before
 * being added here.
 *
 * For Phase 1, the safe-and-shippable list is: 3 Claude models + Codex.
 * Future phases can extend by:
 *   - adding the model id here,
 *   - confirming the underlying provider accepts `modelOverride`,
 *   - shipping any new dispatch path.
 */

export type ChatModelProvider = 'claude' | 'codex'

export interface ChatModel {
  /**
   * Stable id the UI selector + API body carry. For Claude models this is
   * the exact slug `claude -p --model <id>` accepts. For codex-direct it's
   * a sentinel that routes through the codex dispatch path.
   */
  id:       string
  /** Short human label for the chip. Keep ≤10 chars so the composer footer doesn't wrap. */
  label:    string
  /** Longer descriptor shown in the dropdown's hover state. */
  hint?:    string
  provider: ChatModelProvider
}

/**
 * The base whitelist. Order matters — first entry is the default when the
 * operator has no localStorage preference for the current chat surface. This
 * static list is the always-present baseline; /api/models/available merges any
 * NEWER Claude models discovered from the Anthropic models API on top (see
 * lib/chat/model-discovery.ts) so a fresh release shows up without a code edit.
 *
 * Keep the newest Opus first: matches "use the biggest model for copilot work"
 * + becomes the default. Bump this when a new flagship ships (the discovery
 * merge surfaces it in the dropdown either way, but the DEFAULT is pinned here).
 */
export const AVAILABLE_MODELS: readonly ChatModel[] = [
  { id: 'claude-opus-4-8',   label: 'Opus 4.8',   hint: 'Anthropic Claude Opus 4.8 — the latest + biggest Claude model. Best for hard reasoning + multi-step plans.', provider: 'claude' },
  { id: 'claude-opus-4-7',   label: 'Opus 4.7',   hint: 'Anthropic Claude Opus 4.7 — previous flagship. Still strong for hard reasoning + multi-step plans.', provider: 'claude' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: 'Anthropic Claude Sonnet 4.6 — faster + cheaper. Good for routine investigations + small edits.',  provider: 'claude' },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5',  hint: 'Anthropic Claude Haiku 4.5 — fastest + cheapest. Good for single-action follow-ups.',              provider: 'claude' },
  { id: 'codex-direct',      label: 'Codex 5.5',  hint: 'OpenAI Codex 5.5 via the codex-gateway. Faster code edits, no typed-block support.',                provider: 'codex'  },
] as const

export const DEFAULT_MODEL_ID = AVAILABLE_MODELS[0].id

/** Look up a model by id; returns the default if id is unknown (defensive). */
export function getModelById(id: string | null | undefined): ChatModel {
  if (!id) return AVAILABLE_MODELS[0]
  return AVAILABLE_MODELS.find(m => m.id === id) ?? AVAILABLE_MODELS[0]
}

/** Whitelist used by the gateway's `messageBodySchema` to reject unknown values. */
export const MODEL_ID_WHITELIST: readonly string[] = AVAILABLE_MODELS.map(m => m.id)

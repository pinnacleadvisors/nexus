/**
 * Chat permission mode registry.
 *
 * Phase 1 of task_plan-collaborative-chat.md (PR #285). Three modes:
 *
 *  - **ask** (default) — the agent emits an `approval-request` block before
 *    any destructive action and waits for the operator's APPROVAL reply.
 *    Matches the existing platform-copilot behaviour pre-Phase-1.
 *
 *  - **plan** — the agent proposes a plan (`edit-plan` block or prose), then
 *    explicitly ends the turn. Never executes — even pre-approved file edits.
 *    Useful when the operator wants to think before any mutation lands.
 *
 *  - **auto** — the agent skips `approval-request` for *non-destructive*
 *    actions (read-only investigations, draft PR creation, file edits in
 *    worktrees) and proceeds. The five operator-only categories (deploys,
 *    money movement, customer-facing sends, env writes, secret rotation)
 *    STILL gate through approval-request regardless of mode — that's a
 *    hard constraint per [AGENTS.md](AGENTS.md).
 *
 * The agent reads the operator's pick via `process.env.NEXUS_CHAT_MODE` at
 * turn start. The dispatch routes pass it through as a per-turn env override.
 *
 * Per operator decision (PR #285 Q2): autonomous agents like business-operator
 * are "always auto" and the UI should hide the dropdown when the chat surface
 * is rendering one of those. This is enforced client-side (the dropdown
 * doesn't render when `surfaceSupportsModes === false`).
 */

export type ChatMode = 'ask' | 'plan' | 'auto'

export interface ChatModeOption {
  id:    ChatMode
  label: string
  hint:  string
}

export const AVAILABLE_MODES: readonly ChatModeOption[] = [
  {
    id:    'ask',
    label: 'Ask',
    hint:  'Default. The agent asks for approval before each destructive action via an inline card.',
  },
  {
    id:    'plan',
    label: 'Plan',
    hint:  'The agent proposes a plan and stops. Nothing is executed — even file edits.',
  },
  {
    id:    'auto',
    label: 'Auto',
    hint:  'Non-destructive actions fire without approval. The five operator-only categories (deploys / money / customer-facing / env / secrets) STILL gate.',
  },
] as const

export const DEFAULT_MODE: ChatMode = 'ask'

export const MODE_WHITELIST: readonly ChatMode[] = AVAILABLE_MODES.map(m => m.id)

/** Look up a mode option by id; returns the default if unknown. */
export function getModeOption(id: string | null | undefined): ChatModeOption {
  if (!id) return AVAILABLE_MODES[0]
  return AVAILABLE_MODES.find(m => m.id === id) ?? AVAILABLE_MODES[0]
}

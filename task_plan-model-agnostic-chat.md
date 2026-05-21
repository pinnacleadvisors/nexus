# Model-agnostic chat — schema-first typed-block emission

Today the streaming chat copilots (`platform-copilot`, `business-copilot`) are Claude-shaped end-to-end: system prompts in `.claude/agents/*.md` tell Claude to emit `<iteration-plan>...</iteration-plan>` XML-ish blocks, the dispatch routes hit `claude-gateway`, and per-block parsers in `lib/chat/{iteration-plan,approval,manual-task,edit-plan,bug-hunt-finding}.ts` regex out the structure. Provider lock-in is total.

This plan replaces the text-parse layer with a **schema-first emission contract** — each typed block becomes a Zod schema that every provider can emit via its native structured-output primitive (Claude `tool_use`, OpenAI `response_format`, Gemini `response_schema`). The chat UI keeps the same wire shape; only the path from prompt → JSON becomes provider-agnostic.

A pragmatic stub (**Task M0** — "Phase 0") ships separately and immediately: a per-session execution provider dropdown that routes some turns through `codex-gateway` for cost savings, accepting that typed blocks are unreliable on Codex until M1-M7 land. The stub is throwaway-by-design — M9 absorbs it once the schema work is real.

## North Star

**Goal:** Any provider Nexus supports (Claude, GPT-5.5, future Gemini / Mistral / local) can power streaming chat copilots without per-model parser maintenance. The chat UI's typed-block contract becomes a stable API decoupled from any single vendor's natural-output idioms.

**Success criteria:**
- Every typed block (`iteration-plan`, `approval-request`, `edit-plan`, `edit-group-complete`, `manual-task`, `bug-hunt-finding`) has a Zod schema in `lib/chat/blocks/schemas.ts` that is the **single source of truth** for both system-prompt examples AND server-side parsing.
- A `dispatchTurn({provider, messages, blockSchemas})` function in `lib/ai/dispatch.ts` abstracts Claude and OpenAI behind one interface, returning the same normalized result shape regardless of provider.
- A pilot business chat conversation runs successfully against `provider='openai'` with no UI degradation — every block type renders with the same visual fidelity as on Claude.
- Per-session provider preference (M0's UI) is now backed by real schema-based emission rather than a degraded raw-text path.
- Adding a third provider (Gemini, Mistral) requires writing one adapter file (~80 lines) — no parser, no system-prompt fork, no UI change.

**Hard constraints:**
- No regression to the existing operator-gated loop pattern, `approval_gates`, or approval-card rendering.
- No mutation of stored chat history shape — sessions written on Claude must render identically after M3-M7 land.
- The text-parse fallback stays for one release cycle behind a `CHAT_TEXTBLOCK_FALLBACK=1` flag so we can revert per-block if structured-output emission misfires in production.
- Tool-use telemetry (the `Wrench → CheckCircle` cards) is preserved on both providers — Claude via `tool_use` events, OpenAI via `function_call` events. Both normalize into the existing `ToolCall` shape.

## Phase 1 — Explore (2026-05-21, done in chat)

Already mapped: chat copilot routing hardcodes Claude ([app/api/platform-chat/route.ts:268](app/api/platform-chat/route.ts:268), [app/api/businesses/[slug]/chat/route.ts:157](app/api/businesses/[slug]/chat/route.ts:157)), system prompts in `.claude/agents/{platform,business}-copilot.md`, parsers in `lib/chat/`. AI SDK 6 (`ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai`) is already in package.json with `streamText`, `streamObject`, `generateObject` available. Codex gateway exists at `services/codex-gateway/` and dispatches via `lib/codex/` — confirm shape in Task M2.

## Phase 2 — Plan

### Task M0 — Per-session execution-provider toggle (PHASE 0, ships separately)

- **Files:** `app/api/platform-chat/route.ts`, `app/api/businesses/[slug]/chat/route.ts`, new client-side dropdown component (likely beside the existing chat header), `lib/codex/chat-dispatch.ts` (or wraps existing helpers).
- **Change:** Add a `provider: 'claude' | 'codex'` query param (or body field) on the chat enqueue route. Defaults to `claude`. When `codex` is selected, route the turn through `codex-gateway` with the existing system prompt. **Accepts** that typed blocks (iteration-plan, approval-request, etc.) will emit inconsistently — the dropdown UI labels Codex as "experimental — typed blocks may not render".
- **Verify:** Flip a single chat turn to `codex` in dev; confirm the response renders as a plain text bubble (no card scaffolding) and a `gateway_turns` row lands with `plan='codex-pro'`.
- **Throwaway:** This task ships its own PR (#245-ish), is integrated into M9, and the raw-text fallback path is removed once M3-M7 have a stable schema emission.
- **Parallel:** no (sequenced first per operator directive — cost savings now).

### Task M1 — Define every typed-block schema in Zod (foundation)

- **Files:** `lib/chat/blocks/schemas.ts` (new), `lib/chat/blocks/index.ts` (re-export), unit tests in `lib/chat/blocks/__tests__/`.
- **Change:** One Zod schema per block: `iterationPlanSchema`, `approvalRequestSchema`, `editPlanSchema`, `editGroupCompleteSchema`, `manualTaskSchema`, `bugHuntFindingSchema`. Each schema is the single source of truth for:
  1. The TypeScript type the parser returns (`z.infer<typeof iterationPlanSchema>` replaces the hand-written `IterationPlan` interface).
  2. The JSON schema generated for OpenAI `response_format` / Claude `tool_use` (via `zod-to-json-schema`).
  3. The system-prompt example block (generated from the schema at build time — see M2).
- **Verify:** Round-trip test — synthesize a valid block instance, serialize as JSON, re-parse via the schema, assert deep equality. Negative test — malformed JSON fails parse cleanly.
- **Parallel:** no (M2-M7 all depend on these).

### Task M2 — Provider abstraction in `lib/ai/dispatch.ts`

- **Files:** `lib/ai/dispatch.ts` (new), `lib/ai/providers/anthropic.ts` (new, wraps existing claude-gateway), `lib/ai/providers/openai.ts` (new, uses `@ai-sdk/openai` + `codex-gateway` for plan-billed calls).
- **Change:** Single function `dispatchTurn({provider, messages, blockSchemas, businessSlug, userId, sessionTag})` that returns `Promise<{ ok, blocks, displayText, toolCalls, usage }>`. Internally:
  - **Anthropic adapter**: enqueue via `enqueueGatewayJob`, poll via `getGatewayJob`, parse text → blocks via M1 schemas (legacy fallback) OR parse `tool_use` events when the agent spec is updated to emit blocks as tool calls (M3+).
  - **OpenAI adapter**: call via `streamText` from AI SDK 6 with `tools` populated from M1 schemas. Each block becomes a tool definition; emission becomes a `tool_call` the adapter normalizes.
- **Verify:** Mock-based unit tests per adapter. Integration test that dispatches the same prompt to both providers and asserts the response normalizes to the same `{blocks, displayText}` shape.
- **Parallel:** yes (depends on M1; blocks M3-M7).

### Task M3 — Migrate `iteration-plan` to schema-based emission

- **Files:** `.claude/agents/{platform,business}-copilot.md` (update prompt to instruct schema-based emission via `tool_use`), `lib/chat/iteration-plan.ts` (add schema-path; keep legacy text-parse behind `CHAT_TEXTBLOCK_FALLBACK=1`), `app/api/{platform-chat,businesses/[slug]/chat}/poll/route.ts` (consume blocks from `result.blocks` when present, fall back to text-parse otherwise).
- **Change:** First block migrated end-to-end. Establishes the pattern the next four follow. Adds a `provider:'claude'|'openai'` dimension to the block-emission instructions so each provider's adapter knows what to expect.
- **Verify:** Run the bug-hunt loop's iteration-plan emission on both providers in a sandbox business. Verify both produce identical normalized output. A/B for 1 week before removing text-parse.
- **Parallel:** no (template for M4-M7; finish M3 before starting the next).

### Task M4 — Migrate `approval-request`

- Same shape as M3.
- The trickiest one — approval cards drive operator gates. Misemission means a turn that should pause for approval silently auto-proceeds.
- **Extra safeguard:** On the approval block specifically, refuse to ack an approval whose schema didn't round-trip; block the turn instead and surface a "schema mismatch" warning to the operator.

### Task M5 — Migrate `edit-plan` + `edit-group-complete`

- Pair migration — same chat block family.
- **Risk:** these blocks reference file paths and line numbers. Schema enforces shape but not content validity (e.g. a hallucinated path). M5 leaves content-validation where it is (manual operator gate via approval card).

### Task M6 — Migrate `manual-task`

- Smaller scope — `manual-task` only writes a row in `operator_tasks`. Less downstream impact than approval / edit-plan.
- Good "warm-up" if M3 reveals adapter issues.

### Task M7 — Migrate `bug-hunt-finding`

- Last block migration. Loops back to the bug-hunt agent flow validated in M3.
- **Cleanup:** Once M7 lands and the A/B window passes, remove the text-parse code paths entirely and drop the `CHAT_TEXTBLOCK_FALLBACK` env var.

### Task M8 — Codex-shaped copilot agent specs

- **Files:** `.claude/agents/platform-copilot-codex.md` (new), `.claude/agents/business-copilot-codex.md` (new).
- **Change:** Same behavior contract as the Claude versions, system prompt tuned for GPT-5.5's idioms. Block emission goes through the M2 OpenAI adapter via function-calling.
- **Verify:** End-to-end pilot — operator picks Codex from the M0 dropdown, runs 10 multi-turn conversations, every block renders identically to the Claude path.
- **Parallel:** yes (depends on M2 + at least M3 to know the emission shape works).

### Task M9 — Promote M0 dropdown to first-class routing

- **Files:** `components/chat/ProviderToggle.tsx` (new — replaces M0's stub), `app/api/{platform-chat,businesses/[slug]/chat}/route.ts`, `lib/ai/dispatch.ts`.
- **Change:** Replaces M0's "experimental" disclaimer with a real per-session preference (Claude / Codex / auto). Auto-mode reads the operator's provider prefs (PR #242) + the business default + a small static cost-quality heuristic.
- **Verify:** Per-session preference persists across reloads. Switching mid-session is honored from the next turn forward (in-flight turn finishes on the original provider).
- **Parallel:** no (depends on M2 + M8).

### Task M10 — Provider-strength router (optional, later)

- **Files:** `lib/ai/strength-router.ts` (new), small UI affordance on the chat header showing the auto-picked provider with reasoning.
- **Change:** Auto-route per task type — code-heavy turns to GPT-5.5 (better SWE-bench), reasoning-heavy to Claude Opus (better LiveBench), high-frequency operational ticks to Haiku / GPT-5 mini.
- **Verify:** A/B: random 50% of operator chats get auto-routing for 1 month. Track per-route success rate + operator override rate. If auto-routing's override rate exceeds 30%, it's worse than fixed; tune or revert.
- **Parallel:** yes (depends on M9 + a meaningful corpus of historical turns).

## Out-of-scope (explicit)

- **Gemini / Mistral / local-model adapters** — frame the architecture so adding them is one file; don't ship them in this initiative.
- **Voice / vision multimodal chat** — different UI surface, different schema set. Separate plan.
- **Per-turn cost-aware routing** — covered conceptually by M10 but specifically deferred until we have ≥1 month of paired-provider data from M3-M9.
- **Replacing AI SDK 6 with a custom abstraction** — AI SDK 6's `streamText` / `streamObject` already cover 80% of what we need. Build adapters around it, don't replace it.

## Sequencing

```
Week 1     M0 (Phase 0 toggle, ships separately as PR #245-ish)
Week 1-2   M1 (schemas) + M2 (adapter)   ← parallel; foundation
Week 3     M3 (iteration-plan)            ← pattern lock-in
Week 4     M4 (approval-request)          ← highest-risk migration
Week 5     M5 (edit-plan)
Week 5-6   M6 (manual-task)               ← parallel with M5
Week 6     M7 (bug-hunt-finding) + remove text-parse fallback
Week 6-7   M8 (Codex copilot agents)
Week 7     M9 (promote M0 to first-class routing)
Later      M10 (auto-strength router)
```

Total ~7 calendar weeks if sequenced; ~5 weeks with M3-M7 parallelized after the M2 adapter is stable. Each task lands its own PR. M0 ships day-one as the throwaway stub so cost savings start immediately.

## Progress

_None yet — plan written 2026-05-21. M0 (the Phase 0 throwaway) is the first PR in flight; everything else awaits the operator's approval on the design._

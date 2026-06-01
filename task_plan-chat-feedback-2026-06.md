Goal: Resolve the 4 chat-feature feedback items (2026-06-01) so the operator can run Nexus cheaply on subscription billing and start building businesses.
Success criteria:
- node-pty: a clear, evidence-backed confirmation of whether chat turns are billed at the Max-subscription rate (not API rate); the settings UI stops misleading about the `node-pty` option.
- models: `claude-opus-4-8` is selectable + the default; a mechanism exists so future model releases surface without a code edit.
- codex: the timeout chain is fixed so a real 2–5 min `codex exec` task completes when invoked from platform-copilot; every affected area is enumerated.
- approval: the "Provision … (N items)" card no longer re-appears after approval/completion or on reload, on BOTH platform-copilot and business-copilot chat; proven by a unit test + a Playwright spec.
Hard constraints:
- No destructive writes to the real Supabase during testing (mock / unit-test the client logic; no real business provisioning).
- The subscription-billing path must not regress to API billing.
- `npm run check:all` passes (tsc, retry-storm, topology, provider-agnostic, agent-spec-freshness, cron-route, codeql-patterns).
- Write-size discipline (≤300 lines / 10 KB per Write/Edit).

---

## Phase 1 — Explore (DONE)

### Issue 1 — node-pty / subscription billing (PRIORITY)
- `services/claude-gateway/src/spawn.ts:115` always uses `claude -p` (print mode) via `child_process.spawn`. There is NO node-pty path.
- Billing is auth-determined, NOT `-p`-determined. spawn.ts:236-240 deletes `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`CLAUDE_CODE_USE_BEDROCK`/`CLAUDE_CODE_USE_VERTEX` from the child env → the CLI falls back to OAuth creds (`CLAUDE_CODE_OAUTH_TOKEN` or `/root/.claude/.credentials.json`) = **Max-subscription billing**.
- `claude --help` confirms: `--bare` says "OAuth and keychain are never read" → normal (non-bare) mode DOES read OAuth. The gateway does not pass `--bare`. So `-p` + OAuth = subscription billed. ✅
- `lib/user-secrets.ts:94` defines `ExecutionMode = 'subscription' | 'api' | 'node-pty'`, but `app/api/provider-prefs/route.ts:34` + `components/settings/ProviderPreferencesPanel.tsx:128` say node-pty is **metadata-only (Task G2 pending)** — the setting does nothing today.
- CONCLUSION: subscription billing is already in effect; node-pty is unnecessary for billing. Action = confirm empirically + make the UI honest. (NOT implement node-pty — no billing benefit, adds a native dep.)

### Issue 2 — models / Opus 4.8
- `lib/chat/models.ts` is the chat-composer whitelist: opus-4-7 (default), sonnet-4-6, haiku-4-5, codex-direct. Hardcoded.
- Model id flows: ModelSelector → localStorage → enqueue `modelOverride` → `lib/claw/gateway-jobs.ts:132` → gateway `--model`.
- When NO override is sent, the gateway omits `--model` and the CLI uses the OAuth-bound default — which Anthropic updates server-side. So the DEFAULT already tracks latest; only the explicit list is stale.
- `claude --model` accepts an ALIAS ("opus"/"sonnet") that auto-resolves to the latest — a zero-maintenance auto-update lever.
- No dynamic discovery exists. `lib/models/catalog.ts` is a separate hardcoded benchmark catalog (used by `lib/ai/dispatch.ts` smart routing).

### Issue 3 — codex-gateway timeout
- Root cause: `services/codex-gateway/src/index.ts` passes `REQUEST_MAX_MS` (120s) as `runCodex` `timeoutMs` for the async `/api/jobs` path (line 366) too — so the gateway SIGTERMs codex at 2 min, while real `codex exec` takes 2–5 min.
- The MCP delegate (`services/mcp-codex-delegate/src/index.ts:73`) polls for 5 min — so the operator sees "codex job errored: codex CLI timeout after 120000ms" at ~2 min.
- The chat-pill codex-direct path (`lib/chat/codex-direct-dispatch.ts:84`) uses 30s — too short for any real work.
- Affected areas: platform-copilot `delegate_to_codex`, codex-direct chat pill, dispatch route codex path, codex-maintainer-tick cron, solopreneur-loop / business-operator / bug-hunt-loop (all route through the same dispatch), create-business consultation.

### Issue 4 — persistent approval card (CONFIRMED ROOT CAUSE)
- `parseAssistantMessage` extracts approval-request blocks; `persist-completed-turn.ts:356` persists ONLY `approval_requests` into message metadata — never a resolution.
- `handleApproval` (PlatformChat.tsx:427) writes `message.approval_resolutions` into **local React state only** — never persisted, never re-derived on reload.
- The inline render (PlatformChat.tsx:1270, BusinessChat.tsx:1006) + `pickPendingAction` (lib/chat/action-bar.ts:87) both read that ephemeral per-message state.
- CONTRAST: edit-plan + edit-self resolutions are **derived from history** via `computeEditPlanResolutions`/`computeEditSelfResolutions` (scan `APPROVAL [<id>]:` replies) → they survive reload + re-emit. approval-request is the ONLY block type never migrated to that pattern.
- Result: on reload OR if the same approval_id appears in a later message (re-emit / completion turn), the card resurfaces as unresolved. Fix = add `computeApprovalResolutions` (history-derived) and use it in both render + pickPendingAction, on both chat surfaces.

---

## Phase 2 — Plan (atomic tasks)

(filled after operator confirms scope decisions — see "Open scope decisions" below)

### Scope decisions (operator answered 2026-06-01)
1. Models: **Both** — add `claude-opus-4-8` + live `/api/models/available` discovery (Anthropic /v1/models merge, static fallback).
2. node-pty: **Actually implement it.** Operator says a RECENT Claude subscription change makes `-p` (headless) bill at API rate, not subscription — this is why node-pty was added as an option. ⇒ Research current billing facts first (save to memory), then implement a real node-pty (pseudo-terminal, no `-p`) execution path in the claude-gateway, wired to the `execution_mode` pref.
3. Verification: **Also drive real backend** — unit + mocked Playwright AND `doppler run -- npm run dev` against real Supabase/gateway with a real dummy business consultation, cleaning up after.

### Atomic tasks
- T1 (research): current Claude Code `-p`/headless billing vs subscription; node-pty pattern; `CLAUDE_CODE_OAUTH_TOKEN` status. Save memory atom(s). Parallel: no (blocks T2).
- T2 (node-pty): real pty spawn path in claude-gateway gated by execution_mode; wire pref → dispatch → gateway. Parallel: no.
- T3 (approval): `lib/chat/approval-resolutions.ts` `computeApprovalResolutions` (pure) + use in render + `pickPendingAction`, both PlatformChat + BusinessChat. Unit test + Playwright spec. Parallel: yes (independent of T2/T4).
- T4 (models): add 4.8 to `lib/chat/models.ts` + `lib/models/catalog.ts`; `lib/chat/model-discovery.ts` + `/api/models/available`; ModelSelector fetches w/ static fallback. Unit test merge. Parallel: yes.
- T5 (codex): split async-job timeout (`JOB_TIMEOUT_MS`, ~8min) from sync `REQUEST_MAX_MS`; align MCP delegate budget; bump codex-direct. Parallel: yes.
- T6 (verify): check:all + unit tests + real-backend dev run + Playwright.

## Progress (as of 2026-06-01)
### Completed
- [x] Phase 1 explore — all 4 root causes identified with file:line evidence.
### Remaining
- [ ] Confirm scope decisions, then Phase 2/3 per issue.

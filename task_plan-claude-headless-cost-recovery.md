# Claude headless cost recovery (gateway PTY-mode)

Anthropic changed the billing semantics of `claude -p` (non-interactive / "headless" mode) so dispatched calls now bill at API rates rather than against the Claude Max subscription quota. Our `services/claude-gateway/` spawns `claude -p --output-format stream-json` on every dispatch — that means every `business-operator`, `solopreneur-loop`, `codex-maintainer`, `pdf-swarm-lead`, and inline managed-agent call now bills at full API price. The 20x Max plan amortization thesis behind the gateway is broken until we route at least the high-volume cycles through a subscription-billed code path.

The workaround proposed on Reddit (driving an interactive `claude` session via `tmux send-keys` + a hook to detect completion) is mechanically viable. The cleanest in-process equivalent for a Node service is **node-pty**, which gives a structured pseudo-terminal we can write to and read from without shell glue. Either approach uses the **interactive** Claude flow that the subscription pays for.

This plan does NOT commit us to the migration. Task G1 measures the cost regression first — if the cost delta turns out to be ≤2× (e.g. because cache reads stay subscription-free), we may decide the PTY path's regressions aren't worth it.

## North Star

**Goal:** Restore subscription-billed execution for at least the high-volume gateway dispatch paths (solopreneur-loop ticks, codex-maintainer ticks, scheduled cron jobs) without losing the ability to dispatch via `-p` for paths that need stream-json telemetry.

**Success criteria:**
- A measured baseline: $/dispatch on `-p`-mode at API rates, and a separate measurement on PTY-mode under the subscription.
- A hybrid `executionMode: 'p-mode' | 'pty-mode'` switch in `services/claude-gateway/src/spawn.ts`. Default unchanged (`p-mode`); callers opt-in.
- One pilot call site (`solopreneur-loop` or `codex-maintainer`) flipped to `pty-mode` with measurably reduced cost over ≥1 week.
- A clean fall-back: if the PTY child gets stuck or returns malformed output, the gateway retries that single dispatch on `p-mode` rather than failing.

**Hard constraints:**
- No regression on `-p`-mode call sites that depend on stream-json telemetry (chat UI's tool-call cards, token usage metrics, sessionId continuity).
- No persistent context bleed between dispatches in a pooled PTY process (`/clear` between requests, or fresh process per request).
- No bypass of the existing permission-broker (PR #189) — PTY-mode must still surface `mcp__permission-broker__permission_prompt` to the broker via the same MCP path.
- No silent automation of consent-required actions. The TOS line is: human approval at strategic gates. Don't move that line.
- This is a build-on-top, not a replace. `p-mode` keeps working forever.

## Phase 1 — Explore (2026-05-20, done in chat)

Confirmed gateway uses `claude -p --output-format stream-json --verbose --max-turns 25` with `--mcp-config /root/.claude/settings.json --strict-mcp-config` (see [services/claude-gateway/src/spawn.ts:92-108](services/claude-gateway/src/spawn.ts:92)). The stream-json terminal `result` event carries `total_cost_usd` and `usage` — that's how today's telemetry works. Interactive mode does NOT emit stream-json; output is rendered to the TTY with ANSI escape codes intended for human display.

Open question we cannot answer without running G1: does the cache-hit pricing under `-p`-mode still benefit from the Max plan, or is it now full API price including cache reads? The Reddit post implies the latter but is a single data point. Don't migrate until we measure.

## Phase 2 — Plan

### Task G1 — Measure the cost regression (prerequisite spike)

- **Files:** `scripts/measure-dispatch-cost.ts` (new, gitignored if needed), no production code change.
- **Change:** Pick 5 representative dispatches (one each from: `business-operator` daily tick, `solopreneur-loop` cycle, `pdf-swarm-lead` decomposition, a chat turn through `platform-copilot`, a `codex-maintainer` health pass). Run each 3× through the existing `p-mode` gateway. From the `result` event, capture `total_cost_usd`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`. Compute mean $/dispatch and project monthly cost at current dispatch volume (pull from `run_events` count by `dispatch_type` over the last 30 days).
- **Verify:** Output a single markdown report at `docs/cost/claude-p-mode-cost-2026-05-MM.md` with: (a) measured $/dispatch by dispatch type, (b) projected $/month at current volume, (c) the prior-month Claude Max plan cost (~$200), (d) verdict: migrate / hybrid / no action.
- **Parallel:** no — gates every subsequent task.
- **Owner expectation:** ~2 hours. Pure measurement, no code mutation.
- **Decision gate:** if projected $/month ≤ 1.5× the Max plan cost, STOP. Don't do tasks G2-G5. The regression isn't large enough to justify the regressions of PTY-mode.

### Task G2 — `spawn-pty.ts` prototype (single-request, no pool)

- **Files:** `services/claude-gateway/src/spawn-pty.ts` (new), `services/claude-gateway/package.json` (add `node-pty` dep).
- **Change:** Implement `runClaudePty(args: RunArgs): Promise<RunResult>` with the same input/output contract as `runClaude`. Implementation:
  1. `node-pty.spawn('claude', [], { name: 'xterm-color', cols: 200, rows: 50, cwd: args.repoPath, env: args.env })`.
  2. Wait for the interactive REPL prompt to appear (regex on stripped output, configurable per CLI version).
  3. Optionally send `/clear` if reusing a pooled process — for the prototype, always fresh.
  4. Write the prompt followed by a sentinel suffix instructing Claude to end every response with `<<<NEXUS_DISPATCH_END>>>` on its own line (system prompt note).
  5. Read pty output until the sentinel appears OR `timeoutMs` elapses. Strip ANSI codes (use `strip-ansi`).
  6. Return `{ok: true, content, durationMs}` with `toolCalls` and `usage` left undefined (telemetry parity is Task G5).
- **Verify:** Unit test that spawns a mocked `claude` binary (a tiny shell script that echoes a fixed response + sentinel). End-to-end test against the real binary in a Docker exec on the existing claude-gateway container — confirm the response matches the same prompt sent via `-p`-mode.
- **Parallel:** yes (independent surface).
- **Risk:** ANSI parsing is fragile. Mitigate by recording the raw pty output for the first N dispatches into `/var/log/claude-gateway/pty-debug/` so we can debug parse failures.

### Task G3 — Hybrid routing in `spawn.ts`

- **Files:** `services/claude-gateway/src/spawn.ts`, callers that opt-in (one per follow-up PR).
- **Change:** Add `executionMode?: 'p-mode' | 'pty-mode'` to `RunArgs`. Default `'p-mode'`. `runClaude` dispatches to `runClaudePty` when `executionMode === 'pty-mode'`. Add a feature-flag escape hatch: env var `DISABLE_PTY_MODE=1` forces every call back to `p-mode` regardless of caller intent (incident-response lever).
- **Verify:** Existing tests pass unchanged (default path is `p-mode`). New test: a request with `executionMode: 'pty-mode'` returns the same content shape; toolCalls/usage are absent.
- **Parallel:** yes (depends on G2).
- **Risk:** A caller that needs tool-call telemetry but picks `pty-mode` by mistake gets silent feature loss. Mitigate by logging a one-line WARN at the gateway entry when `pty-mode` is selected: "tool-call telemetry suppressed".

### Task G4 — PTY process pool

- **Files:** `services/claude-gateway/src/pty-pool.ts` (new), `services/claude-gateway/src/spawn-pty.ts` (refactor to acquire/release from pool).
- **Change:** A bounded pool (default size 4, env `PTY_POOL_SIZE`) of long-lived interactive Claude processes. Acquire: pop a free worker, send `/clear` to reset context, return it. Release: push back to pool. Health check every 30s: write `> ` (empty input), expect prompt re-display within 5s; if not, kill + respawn. Hard kill any worker that's been in-use longer than 300s.
- **Verify:** Stress test — 20 concurrent dispatches with pool size 4 complete without deadlock. Force-kill a worker mid-dispatch; the pool spawns a replacement and the dispatch retries on `p-mode` as fallback.
- **Parallel:** yes (depends on G2 + G3).
- **Risk:** Context bleed. Mitigate with `/clear` between requests AND a sanity check: if the response references content from the prior dispatch (heuristic: response length suspiciously long, or contains tokens not in this dispatch's prompt), discard the result and retry on `p-mode`.

### Task G5 — Best-effort telemetry parity

- **Files:** `services/claude-gateway/src/spawn-pty.ts`, optionally `services/claude-gateway/src/index.ts` (gateway entrypoint metrics).
- **Change:** Parse the interactive mode's footer (it prints token counts and elapsed time in a footer after each response). Map to `RunResult.usage`. Best-effort — if the format changes between CLI versions, fall back to undefined rather than throwing. Add a gateway-level counter `gateway_executions_total{mode="p"|"pty",result="success"|"fallback"}` so we can monitor the fallback rate post-deploy.
- **Verify:** Capture 50 PTY-mode dispatches; ≥80% have usage populated. Fallback rate ≤5% over the same window.
- **Parallel:** yes (depends on G4).
- **Risk:** False sense of telemetry parity. Mark `RunResult.usage.source` as `"pty-parsed"` vs `"stream-json"` so downstream code can decide whether to trust it.

## Phase 2.5 — Pilot rollout (after G1-G5 land)

- Flip ONE high-volume call site (default candidate: `solopreneur-loop` ticks; second choice: `codex-maintainer` health pass) to `executionMode: 'pty-mode'`.
- Watch the `gateway_executions_total` metric and `experiment_metrics` cost rollup for 7 days.
- If fallback rate ≤5% AND cost reduction ≥3×, expand to the next call site.
- If fallback rate >10% OR cost reduction <2×, roll back and reopen Task G2 design.

## Out-of-scope (explicit)

- **tmux-based variant.** node-pty is the in-process equivalent and simpler to operate. Keep tmux as a documented manual debug path only (operator can `tmux attach` to a `claude-gateway` container for live debugging — not part of the dispatch flow).
- **Custom protocol over the Claude CLI's interactive output.** Don't try to convince the CLI to emit JSON in interactive mode; that's just `-p`. The PTY path accepts the regression of unstructured output as the cost of subscription billing.
- **Replacing `-p`-mode entirely.** `p-mode` stays for chat UI dispatches, debug runs, and any future feature that requires stream-json events.
- **Mocking out Claude entirely with a local LLM.** Out of scope for this plan — a separate decision.

## Risks worth flagging to the operator

1. **TOS drift.** Anthropic changed `-p` billing once already; they could revoke or detect programmatic-PTY-driving next. Don't build hard cost dependencies on this path — keep `p-mode` as a real fallback, not a ceremonial one. If costs ever stabilize on `-p` (either by Anthropic reverting or by API price drop), retire PTY-mode without regret.
2. **Telemetry blindspot.** Tool-call cards, sessionId continuity, accurate token accounting — all suppressed on PTY-mode. Reserve PTY-mode for cycles where the operator doesn't read the rendered output anyway (autonomous loops). NEVER use PTY-mode for `platform-copilot` or `business-copilot` chat (those need the cards).
3. **Output parse fragility.** Every Claude Code CLI minor release could shift the interactive output format slightly. Build the parse layer with explicit version checks and refuse to start PTY-mode if the CLI version is outside a known-tested range.
4. **Pool exhaustion.** With pool size 4 and a long dispatch (~5 min), a burst of 5 concurrent dispatches queues. Monitor queue depth; if it grows, raise pool size BEFORE raising it; don't fall back to `p-mode` automatically just because the pool is full (that defeats the cost goal).

## Progress

_None yet — plan written 2026-05-20. Task G1 (cost measurement) is the gating decision. Do not start G2-G5 until G1 confirms the regression is large enough._

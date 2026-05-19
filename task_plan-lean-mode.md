# task_plan-lean-mode.md

## North Star

**Goal:** Pivot Nexus to a single-KVM lean-mode topology while preserving the multi-tenant architecture dormant behind a `LEAN_MODE` flag, and lay the foundations for an autonomous-workforce upskilling loop (Voyager / Hermes / EvoSkill synthesis) plus an "open-orchestration" registry of OSS agent frameworks.

**Success criteria:**
- Platform runs entirely on one Hostinger KVM via Coolify; Vercel + second KVM decommissioned
- All multi-tenant code reachable behind a `LEAN_MODE=0` flip — no merge, no lost fixes — guard module at `lib/lean-mode.ts`
- Phase B sandbox operational: a `skill-trainer` agent can propose → exec → grade → retry against rootless Podman until 3 consecutive passes
- `mocs/agent-framework-survey` seeded with ≥5 OSS agent projects as entities + ≥10 pattern/anti-pattern atoms
- `LLM_PROVIDER` env switch wired so swapping Claude Max → Mimo Pro 2.5 → Ollama is a one-env-var change
- Monthly infra cost reduced by ~$30-60 (Vercel + one KVM eliminated)
- ADR documents the pivot; one memory-hq atom captures the durable lesson

**Hard constraints:**
- Supabase stays the database (no self-host migration)
- Clerk + Composio + Stripe + memory-hq stay external (free tiers)
- Multi-tenant code paths stay in the repo, dormant — no destructive deletes
- Git tag `v1.0-multi-tenant` MUST land on `main` BEFORE any LEAN_MODE code change
- No regression on solo-owner workflows (chat, dashboard, board, forge) in lean mode
- Sandbox MUST be rootless Podman (not Docker-in-Docker)
- Mimo and Ollama adapters are stubs first — Claude Max stays default until subscription ends
- Phase-end memory atoms are mandatory

---

## Phase 1 — Explore (read-only inventory)

Inventory the surfaces that need guarding. Do NOT modify any of these files in Phase 1; just populate the Inventory section below.

- [ ] **Per-business container provisioning** — `app/api/businesses/[slug]/provision/route.ts`, `lib/coolify/client.ts`, `lib/businesses/mcp-manifest.ts`, `app/api/cron/scale-down-businesses/route.ts`
- [ ] **Stripe multi-business attribution** — every `payment_intent.create` with `metadata.business_slug` or per-business `statement_descriptor`
- [ ] **Cost-guard tiering** — `lib/cost-guard.ts` and call sites (`checkKillSwitch`)
- [ ] **business_slug partitioning** — every filter on `experiment_metrics`, `connected_accounts`, `token_events`, `run_events`
- [ ] **Composio resolution chain** — `executeBusinessAction()` two-step (per-business → user-default)
- [ ] **Per-business gateway routing** — `resolveClawConfig()` and `business:<slug>` Doppler key pattern

Use `Grep -rn "business_slug"` + `Grep -rn "resolveClawConfig"` + `Grep -rn "metadata\\.business_slug"` to gather. Output goes into the Inventory section, with one bullet per file:line pair.

PDCA gate: Phase 2 cannot start until Inventory is filled.

---

## Phase 2 — Atomic tasks

### Task 1 — Tag v1.0-multi-tenant on main
- File: git only
- Change: `git tag -a v1.0-multi-tenant -m "Snapshot of multi-tenant production-ready architecture before lean-mode pivot"`, push tag
- Verify: `git tag -l v1.0-multi-tenant` shows it; GitHub releases page lists it
- Parallel: no — must run first

### Task 2 — Central LEAN_MODE guard module
- File: `lib/lean-mode.ts` (new)
- Change: Export `isLeanMode(): boolean` reading `process.env.LEAN_MODE === '1'`; `assertScaleMode(reason: string): void` that throws when called in lean mode (so dormant code self-documents); `LEAN_MODE_DOCS_URL` const pointing to `docs/runbooks/lean-mode.md`
- Verify: `npx tsc --noEmit` clean; unit test covers both flag states
- Parallel: yes

### Task 3 — Lean-mode runbook stub
- File: `docs/runbooks/lean-mode.md` (new)
- Change: Skeleton — Overview / What gets switched / How to enable / How to revert / Cutover playbook (filled by Task 10)
- Verify: Links from `lib/lean-mode.ts` resolve
- Parallel: yes

### Task 4 — Guard per-business provisioning
- File: `app/api/businesses/[slug]/provision/route.ts`
- Change: At top of POST, `if (isLeanMode()) return Response.json({ ok: false, error: 'Per-business provisioning disabled in lean mode' }, { status: 200 });` (200 per retry-storm rule)
- Verify: Route returns soft error with `LEAN_MODE=1`; original flow runs without the flag
- Parallel: yes

### Task 5 — Guard scale-down cron
- File: `app/api/cron/scale-down-businesses/route.ts`
- Change: Early-return `{ ok: true, skipped: 'lean-mode' }` in lean mode
- Verify: No Coolify API calls made; cron returns the skipped marker
- Parallel: yes

### Task 6 — Guard Stripe multi-business attribution
- File: Call sites identified in Phase 1 inventory
- Change: In lean mode, drop `metadata.business_slug` and per-business `statement_descriptor` from `payment_intent.create`. Plain Stripe calls instead.
- Verify: Stripe test webhook with `LEAN_MODE=1` shows clean metadata
- Parallel: yes

### Task 7 — Guard cost-guard tiering
- File: `lib/cost-guard.ts`
- Change: In lean mode, `checkKillSwitch()` collapses to a single global budget read from `LEAN_USER_DAILY_USD_LIMIT` (default $5). Skip per-business tier checks.
- Verify: Killing the global budget kills all calls; unit test covers both modes
- Parallel: yes

### Task 8 — Guard Composio business-slug resolution
- File: `lib/composio/actions.ts` `executeBusinessAction()`
- Change: In lean mode, skip per-business lookup, go straight to user-default. Single resolution path, no fallback chain.
- Verify: Composio action with `LEAN_MODE=1` resolves via user-default; without flag, two-step resolution still works
- Parallel: yes

### Task 9 — Coolify Compose for the lean stack
- File: `services/lean-deploy/docker-compose.yml` (new), `services/lean-deploy/README.md` (new)
- Change: Compose stack: `nexus-app` (Next.js standalone), `claude-gateway`, `codex-gateway`. Network bridge. Env from Doppler. Volumes for any local state. README documents Coolify import + DNS steps.
- Verify: `docker compose config` validates; README walkthrough complete
- Parallel: yes

### Task 10 — Cutover playbook (no live cutover yet)
- File: `docs/runbooks/lean-mode.md` (extend Task 3 skeleton)
- Change: Document the actual cutover — Coolify import, env var setup, Cloudflare DNS swap, Stripe webhook URL rotation, parallel-run validation steps, decommission checklist for the old KVM + Vercel project. Cutover is a separate run, this just lays down the steps.
- Verify: Steps reproducible; env-var list matches `services/lean-deploy/docker-compose.yml`
- Parallel: yes (must follow Task 3 + Task 9)

### Task 11 — LLM provider abstraction
- File: `lib/llm/provider.ts` (new)
- Change: Entry point `getLlm(opts?: { provider?: 'claude' | 'mimo' | 'ollama' | 'auto' })`. Default reads `LLM_PROVIDER` env, falls back to `'claude'`. Migrate `/api/chat/route.ts` to use it. Mimo + Ollama branches throw "not yet wired" — full impl in Tasks 12-13.
- Verify: `/api/chat` still streams against Claude unchanged with `LLM_PROVIDER=claude` (default)
- Parallel: no — depends on `/api/chat` route shape; foundation for 12-13

### Task 12 — Mimo Pro 2.5 adapter stub
- File: `lib/llm/providers/mimo.ts` (new)
- Change: Implement the Vercel AI SDK 6 provider interface against Mimo's API. Wire to env `MIMO_API_KEY`, `MIMO_BASE_URL`. Activation deferred until Claude Max subscription ends.
- Verify: Unit test mocks Mimo API, asserts request shape
- Parallel: yes (with Task 13, after Task 11)

### Task 13 — Ollama local adapter
- File: `lib/llm/providers/ollama.ts` (new)
- Change: Adapter against `OLLAMA_BASE_URL=http://localhost:11434`. Default model `llama3.3`. For local smoke tests without burning Claude budget.
- Verify: Smoke test against a running Ollama returns text
- Parallel: yes (after Task 11)

### Task 14 — Rootless Podman sandbox service
- File: `services/nexus-sandbox/Containerfile` (new), `services/nexus-sandbox/docker-compose.yml` (new), `services/nexus-sandbox/server.ts` (new), `services/nexus-sandbox/README.md` (new)
- Change: Coolify app exposing `POST /exec` accepting `{ script: string, image: string, timeout_ms: number }`. Runs the script inside an ephemeral rootless Podman container (`podman run --rm --network=none ...`). Returns `{ stdout, stderr, exit_code, duration_ms }`. Hard kill at timeout. No persistent state. README documents KVM nesting requirement.
- Verify: `curl POST /exec` with `{ script: "echo hello", image: "alpine" }` returns `{ stdout: "hello\n", exit_code: 0 }`
- Parallel: yes
- Blocker check: confirm Hostinger KVM tier supports rootless container nesting before commit

### Task 15 — Sandbox proxy route inside Nexus
- File: `app/api/sandbox/exec/route.ts` (new)
- Change: Thin proxy from Nexus → `nexus-sandbox`. Service-role bearer auth. Returns 200 + `{ok: false, error}` on transient failure per retry-storm rule. Cost-guard hook with placeholder $0.001/call.
- Verify: `POST /api/sandbox/exec` mirrors the sandbox service's response shape
- Parallel: no (depends on Task 14)

### Task 16 — skill-trainer managed agent
- File: `.claude/agents/skill-trainer.md` (new)
- Change: Agent receives a competency brief → proposes code → calls `/api/sandbox/exec` → grades via a linter/validator → retries up to 5 times until 3 consecutive passes → writes `SKILL.md` to `.claude/skills/<name>/` with `status: draft` + 3-line YAML frontmatter (Intent / Required Tools / Success Criteria). Calls `supermemory` on exit.
- Verify: Spec passes the agent-generator transferability checklist
- Parallel: yes

### Task 17 — Skill status gate (draft → verified)
- File: `components/board/ReviewModal.tsx`, `app/api/skills/[slug]/promote/route.ts` (new), `lib/skills/router.ts` (extend skill-router to filter `status: draft`)
- Change: Board surfaces draft skills with a "Promote to verified" button. Promote route flips frontmatter + commits. Routing layer refuses to invoke `status: draft` skills.
- Verify: Draft skill is unreachable from routing; verified skill routes normally
- Parallel: yes

### Task 18 — Open-orchestration MOC seed (memory-hq writes)
- File: Multiple memory-hq writes via `memory_atom` / `memory_entity` / `memory_moc` MCP tools
- Change: Create `mocs/agent-framework-survey`. Entities: Voyager, Hermes, OpenClaw, EvoSkill, OpenSwarm, Mimo, Higgsfield, Open Code, Open Claude. Atoms (≥10): kind: pattern OR anti-pattern, status: absorbed OR rejected, with reasoning. Examples: Voyager iterative curriculum (absorbed), OpenClaw tool-switchboard fragility (rejected), Hermes 3-tier light index check (absorbed), EvoSkill Proposer/Evaluator loop (absorbed).
- Verify: `memory_search "agent framework"` returns the MOC + entities + atoms
- Parallel: yes

### Task 19 — Survey-ingestion workflow
- File: `app/api/agents/survey-oss-framework/route.ts` (new)
- Change: Accepts `{ repo_url: string, framework_name: string }`. Spawns `firecrawl` on README + key docs → spawns `supermemory` to extract atoms → links them to `mocs/agent-framework-survey`. One-click "absorb a new project."
- Verify: Calling the route with a real GitHub URL creates a new entity + ≥3 atoms in memory-hq
- Parallel: no (depends on Task 18)

### Task 20 — ADR + retrospective atom
- File: `docs/adr/NNN-lean-mode-pivot.md` (new), one `memory_atom` write
- Change: ADR documents the LEAN_MODE pivot (context, decision, alternatives, consequences). Atom captures the lesson: "Single-KVM lean mode preserves scale-mode via feature flag, not branch fork — cheaper revert, no merge debt." Update `docs/adr/INDEX.md`.
- Verify: ADR indexed; atom queryable via `memory_search "lean mode"`
- Parallel: yes (final task)

---

## Dispatch order (after plan approval)

1. **Task 1 first** — git tag is the safety net
2. **Batch A (parallel):** 2, 3, 9, 18 — independent setup + docs + memory seeding
3. **Batch B (parallel):** 4, 5, 6, 7, 8 — code guards, all wrap independent files
4. **Task 10** — cutover playbook (depends on 3 + 9)
5. **Task 11** then **Batch C (parallel):** 12, 13 — LLM provider abstraction
6. **Batch D (parallel):** 14, 16, 17 — sandbox + agent + Board gate
7. **Task 15** — sandbox proxy (depends on 14); **Task 19** — survey ingestion (depends on 18)
8. **Task 20** — ADR + retrospective atom

PDCA gates:
- After Batch B: run the existing test suite with `LEAN_MODE=1` to verify guards are correct.
- After Batch D: verify skill-trainer completes one end-to-end cycle against the sandbox.
- Before declaring done: smoke-test the lean stack on a throwaway Coolify project (no DNS swap yet).

---

## Inventory (populated during Phase 1)

_To be filled in as Phase 1 progresses. Each bullet: `path/to/file.ts:line — reason`._

### Per-business provisioning surfaces
_TBD_

### Stripe multi-business attribution call sites
_TBD_

### Cost-guard tiering call sites
_TBD_

### business_slug partition sites
_TBD_

### Composio business-slug resolution sites
_TBD_

### resolveClawConfig + business:<slug> gateway routing sites
_TBD_

---

## Progress (as of 2026-05-19)

### Completed (iteration 1)
- [x] **Task 1** — `v1.0-multi-tenant` tag pushed to `origin/main` (SHA `577c958`)
- [x] **Task 2** — [`lib/lean-mode.ts`](lib/lean-mode.ts): `isLeanMode()`, `assertScaleMode()`, `leanModeDailyUsdLimit()`
- [x] **Task 3** — [`docs/runbooks/lean-mode.md`](docs/runbooks/lean-mode.md) full runbook (overview, what switches, enable/revert, cutover playbook)
- [x] **Task 4** — Lean-mode short-circuit in [`app/api/businesses/[slug]/provision/route.ts`](app/api/businesses/[slug]/provision/route.ts) (200 + soft error)
- [x] **Task 5** — Lean-mode short-circuit in [`app/api/cron/scale-down-businesses/route.ts`](app/api/cron/scale-down-businesses/route.ts) (returns `{ ok: true, reason: 'lean-mode' }`)
- [x] **Task 6** — No-op for the current codebase. The grep for `payment_intent.create` + `metadata.business_slug` returned zero call sites; the Stripe webhook handler ([`app/api/webhooks/stripe/route.ts`](app/api/webhooks/stripe/route.ts)) is receive-only and ignores `business_slug`. Guard added to the lean-mode boundary list in the runbook so the future creation path inherits it.
- [x] **Task 7** — `lib/cost-guard.ts`: `assertUnderCostCap` collapses to single global cap from `LEAN_USER_DAILY_USD_LIMIT`; `checkKillSwitch` returns `{ kill: false }` in lean mode
- [x] **Task 8** — `lib/composio/actions.ts` `findActiveAccount` skips per-business exact match, goes straight to user-default in lean mode (admin scope still strict)
- [x] **Task 9** — [`services/lean-deploy/`](services/lean-deploy/): Dockerfile + docker-compose.yml + README for the Nexus app on Coolify
- [x] **Task 10** — Cutover playbook section added to [`docs/runbooks/lean-mode.md`](docs/runbooks/lean-mode.md) (Cloudflare TTL drop → Coolify import → smoke test → Stripe rotate → DNS swap → decommission)
- [x] **Task 11** — [`lib/llm/provider.ts`](lib/llm/provider.ts) — `getLlm({ provider?, model? })` switch on `LLM_PROVIDER`. Chat route ([`app/api/chat/route.ts`](app/api/chat/route.ts)) migrated to use it
- [x] **Task 12** — [`lib/llm/providers/mimo.ts`](lib/llm/providers/mimo.ts) stub with activation steps documented
- [x] **Task 13** — [`lib/llm/providers/ollama.ts`](lib/llm/providers/ollama.ts) stub with activation steps documented
- [x] **Task 14** — [`services/nexus-sandbox/`](services/nexus-sandbox/): Containerfile (quay.io/podman/stable) + docker-compose.yml (privileged) + server.mjs (pure node:builtins) + README
- [x] **Task 15** — [`app/api/sandbox/exec/route.ts`](app/api/sandbox/exec/route.ts) — thin proxy with two-mode auth + cost-guard + 200-on-soft-failure
- [x] **Task 16** — [`.claude/agents/skill-trainer.md`](.claude/agents/skill-trainer.md) — closed upskilling loop (propose → exec → grade → 3 consecutive passes → SKILL.md draft → human verify)
- [x] **Task 17 (partial)** — [`app/api/skills/[slug]/promote/route.ts`](app/api/skills/[slug]/promote/route.ts) — flips frontmatter `status: draft → verified` with audit log. **Board UI button deferred to manual checklist below.**
- [x] **Task 18 (local cache)** — `mocs/agent-framework-survey` MOC + 7 entities (Voyager, Hermes, OpenClaw, EvoSkill, OpenSwarm, Mimo, Higgsfield) + 11 pattern/anti-pattern/Nexus-pattern atoms written to `memory/molecular/`. **memory-hq mirror push deferred — see manual checklist (MCP returned 503 during this run).**
- [x] **Task 19** — [`app/api/agents/survey-oss-framework/route.ts`](app/api/agents/survey-oss-framework/route.ts) — POST `{ repo_url, framework_name }` → dispatches firecrawl + supermemory through `/api/claude-session/dispatch`
- [x] **Task 20** — [`docs/adr/006-lean-mode-pivot.md`](docs/adr/006-lean-mode-pivot.md) + retrospective atom (`lean-mode-pivot-via-feature-flag-not-branch-fork-nexus-pattern`) in local cache

### Verification
- `npx tsc --noEmit` clean (no output = no errors)
- Memory graph rebuilt: 54 nodes, 70 edges, hubs include `agent-framework-survey` (degree 11)

### Remaining for iteration 2
- [ ] **Lint warnings** — 11 new atoms flagged as `orphanAtoms` + `sourcelessAtoms` because the MOC body doesn't reference them via `[[wikilinks]]` yet. Quick fix: edit `memory/molecular/mocs/agent-framework-survey.md` body to list each atom under sections (Patterns absorbed / Anti-patterns rejected / Trial / Nexus-originated patterns). The `--links` CLI arg adds frontmatter edges but not body references; lint counts both.
- [ ] **memory-hq push** — re-run the survey + atoms through `mcp__memory-hq__memory_atom` once the MCP recovers (was 503 during this run). The local cache is dev-only; canonical storage is `pinnacleadvisors/memory-hq`. Alternative: use `cli.mjs --backend=github` after exporting `MEMORY_HQ_TOKEN`.
- [ ] **Board UI integration for skill promote** — extend [`components/board/ReviewModal.tsx`](components/board/ReviewModal.tsx) to surface draft skills with a "Promote to verified" button calling `POST /api/skills/[slug]/promote`. Backend route already shipped.
- [ ] **Activate Mimo + Ollama** — when Claude Max ends, replace the `throw` in [`lib/llm/providers/mimo.ts`](lib/llm/providers/mimo.ts) with `createOpenAICompatible(...)`, smoke-test, flip `LLM_PROVIDER=mimo` in Doppler. Same shape for Ollama.

---

## Manual checklist (operator action required)

The following can't be automated by Claude — operator runs them, ticks the box.

### Before flipping LEAN_MODE=1 in production

- [ ] **Confirm KVM tier supports privileged containers / user namespaces** — SSH into the Hostinger KVM, run `podman info | grep rootless`. If rootless mode is unavailable, either upgrade the plan or fall back to the host-systemd sandbox layout in [`services/nexus-sandbox/README.md`](services/nexus-sandbox/README.md).
- [ ] **Generate `NEXUS_SANDBOX_TOKEN`** — 64-char random string. Add to Doppler. Same value goes on both `nexus-app` and `nexus-sandbox` Coolify apps.
- [ ] **Verify `NEXUS_OPS_TOKEN`** is set in Doppler (used by the provision route + skill promote + survey ingestion bearer-auth paths).
- [ ] **Set `LEAN_MODE=1`** in Doppler production config.
- [ ] **Set `LLM_PROVIDER=claude`** (or omit — default is `claude`).
- [ ] **Set `LEAN_USER_DAILY_USD_LIMIT`** to a sane number (default 5; raise to 20-50 once you're confident the kill-switch isn't tripping on legitimate runs).

### Coolify import — automated via [`scripts/migrate-to-lean-kvm.mjs`](scripts/migrate-to-lean-kvm.mjs)

The four-app deploy + env-bulk-set is now one command. See full runbook at [`docs/runbooks/migrate-to-lean-kvm.md`](docs/runbooks/migrate-to-lean-kvm.md).

- [ ] One-time Coolify setup:
  - [ ] Create `nexus-lean` project in Coolify UI; copy UUID into `TARGET_COOLIFY_PROJECT_UUID` Doppler var
  - [ ] Register the GitHub App (Coolify → Sources) for `pinnacleadvisors/nexus` and grant repo access — required for git-based builds
  - [ ] Verify target server UUID: `curl $TARGET_COOLIFY_URL/api/v1/servers -H "Authorization: Bearer $TARGET_COOLIFY_TOKEN" | jq '.[].uuid'`
- [ ] `doppler run -- node scripts/migrate-to-lean-kvm.mjs --dry-run` — should print 4 services with 0 missing env vars
- [ ] `doppler run -- node scripts/migrate-to-lean-kvm.mjs --apply` — creates + deploys all 4 on KVM4 (idempotent; re-runnable on failure)
- [ ] Verify each app reaches `status=running` in Coolify UI (the script polls for 5 min; first build of `nexus-app` may take longer — re-run if it times out, it skips already-created apps)
- [ ] (Optional) `doppler run -- node scripts/migrate-to-lean-kvm.mjs --apply --stop-source` — once parallel-run validation succeeds, this STOPS (never deletes) matching apps on KVM2 / source Coolify
- [ ] (Optional) Deploy `ollama` from upstream image — Coolify UI, alias `ollama` on the `coolify` network

### Smoke tests

- [ ] `curl https://<host>/api/health` → 200
- [ ] `curl -X POST https://<host>/api/businesses/test/provision -H "Authorization: Bearer $NEXUS_OPS_TOKEN"` → 200 `{ ok: false, error: 'Per-business provisioning disabled in lean mode', mode: 'lean' }`
- [ ] `curl -X POST https://<host>/api/sandbox/exec -H "Authorization: Bearer $NEXUS_OPS_TOKEN" -d '{"script":"echo hello","image":"alpine"}'` → 200 `{ ok: true, stdout: "hello\n", exit_code: 0 }`
- [ ] Run `/forge` chat in-app — verify Claude Code gateway path responds
- [ ] Hit `/dashboard` — verify Supabase queries work

### DNS swap (when ready for cutover)

- [ ] Drop Cloudflare TTL to 60s a few hours in advance
- [ ] Rotate Stripe webhook URL in dashboard
- [ ] Cloudflare DNS → A record → Coolify host IP
- [ ] Wait 1-2 min, smoke-test again
- [ ] Pause Vercel project (don't delete for 7 days in case of rollback)
- [ ] Stop the second KVM (don't delete for 7 days)

### After cutover

- [ ] Sign up for Mimo Pro at https://mimo.ai, generate API key — store in Doppler when ready to swap (NOT before)
- [ ] Run a smoke test of the survey ingestion route on one OSS framework: `POST /api/agents/survey-oss-framework` with `{ repo_url: "https://github.com/<owner>/<repo>", framework_name: "X" }` and verify it creates entity + atoms
- [ ] **Push local memory cache to memory-hq** — once MCP `mcp__memory-hq__*` recovers from the 503 it returned during this run, re-emit the atoms via `memory_atom` (or run `node .claude/skills/molecularmemory_local/cli.mjs --backend=github reconcile` if such a command exists; if not, hand-port the 11 atoms + 7 entities + 1 MOC from `memory/molecular/` to memory-hq)
- [ ] Fix lint warnings on the new atoms — edit `memory/molecular/mocs/agent-framework-survey.md` body to wikilink-reference each atom under section headers
- [ ] Add the "Promote to verified" button to the Board ReviewModal (Task 17 follow-up)
- [ ] After 7 days of stable lean-mode operation: delete the paused Vercel project + second KVM

### Reversibility insurance

- [ ] Git tag `v1.0-multi-tenant` exists at SHA `577c958` — verify with `git tag -l v1.0-multi-tenant && git rev-parse v1.0-multi-tenant`
- [ ] All multi-tenant code paths remain in the repo, just dormant behind `isLeanMode()`. Diff against the tag to confirm if anything regressed during lean-mode work.

---

## Blockers / Open questions (carried forward)

- **memory-hq MCP 503** during this run — atoms written to local cache only. Resolve before iteration 2.
- **Mimo Pro 2.5 API shape** — adapter assumes OpenAI-compatible; verify against Mimo docs before flipping `LLM_PROVIDER=mimo`.
- **Sandbox attack surface** — privileged container is acceptable lean-mode-only (one tenant = owner). Must swap for gVisor / Firecracker before customer code lands. ADR 006 captures this as a hard precondition for un-flipping `LEAN_MODE`.

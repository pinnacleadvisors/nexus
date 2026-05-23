# task_plan — Mobile-first + Platform-Copilot autonomy + Dynamic timeout

> Long-horizon plan per [AGENTS.md §Long-Horizon Task Protocol](AGENTS.md#long-horizon-task-protocol). Companion to [`task_plan-paperclip-ui-phase-2.md`](task_plan-paperclip-ui-phase-2.md) (mobile work resolves its Risk #4) and [`task_plan-codex-debug-loop.md`](task_plan-codex-debug-loop.md) (the screenshot-verification loop reuses its dev-sandbox primitives).

## North Star

**Goal:** Operator can manage every part of Nexus from his phone while travelling, and platform-copilot can ship UI changes end-to-end (branch → edit → verify on laptop + mobile screenshots → PR) with the same rigor as a Claude Code session — including dynamically extending its own turn timeout when a task needs more than the current 5-minute ceiling.

**Success criteria:**
- Every protected page at `/dashboard`, `/board`, `/inbox`, `/businesses`, `/businesses/[slug]/*`, `/manage-platform`, `/settings/*`, `/agents/[slug]` (when shipped) renders cleanly at 375×812 without horizontal overflow or sub-44px tap targets on key controls.
- The root Playwright suite at `tests/playwright/` runs every spec on three projects: `chromium` (desktop), `iphone` (iPhone 12), `android` (Pixel 5). Same for `services/qa-runner/playwright.config.ts`.
- Whenever platform-copilot lands a UI-touching `edit-group`, its turn includes a screenshot pair (laptop 1280×800 + mobile 375×812) embedded inline before the operator clicks "Continue" or "Open PR".
- The `/manage-platform` chat composer has a visible timeout selector (5m default, 15m / 30m / 60m / custom). Selection is per-turn — the next turn resets to the saved default. Server-side cap stays at the gateway env `REQUEST_TIMEOUT_MS`; selector just narrows below the cap, never above.
- A dedicated `dev-bot` Clerk user exists in `ALLOWED_USER_IDS` with an on-demand `/api/dev/clerk-ticket` endpoint that platform-copilot (or the codex debug loop) can call to mint a fresh sign-in ticket for autonomous Playwright runs.
- Platform-copilot's spec ([`.claude/agents/platform-copilot.md`](.claude/agents/platform-copilot.md)) documents the verify-then-PR rule, the timeout selector, and the screenshot pair. Approval gates that are clearly redundant given gateway sandbox isolation are lifted to match Claude-Code autonomy.

**Hard constraints:**
- Cannot break the existing chat surface — every change to `/api/platform-chat` is backwards-compatible (`requestTimeoutMs` is optional; default behaviour unchanged).
- Cannot remove existing approval gates for deploys, env-writes, customer-facing actions, or money movement — those remain operator-gated per the Ralph-loop invariants in [AGENTS.md](AGENTS.md#operator-gated-loop-pattern-ralph-loop).
- Cannot raise the gateway's `REQUEST_TIMEOUT_MS` above its current production value (900 s) — a per-turn selector picks a value *within* that cap, never above. Long-running jobs that need >15 min should split via `edit-plan` blocks, not be one mega-turn.
- The dev-bot Clerk user must be added to `ALLOWED_USER_IDS`, NOT created as an `app/api/dev/*`-style bypass. We keep the same auth model for humans and bots so the audit trail stays uniform.
- Mobile-first edits must preserve desktop quality — no regression in the existing 1280px+ layouts. Verify both viewports for every change.

## Background — what's already in place

Exploration findings (see `## Exploration log` at the bottom of this file for citations):

- **Mobile state**: Sidebar already has icon-rail collapse via `useResizable` but it requires pointer drag — no auto-collapse on touch. KpiGrid at [`components/dashboard/KpiGrid.tsx:58`](components/dashboard/KpiGrid.tsx:58) uses `grid-cols-2` with no `sm:` mobile-first fallback (P0). AgentTable at [`components/dashboard/AgentTable.tsx:35`](components/dashboard/AgentTable.tsx:35) is `hidden sm:block` — disappears on mobile with no card fallback (P1). Send button on chat composer is `px-3 py-2` ≈ 32 px — below the 44 px ADA tap-target guideline (P2). Bento Mission Control already cascades `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` (good).
- **Playwright state**: Single `chromium` project at [`playwright.config.ts:44-49`](playwright.config.ts:44). Same single-project shape at [`services/qa-runner/playwright.config.ts`](services/qa-runner/playwright.config.ts). Existing specs at `tests/playwright/{sign-in,business-chat,platform-chat,settings-ai-providers,settings-skills}.spec.ts` are viewport-agnostic — they'll run on mobile projects with zero spec changes once the projects are added.
- **Timeout state**: Gateway env `REQUEST_TIMEOUT_MS` at [`services/claude-gateway/src/index.ts:18`](services/claude-gateway/src/index.ts:18) defaults 600 s; production is 900 s. The chat dispatch at [`app/api/platform-chat/route.ts:316-323`](app/api/platform-chat/route.ts:316) hardcodes `timeoutMs: 10_000` but that's the *client-side fetch timeout for the enqueue call*, not the gateway's spawn timeout. There is no current path for the UI to override per-job timeout — we add one by extending the job-body schema with optional `requestTimeoutMs` and threading it through `runClaude`.
- **Autonomous verification state**: claude-gateway has Node + the repo but NO Playwright binaries — verified by reading `services/claude-gateway/Dockerfile`. codex-gateway DOES have Playwright 1.49.1 + Chromium + system deps. The chat surface already has `mcp__playwright__*` MCP tools listed in agent system reminders (browser_navigate, browser_take_screenshot). For autonomous screenshot pairs, the cheapest path is: platform-copilot delegates to codex-operator via `mcp__codex-delegate__delegate_to_codex` for any UI verification work — codex already has the binaries.
- **Dev account state**: No bot Clerk user exists yet. Tests use `BOT_SESSION_TICKET_URL` (a fresh Clerk sign-in ticket minted out-of-band) via [`tests/playwright/_helpers.ts:37-45`](tests/playwright/_helpers.ts:37). The qa-runner mints these tickets out of a Clerk-Backend-API call; same primitive can be lifted into a `/api/dev/clerk-ticket` operator-only route.
- **Claude Desktop accumulations**: `~/.claude/CLAUDE.md` is set by `framework-pull`. The gateway image does NOT mount this — claude-gateway runs with its own pre-baked instruction set in [`services/claude-gateway/entrypoint.sh`](services/claude-gateway/entrypoint.sh). Skills like `frontend-design`, `verify`, `run`, `fewer-permission-prompts`, the write-size hook, and the skill-router hook are all candidates for porting into the gateway image so platform-copilot inherits them.

## Phases & atomic tasks (operator approves each before kickoff)

The three priorities ship in this order — smallest first (timeout, ~1 day), then mobile fixes (~3 days), then copilot autonomy (~3 days). Each phase is a self-contained PR.

---

### Phase 1 — Dynamic per-turn timeout (smallest priority, ships first)

#### Task 1A — Job body schema extension

- File: [`services/claude-gateway/src/index.ts`](services/claude-gateway/src/index.ts) (around the `messageBodySchema` definition near line 68)
- File: [`services/claude-gateway/src/spawn.ts`](services/claude-gateway/src/spawn.ts) (accept `requestTimeoutMs` override; clamp to `[60_000, REQUEST_MAX_MS]`)
- Change: add optional `requestTimeoutMs?: number` to the job body. When present, the spawned Claude CLI uses `min(jobValue, REQUEST_MAX_MS)` — never above the env cap. When absent, falls back to env default.
- Verify: `npx tsc --noEmit` clean; manual `curl /api/jobs` with and without the new field; gateway logs show the effective timeout.
- Parallel: no — foundation for 1B/1C.

#### Task 1B — Dispatch route pass-through

- File: [`app/api/platform-chat/route.ts`](app/api/platform-chat/route.ts) (extend `PlatformChatBody` with `requestTimeoutMs?: number`; thread into `enqueueGatewayJob`)
- File: [`lib/claw/gateway-jobs.ts`](lib/claw/gateway-jobs.ts) (add `requestTimeoutMs` to `EnqueueJobOpts`; serialise into job body)
- File: [`app/api/business-chat/route.ts`](app/api/business-chat/route.ts) (same pattern for business-copilot symmetry)
- Change: thread the optional value end-to-end. Default behaviour unchanged when omitted.
- Verify: type-check, manual POST with `requestTimeoutMs: 900000`.
- Parallel: no — depends on 1A.

#### Task 1C — Composer UI selector

- File: `components/platform-chat/PlatformChat.tsx` (locate the send button at ~line 840 per the audit; insert a small selector to the left of it)
- File: `components/platform-chat/TurnTimeoutSelector.tsx` (new) — dropdown of `5 m / 15 m / 30 m / 60 m / custom` (custom opens a tiny input that accepts minutes 1-15 above the gateway env cap is rejected client-side with a tooltip)
- File: persist last choice in localStorage (`platform-chat:lastTurnTimeoutMs`) so the operator's preferred default carries across sessions, but the actual send always resets the selector to the saved default (so an accidental "60 m" doesn't sticky).
- Change: selector renders as a small chip-style button below the textarea on mobile (so it doesn't squeeze the input) and inline beside Send on desktop. Tap target 44 px on mobile.
- Verify: select 30 m, send a slow turn (e.g. ask copilot to run `npm test` via codex delegate), confirm gateway logs show the lifted timeout; mobile viewport at 375 px shows the selector without overlap.
- Parallel: yes — UI work; doesn't touch 1A/1B server code (they're its API contract).

---

### Phase 2 — Mobile-first UI + Playwright mobile coverage

#### Task 2A — Fix the three P0/P1 layout regressions

- File: [`components/dashboard/KpiGrid.tsx`](components/dashboard/KpiGrid.tsx:58) — `grid-cols-2` → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6` (mobile-first cascade).
- File: [`components/dashboard/AgentTable.tsx`](components/dashboard/AgentTable.tsx:35) — replace `hidden sm:block` with a card-list mobile variant + table-on-desktop. Each card has agent slug, status pill, last-run timestamp.
- File: [`components/layout/Sidebar.tsx`](components/layout/Sidebar.tsx) — add auto-collapse to icon-rail mode at viewport ≤ 640 px via a `useEffect` watching `window.matchMedia('(max-width: 640px)')`. Operator's manual resize choice wins above 640 px.
- Verify: Chrome DevTools mobile preview at 375 px on `/dashboard`, `/board`, `/agents`. Visual diff: stats are legible, agent list renders, sidebar collapsed.
- Parallel: yes — three independent components.

#### Task 2B — Tap-target bump on shared chat controls

- File: `components/platform-chat/PlatformChat.tsx` — send button `px-3 py-2` → `px-4 py-2.5 min-h-[44px]` AND identical change to the businesses chat (shares the component? confirm during impl).
- File: [`components/layout/Sidebar.tsx:328`](components/layout/Sidebar.tsx:328) — collapse button same treatment.
- Change: every interactive control in the operator's primary mobile surfaces ≥ 44 × 44 px.
- Verify: Playwright a11y check for tap-target size (or visual sweep).
- Parallel: yes — pure CSS.

#### Task 2C — Add iPhone + Android Playwright projects (root config)

- File: [`playwright.config.ts`](playwright.config.ts) — extend `projects` array:
  ```ts
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'iphone',   use: { ...devices['iPhone 12']      } },
  { name: 'android',  use: { ...devices['Pixel 5']        } },
  ```
- File: `tests/playwright/dashboard-mobile.spec.ts` (new) — asserts sidebar is collapsed below 640 px, KpiGrid renders as single column, chat composer's timeout selector is visible.
- Verify: `npx playwright test --project=iphone` runs (will skip auth-gated specs locally without `BOT_SESSION_TICKET_URL` — that's the existing behaviour).
- Parallel: yes — config + new spec; existing specs run unmodified.

#### Task 2D — Mirror mobile projects in qa-runner config

- File: [`services/qa-runner/playwright.config.ts`](services/qa-runner/playwright.config.ts) — same three projects.
- File: `services/qa-runner/e2e/dashboard-mobile.spec.ts` (new) — same shape as 2C, points at live Vercel preview.
- File: `app/api/cron/post-deploy-smoke/route.ts` — pass `playwrightProjects` in the qa-runner webhook payload so post-deploy smoke runs all three viewports.
- Verify: deploy to preview, manually trigger qa-runner, confirm a 3× project run completes.
- Parallel: yes — depends on 2C structurally but no merge conflict.

#### Task 2E — Document the mobile-test expectation in AGENTS.md

- File: [`AGENTS.md`](AGENTS.md) — add a new bullet to the pre-commit checklist:
  > `npx playwright test --project=iphone --grep dashboard-mobile` passes (or any new mobile-surfaced page has a corresponding `*-mobile.spec.ts`).
- File: [`AGENTS.md`](AGENTS.md) — extend the retry-storm checklist's "If you added or modified an API route" section with a "Did you also UI-test on the mobile viewport?" question for UI-route changes.
- Parallel: yes — docs only.

---

### Phase 3 — Platform-copilot autonomy + autonomous verification

#### Task 3A — Bot Clerk user + ticket endpoint

- Manual step (operator): create `dev-bot@<your-domain>` Clerk user (or re-purpose qa-bot if it exists), copy their user_id into `ALLOWED_USER_IDS` via Doppler. Surface as a `manual-task` block during plan execution.
- File: `app/api/dev/clerk-ticket/route.ts` (new) — operator-only (require `auth().userId === ALLOWED_USER_IDS[0]`), accepts `{ targetUserId: string }`, returns a fresh Clerk sign-in ticket URL via the Backend API (mirrors qa-runner's implementation pattern; will need `CLERK_SECRET_KEY` in scope).
- File: [`memory/platform/SECRETS.md`](memory/platform/SECRETS.md) — document the new env (`DEV_BOT_USER_ID`, reused `CLERK_SECRET_KEY`).
- Verify: hit the route as the operator, confirm a 200 with a redeemable ticket URL. Redeem it in a fresh incognito window — should land on `/dashboard`.
- Parallel: no — gates 3B/3C.

#### Task 3B — Screenshot-pair sub-routine for platform-copilot

- File: `lib/agents/screenshot-pair.ts` (new) — helper that, given a path on the dev server (or a Vercel preview URL), takes screenshots at 1280×800 and 375×812, uploads to Vercel Blob, returns two URLs.
- File: `.claude/agents/platform-copilot.md` — add a new section `## Verifying UI changes` that documents the rule:
  > After any `edit-group` that touches `app/(protected)/**/*.tsx`, `components/**/*.tsx`, or `app/globals.css`, I MUST take a laptop + mobile screenshot pair against the dev server BEFORE emitting `edit-group-complete`. Use `delegate_to_codex` (codex-gateway has Playwright + Chromium) with the brief: "boot the worktree dev server on port 3000, sign in via /api/dev/clerk-ticket, navigate to <route>, screenshot at 1280×800 and 375×812, upload both, return URLs."
- Change: the screenshots embed inline in the next agent message as `![laptop](url) ![mobile](url)` so the operator sees both before clicking Continue/Open PR.
- Verify: synthetic edit-group touching a `(protected)/**/page.tsx`. Confirm chat shows both screenshots.
- Parallel: no — depends on 3A.

#### Task 3C — Expand platform-copilot's change workflow with verify-on-real-dev step

- File: `.claude/agents/platform-copilot.md` § "Change workflow — investigate → propose → branch → preview → merge" (around the existing step 4 "Verify locally" block at line ~334).
- Change: extend step 4 with three sub-steps:
  - 4a: `tsc --noEmit` + retry-storm (existing).
  - 4b (NEW): for UI changes, boot dev server via `delegate_to_codex` + screenshot pair (Task 3B).
  - 4c (NEW): if any spec exists under `tests/playwright/` matching the change scope, run it via `delegate_to_codex` against the dev server. Don't run the full suite unless asked.
- Change: lift the redundant approval gate at step 5 (PR open) — once steps 4a-4c are green and the operator has seen the screenshots in chat (step 4b), opening a draft PR is no longer destructive. The gate moves to step 7 (merge), which is the actual destructive action. Document this in the agent spec.
- Verify: read the agent spec back; have copilot run a synthetic end-to-end on a no-op UI change.
- Parallel: yes after 3B.

#### Task 3D — Port useful Claude Desktop accumulations into the gateway image

- File: [`services/claude-gateway/entrypoint.sh`](services/claude-gateway/entrypoint.sh) — extend the pre-approved permissions list and MCP server registrations to include:
  - The write-size check hook (`.claude/hooks/check-write-size.sh`) — copy into the image's `/etc/nexus-hooks/` and reference from the gateway's settings.json at startup.
  - The skill-router hint hook — same treatment.
  - The `frontend-design` skill (already exists in `.claude/skills/`) — copy in.
  - The `/verify`, `/run`, `/fewer-permission-prompts` built-in-style skills — confirm they're already part of the Claude CLI inside the gateway image (they're built-in to recent Claude Code releases, not skill files).
- File: [`services/claude-gateway/Dockerfile`](services/claude-gateway/Dockerfile) — `COPY` the hooks + skills into the image.
- Verify: deploy a preview gateway image, ask copilot to run `/verify` — the slash command should be recognised; the chat-write-size hook should refuse a 500-line `Write`.
- Parallel: yes after 3A — independent of 3B/3C.

#### Task 3E — Memory + ADR write-up

- File: `docs/adr/NNN-platform-copilot-autonomous-ui-verify.md` (new ADR documenting the verify-then-PR rule, why the codex-delegate path was chosen over installing Playwright in claude-gateway, and the dev-bot user model).
- File: memory-hq atom via the MCP tool — `title: "platform-copilot autonomous UI verify"`, `kind: "decision"`, `importance: "high"`, link to `mocs/platform-copilot`.
- File: [`memory/roadmap/SUMMARY.md`](memory/roadmap/SUMMARY.md) — flip the mobile + copilot autonomy rows to ✅ once shipped.
- Parallel: yes — docs.

---

## Verification per phase

After each phase ships (one PR per phase):

- `npx tsc --noEmit` clean.
- `npm run check:retry-storm` clean.
- `npm run check:sentry-config` clean.
- `npm run check:lockfile` clean (per the new guard from PR #277).
- For Phase 1: select 15 m in the composer, send a turn that uses codex delegation; gateway logs show `effective_timeout_ms=900000` (or the selected value).
- For Phase 2: visual sweep on `/dashboard`, `/board`, `/inbox`, `/businesses`, `/manage-platform` at 375 px + 1280 px. Playwright `chromium` + `iphone` + `android` projects all green.
- For Phase 3: synthetic end-to-end — copilot edits a `(protected)/**/page.tsx`, surfaces a screenshot pair, opens a draft PR, operator merges.

## Deferred (open follow-up plans later)

These are explicitly out of scope for this initiative — captured here so they don't get lost.

- **Hermes agent docker** — `task_plan-hermes-docker.md` to follow once Phase 3 ships. Decide whether hermes lives alongside the codex-gateway (sysadmin tier) or gets its own container.
- **TestSprite / Goose integration** — `task_plan-debug-loop-oss-frameworks.md` to follow once the mobile Playwright coverage in Phase 2 lands. Evaluate against the codex-debug-loop pattern; pick 1-2 frameworks rather than bolting on the entire OSS testing ecosystem.

## Timeline

| Phase | Tasks | Effort | Depends on |
|---|---|---|---|
| 1 — Timeout | 1A → 1B → 1C | 1 day | — |
| 2 — Mobile | 2A, 2B, 2C, 2D in parallel; 2E last | 2.5 days | — |
| 3 — Copilot | 3A → 3B → 3C, 3D, 3E (3D parallel after 3A) | 3 days | Phase 2 (so screenshots show the new mobile-friendly UI) |
| **Total** | | ~6.5 days | — |

Phases 1 and 2 are independent and could ship in parallel; if the operator approves both, I'd open two branches off main.

## Risks

- **Per-turn timeout abuse** — operator could pick 60 m for every turn and burn the plan window cap. Mitigation: the selector resets to the operator's chosen default (e.g. 5 m) after each send; localStorage stores the default but not the active-turn value.
- **Mobile-first refactor breaks desktop** — every change has visual verification at BOTH 1280 px AND 375 px. Add a Playwright snapshot test for the dashboard at both viewports if drift becomes a recurring issue (out of scope for v1 — flagged here).
- **Screenshot path requires dev-bot to be in ALLOWED_USER_IDS** — without it, the agent's Playwright session can't sign in. The Task 3A manual step is the gate; until it's done, Phase 3 doesn't ship.
- **Codex delegate cost** — every UI edit-group fires a codex turn for screenshots. Budget: ~$0.05/turn × 20 turns/day = ~$1/day extra. Within the `USER_DAILY_USD_LIMIT` envelope. Surface via `checkKillSwitch` before each delegation.
- **Lifting the PR-open approval gate** — moving the gate from step 5 to step 7 means draft PRs land without explicit operator clicks. Mitigation: `draft: true` flag mandatory on the PR creation API call so the PR cannot accidentally trigger preview-deploy automations beyond the standard Vercel preview build.

## Exploration log (citations for the Background section above)

Findings sourced 2026-05-23 via Explore agents + direct reads. Anchors:

- [`playwright.config.ts:44-49`](playwright.config.ts:44) — single `chromium` project only.
- [`services/claude-gateway/src/index.ts:18`](services/claude-gateway/src/index.ts:18) — `REQUEST_MAX_MS` env source.
- [`app/api/platform-chat/route.ts:316-323`](app/api/platform-chat/route.ts:316) — `timeoutMs: 10_000` (client-side poll, not gateway spawn).
- [`lib/claw/gateway-jobs.ts:99-150`](lib/claw/gateway-jobs.ts:99) — `enqueueGatewayJob` signature; needs `requestTimeoutMs` parameter.
- [`components/dashboard/KpiGrid.tsx:58`](components/dashboard/KpiGrid.tsx:58) — `grid-cols-2` lock (P0).
- [`components/dashboard/AgentTable.tsx:35`](components/dashboard/AgentTable.tsx:35) — `hidden sm:block` no fallback (P1).
- [`components/layout/Sidebar.tsx:305-482`](components/layout/Sidebar.tsx) — tap-target audit (32 px buttons; below 44 px).
- [`tests/playwright/_helpers.ts:37-45`](tests/playwright/_helpers.ts:37) — `BOT_SESSION_TICKET_URL` pattern reusable for dev-bot.
- [`services/qa-runner/playwright.config.ts`](services/qa-runner/playwright.config.ts) — same single-project shape as root.
- [`services/claude-gateway/Dockerfile`](services/claude-gateway/Dockerfile) — no Playwright; pure Node 22 + Claude CLI.
- [`services/codex-gateway/Dockerfile`](services/codex-gateway/Dockerfile) — Playwright 1.49.1 + Chromium pre-installed (codex is the delegation target for screenshots).

## Progress (as of 2026-05-23)

### Completed

- [x] North Star + atomic task breakdown written (this doc)
- [x] TaskCreate scaffolding for tracking — see `TaskList`

### Awaiting operator approval

- [ ] Phase 1 (Timeout) — Tasks 1A, 1B, 1C
- [ ] Phase 2 (Mobile) — Tasks 2A, 2B, 2C, 2D, 2E
- [ ] Phase 3 (Copilot) — Tasks 3A, 3B, 3C, 3D, 3E

### Blockers / Open Questions

- Should the timeout selector accept arbitrary minutes up to the gateway env cap (currently 15 min in prod), or stick to fixed presets (5/15/30/60)? Currently the plan does both — presets + a custom field clamped client-side. Confirm before 1C.
- Should we ship a `dev-bot@<domain>` Clerk user, or reuse the existing `qa-bot` from `services/qa-runner/` if it's already provisioned? Confirm during Task 3A.
- Does the operator want the screenshot pair generated for EVERY UI edit-group, or only the ones touching specific routes (configurable)? Default plan = every edit-group; the cost-guard envelope absorbs it but the chat history fills with images. Confirm during Task 3B.
- Lifting the PR-open gate to merge-only — operator confirm or push back? Some operators prefer the friction.


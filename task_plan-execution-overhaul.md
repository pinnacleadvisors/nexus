# task_plan — Workflow Execution Overhaul

Goal: every business workflow runs in a Coolify container scoped to that business, with its own MCP set, OAuth-connected accounts (via Composio), self-tested n8n graphs, and runtime tool selection by the CLI agent.

Success criteria:
- New business provisioned end-to-end (container + DB rows + connected accounts UI) in under 5 min
- n8n Strategist emits **tool budgets** instead of hardcoded tools; runtime CLI picks
- Generated n8n workflows pass `validate_workflow` + smoke execution before being marked deployable
- Failing nodes trigger automated debug loop; ≥80% of common errors auto-fixed
- Adding a new platform (LinkedIn, Buffer, etc.) = one row in `oauth_providers` table, no new code
- Frontend-design skill installed and used by ≥1 build workflow

Hard constraints:
- Don't break existing managed-agent flow — parallel rollout, feature-flagged
- All new secrets routed through Doppler; nothing committed
- Per-business container must scale to zero when idle (cost ceiling)
- Memory-hq integration preserved (each container can write atoms with its own scope)

---

## Phase 0 — Decisions to lock before building

| # | Decision | Default | Owner |
|---|---|---|---|
| 0.1 | Container model: per-business (B) confirmed | B | user |
| 0.2 | OAuth provider: Composio (250+ integrations) vs DIY OAuth | Composio | user |
| 0.3 | Container orchestrator: Coolify API vs Coolify webhook+manual | Coolify API | user |
| 0.4 | Migrate existing managed-agent calls now or after rollout | After (feature flag) | user |
| 0.5 | n8n self-host on Coolify, or n8n Cloud | Self-host (already deployed) | user |

User reviews 0.1–0.5 before Phase 1 starts.

---

## Phase 1 — Foundation (parallel)

### Task 1a — Generalize `lib/composio.ts`
- File: `lib/composio.ts` → split into `lib/composio/client.ts` + `lib/composio/doppler.ts`
- Change: factor `executeAction()` into a generic exported helper; move Doppler-specific `fetchDopplerSecrets` into its own module
- Verify: `npx tsc --noEmit` clean; `/api/composio/doppler` still works
- Parallel: yes

### Task 1b — Add `connected_accounts` schema
- File: `supabase/migrations/NNN_connected_accounts.sql` (new)
- Change: table `connected_accounts(id, user_id, business_slug, platform, composio_account_id, status, created_at, last_used_at)` + RLS
- Verify: Supabase migration applies cleanly; insert + select via service role
- Parallel: yes

### Task 1c — Add `oauth_providers` registry
- File: `lib/oauth/providers.ts` (new)
- Change: typed list of supported platforms with Composio action mappings (e.g. `twitter` → `TWITTER_CREATE_TWEET`, `linkedin` → `LINKEDIN_CREATE_POST`)
- Verify: import + spot-check a few mappings against Composio's action catalog
- Parallel: yes

### Task 1d — Install frontend-design skill
- File: `.claude/skills/frontend-design/` (new, via `npx skills add`)
- Change: run `npx skills add https://github.com/anthropics/skills --skill frontend-design`; commit the resulting files
- Verify: skill appears in available-skills list on next session start; trigger a UI design task and confirm it activates
- Parallel: yes

### Task 1e — Confirm GSD decision in writing
- File: `docs/adr/NNN-skip-gsd.md` (new)
- Change: ADR documenting GSD evaluation + reason for skip (overlap with claude-evolve + memory-hq + task_plan protocol)
- Verify: indexed in `docs/adr/INDEX.md`
- Parallel: yes

---

## Phase 2 — Connected Accounts UI

### Task 2a — OAuth initiation route
- File: `app/api/oauth/composio/init/route.ts` (new)
- Change: POST `{ platform, businessSlug }` → calls Composio's connection-init API → returns hosted-OAuth redirect URL
- Verify: hitting it returns a Composio-hosted URL that opens the consent screen
- Parallel: no (depends on 1a, 1b, 1c)

### Task 2b — OAuth callback handler
- File: `app/api/oauth/composio/callback/route.ts` (new)
- Change: receives `connected_account_id` from Composio, writes row to `connected_accounts`, redirects to `/settings/accounts`
- Verify: end-to-end flow with one platform (start with Twitter/X — fastest to test)
- Parallel: no (after 2a)

### Task 2c — Settings → Connected Accounts page
- File: `app/(protected)/settings/accounts/page.tsx` + `components/settings/AccountList.tsx` (new)
- Change: list connected accounts per business, "Connect [platform]" buttons, disconnect action
- Verify: visual review + 1 connect + 1 disconnect cycle works
- Parallel: no (after 2b; uses 1d frontend-design skill for the UI)

### Task 2d — Account-aware action helper
- File: `lib/composio/actions.ts` (new)
- Change: `executeBusinessAction(businessSlug, platform, action, args)` — looks up the right `connected_account_id`, calls Composio, returns result
- Verify: unit test with a mock connected account
- Parallel: no (after 1a, 1b)

---

## Phase 3 — n8n Strategist tool-budget refactor

### Task 3a — Update Strategist agent spec
- File: `.claude/agents/n8n-strategist.md`
- Change: replace per-step "use Higgsfield" with "tools: [list of options]"; add prompt language about runtime tool choice
- Verify: regenerate one existing workflow type (e.g. ad campaign) and inspect the output — should have `tools: [...]` array per dispatch node
- Parallel: yes

### Task 3b — Update dispatch route to honor tool budget
- File: `app/api/claude-session/dispatch/route.ts` (line ~31, the `tools?: string[]` field)
- Change: when `tools` is present, prepend a system message to the Claude session brief that lists available tools and instructs the agent to choose
- Verify: dispatch a test session with `tools: ['canva-mcp','higgsfield-mcp']` and inspect the session log to confirm the agent picked one
- Parallel: yes

### Task 3c — Generation-time validation
- File: `app/api/n8n/generate/route.ts`
- Change: after generation, call `mcp__n8n__validate_workflow` server-side (via the gateway); only return success if validation passes
- Verify: feed it a known-bad workflow, confirm it errors before returning
- Parallel: yes

---

## Phase 4 — Self-testing debug loop

### Task 4a — Create `n8n-debugger` managed agent spec
- File: `.claude/agents/n8n-debugger.md` (new)
- Change: spec for an agent that takes a workflow JSON + error trace, calls `mcp__n8n__get_node` for the failing type, patches the node, returns updated JSON
- Verify: feed it 3 known-failing workflows from past Board cards; should fix ≥2/3
- Parallel: yes

### Task 4b — Wire debugger into n8n generation flow
- File: `app/api/n8n/generate/route.ts`
- Change: after Strategist returns workflow, run validate → execute (test mode) → on error, dispatch n8n-debugger → loop (cap 5) → if still failing, file Board card with diagnostics
- Verify: integration test: generate a deliberately-broken workflow, confirm debugger runs and either fixes or files the card
- Parallel: no (after 3c, 4a)

### Task 4c — Test execution helper
- File: `lib/n8n/execute-test.ts` (new)
- Change: helper that POSTs to n8n's REST `/workflows/run` with mock inputs, returns structured `{ success, failedNode?, error? }`
- Verify: unit test against a local n8n instance
- Parallel: yes (after 3c)

---

## Phase 5 — Per-business container provisioning

### Task 5a — Container base image
- File: `services/claude-gateway/Dockerfile` (modify) + `services/claude-gateway/Dockerfile.business` (new, multi-stage)
- Change: base image with Claude CLI + standard MCPs + bundled `.claude/agents/`; business-overlay image extends with business-specific MCPs from a manifest
- Verify: `docker build -t nexus-business-base .` produces an image; spinning up runs `claude --version` cleanly
- Parallel: yes

### Task 5b — Coolify provisioning client
- File: `lib/coolify/client.ts` (new)
- Change: typed wrapper around Coolify's API: `createApp({ businessSlug, image, env })`, `deleteApp(slug)`, `pauseApp(slug)`, `wakeApp(slug)`
- Verify: provision + tear down a test container via the wrapper
- Parallel: yes

### Task 5c — Provisioning endpoint
- File: `app/api/businesses/[slug]/provision/route.ts` (new)
- Change: POST creates Coolify app + writes `business:<slug>` secrets row pointing to the new gateway URL
- Verify: end-to-end: create new business, hit endpoint, confirm `resolveClawConfig` resolves to the new container
- Parallel: no (after 5a, 5b)

### Task 5d — Idle scale-down
- File: `app/api/cron/scale-down-businesses/route.ts` (new) + cron config
- Change: cron every 30 min — pause containers with no recent dispatch (last_used_at > 1h)
- Verify: container provisioned, idle, paused on next cron run; next dispatch wakes it
- Parallel: no (after 5b)

### Task 5e — MCP manifest per business
- File: `lib/businesses/mcp-manifest.ts` (new)
- Change: function `getMcpManifest(businessSlug)` returns the list of MCPs to install in that container based on `business.niche` / `money_model`
- Verify: ad agency niche returns `[higgsfield, canva, firecrawl]`; SaaS returns `[linear, github, firecrawl]`
- Parallel: yes (after 5a)

---

## Phase 6 — Migration + cutover (feature-flagged)

### Task 6a — Feature flag
- File: `lib/flags.ts` (extend) + `business.flags` JSONB column
- Change: per-business flag `useDedicatedContainer` — when `true`, dispatch routes to `business:<slug>` gateway; when `false`, uses shared gateway
- Verify: toggle flag on test business; confirm dispatch routes accordingly
- Parallel: yes

### Task 6b — Pilot business migration
- File: pick one low-stakes test business
- Change: provision its container, flip flag, run one full workflow end-to-end
- Verify: workflow completes; metrics (latency, cost, success rate) within 20% of shared-gateway baseline
- Parallel: no (after 6a + all of Phase 5)

### Task 6c — Rollout playbook
- File: `docs/runbooks/per-business-container-rollout.md` (new)
- Change: ordered steps + rollback procedure for migrating remaining businesses
- Verify: dry-run with another team member following the doc
- Parallel: yes

---

## Phase 7 — Cleanup

### Task 7a — Update CLAUDE.md / AGENTS.md
- Change: document the per-business container model, Composio connected_accounts, tool-budget pattern
- Verify: AGENTS.md table of agents updated; SECRETS.md lists `COMPOSIO_API_KEY` (already there)
- Parallel: yes

### Task 7b — Memory-hq atoms for the architecture
- Change: write 3 atoms — `per-business-container-model`, `composio-connected-accounts`, `n8n-self-test-loop` — each linked to a new MOC `mocs/workflow-execution`
- Verify: `memory_search` finds them; MOC is non-empty
- Parallel: yes

### Task 7c — Deprecate hardcoded gateway env
- File: `lib/claw/business-client.ts`
- Change: log a deprecation warning when falling back to env-only gateway (no `business:<slug>` row); add migration guide
- Verify: log appears in dev when no business slug is passed
- Parallel: yes

---

## Progress

(empty — fill in as tasks complete)

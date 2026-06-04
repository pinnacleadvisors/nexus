<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Nexus — Agent & Contributor Guidelines

## Project Overview
Nexus is an all-in-one business automation platform. AI agents (Claude, OpenClaw) build, market, and maintain business ideas autonomously. The owner monitors and approves work via a secure web dashboard.

See `ROADMAP.md` for the full feature backlog and implementation status.

## Operating principles for every agent (read first)

These apply to **every** agent — managed sub-agents, Inngest crons, n8n workflows, ad-hoc dispatches. The detailed checklists later in this file explain the *why*; this section is the dense TL;DR for *what* every agent does on every task.

**Before any LLM dispatch:**
- Call `checkKillSwitch(businessSlug)` from `lib/cost-guard.ts`. If `kill: true`, log a `kill_switch_check` row to `experiment_metrics` and abort. If `signal: 'auto_pivot_eligible'`, route the proposal through the `niche_pick` gate. On the **false→true edge** (a business that wasn't killed last cycle), the autonomous tick also fires a `kill-switch` operator notification via `notifyOperator()` (Slack / web push) — see [`app/api/cron/solopreneur-tick/route.ts`](app/api/cron/solopreneur-tick/route.ts) `notifyKillSwitch()`. Persistent kills don't re-notify (transition guard reads the prior `kill_switch_check` row).
- Resolve `business_slug` first (per-business connection in `connected_accounts`), then fall back to user-default (`business_slug = NULL`). `executeBusinessAction()` and the provision route's `fetchDecryptedApiKey` already do this — never partition by guessing.
- Every dispatch carries `inputs.tools: string[]` with **≥ 2 plausible options**. Single-tool budget is an anti-pattern (`lib/n8n/validate.ts` warns; the n8n-strategist enforces).

**During execution:**
- All OAuth-platform calls go through `executeBusinessAction()` → Composio. **Never** read raw OAuth tokens. Composio holds them; we only store `composio_account_id`.
- Direct API-key platforms (`apiKeySetup` flag in `lib/oauth/providers.ts` — currently ConvertKit, Cloudflare DNS, Vercel) are read from container env vars set by the provision route. Never log the value, never echo it to stdout/Slack.
- **Multi-business shared accounts** (Stripe + Vercel today; flagged `sharePolicy: 'shareable'`): tag every external object with `metadata.business_slug` so revenue/usage attribution stays clean. Set per-business `statement_descriptor` on Stripe PaymentIntents. See [`docs/runbooks/shared-stripe-vercel.md`](docs/runbooks/shared-stripe-vercel.md).
- Logs include `businessSlug` for grepability. Secrets never logged in any form (presence/absence/length is OK; the value isn't).
- `business_slug` is the partition key on every relevant table (`experiment_metrics`, `token_events`, `run_events`, `connected_accounts`). Never leak between businesses.

**After execution:**
- Persist durable lessons via the `memory_atom` MCP tool (preferred) or `node .claude/skills/molecularmemory_local/cli.mjs --backend=github atom`. The memory-hq GitHub repo is canonical; the local `memory/molecular/` cache is dev-only and stale by default.
- Every notable incident, root-cause discovery, vendor-quirk, or architectural decision gets one atom. Link to the relevant MOC (`mocs/<topic>`) — atoms without a MOC become orphans on the next `cli.mjs lint`.
- Trivial fixes (typos, one-line config, package bumps) skip the atom — atom spam dilutes the signal.

<a id="topology"></a>

**Topology — what runs where (Mac-mini local-OS, as of 2026-06-04):**

> 🧭 **Single source of truth** — this paragraph is the canonical "what runs where" reference. Every doc / agent spec / code comment that needs to discuss platform topology should LINK HERE rather than duplicate the facts inline. Links use `[topology](AGENTS.md#topology)` (or the relative path equivalent). When infra changes, edit only this paragraph + write a memory-hq atom per the [Post-infrastructure-change memory protocol](#post-infrastructure-change-memory-protocol) — everything else inherits the truth via the link.

- **Mac mini = PRIMARY HOST** (since 2026-06-04, per ADR 011). Runs the full stack under **OrbStack + plain docker-compose** (no Coolify locally — it isn't native to macOS): `nexus-app` (Next.js), `claude-gateway`, `codex-gateway`, `nexus-sandbox`, `cloudflared` (the dedicated `nexus-mac` tunnel), and `cron-runner` (supercronic — replaces cron-job.org). Single compose + ops guide: [`services/local-os/`](services/local-os/README.md). One secret on the box (`DOPPLER_TOKEN` in gitignored `services/local-os/.env`); every container self-fetches from Doppler `prd`. Autostart via OrbStack login-item + the `com.nexus.local-os` LaunchAgent. Public hostnames `nexus` / `claude-gw` / `codex-gw` CNAME to the `nexus-mac` tunnel (`b741e21c…`). **Per-business gateway containers** (`nexus-business-<slug>`) also run here (migrated off Coolify 2026-06-04) as a sibling compose project — managed host-side via `npm run business:local`, reachable by `nexus-app` over the shared `coolify` network at internal DNS `http://nexus-business-<slug>:3000` (no public tunnel needed since the app is local). Guide: [`services/local-os/businesses/`](services/local-os/businesses/README.md). Set `BUSINESS_RUNTIME=local` so the idle scale-down cron no-ops (always-on box; idle containers are ~free).
- **KVM4 = FALLBACK ONLY** (until the Hostinger plan **expires 2026-06-28**, then gone). Still runs the old Coolify stack incl. `n8n` (kept here — no substantial workflows to migrate) + `qa-runner` on the `nexus-fleet` tunnel (`61285ea4…`). The per-business `nexus-business-*` apps migrated to the Mac (above); any still listed in Coolify are dead-weight pending teardown. Rollback path = repoint the 3 CNAMEs back to `61285ea4` (snapshot in `services/local-os/cloudflared/.rollback.json`). Per ADR 006 (lean-mode pivot, 2026-05-19) this was the sole host; ADR 011 moved primary to the Mac. `firecrawl` here was already non-functional pre-migration (no DNS).
- **KVM2 — RETIRED 2026-05-22.** Used to host the shared `codex-gateway`. The gateway was migrated to KVM4 by `scripts/migrate-to-lean-kvm.mjs`; the KVM2 VPS itself was decommissioned. Older docs / agent specs may still reference KVM2 by name — read those as "KVM4 now" unless they're explicitly about the migration runbook.
- **KVM1 / Hostinger n8n — RETIRED 2026-05-22.** Hostinger KVM1 VPS expired; n8n was migrated to KVM4 via [`docs/runbooks/n8n-kvm1-to-coolify.md`](docs/runbooks/n8n-kvm1-to-coolify.md). All workflows + the credential set encrypted under `N8N_ENCRYPTION_KEY` were preserved.
- **Vercel** = previously hosted `nexus-app`. **Disabled in lean mode** ([PR #238](https://github.com/pinnacleadvisors/nexus/pull/238)). The Vercel project + per-business projects code stays in tree behind `LEAN_MODE` short-circuits — flip the flag to restore.
- **Stripe** = shared account. Per-business attribution via `metadata.business_slug`. One tax form, one payout, one revenue truth source.
- **Supabase** = shared DB. Partition key is `business_slug`. RLS allows service-role writes from API routes; direct client reads disallowed.
- **Composio** = shared org. `connected_accounts` rows scoped per-business OR user-default; `executeBusinessAction()` resolves in that order.
- **Crons** = run **locally on the Mac** via the `cron-runner` container (supercronic), firing `/api/cron/*` on the internal app URL. Control surface: [`services/local-os/cron/crons.json`](services/local-os/cron/crons.json) (agent-editable `{path,schedule,enabled}` → `compose restart cron-runner`). **cron-job.org RETIRED 2026-06-04** (account drained) — re-seed it from `vercel.json` via [`scripts/migrate-crons-to-cronjob-org.mjs`](scripts/migrate-crons-to-cronjob-org.mjs) only if rolling back to KVM4.

**Memory query order (every agent, every task):**
1. `memory/INDEX.md` (≤ 500 tokens) — topic map across Layers 1 & 2
2. `memory_search` MCP against memory-hq (canonical Layer-2c)
3. Specific Layer-1/Layer-2 files via Read (`memory/platform/STACK.md`, `memory/roadmap/SUMMARY.md`, `task_plan-<topic>.md`)
4. Grep/Glob fallback only for areas memory-hq doesn't cover yet

**Authentication tokens (rotation cadence):**
- `CLAUDE_CODE_OAUTH_TOKEN` — long-lived, refreshable; rotate when revoked
- `CODEX_AUTH_JSON` — refresh-token rotation **~30-day**. Operator runs `codex login` on dev machine + pastes new auth.json into Doppler. Set calendar reminder. See [`docs/runbooks/codex-gateway-auth-rotation.md`](docs/runbooks/codex-gateway-auth-rotation.md).

**Write-size discipline:** Single Write/Edit/Bash call ≤ 300 lines / 10 KB. Skeleton-then-fill for new files; anchored Edits for refactors. Hook at `.claude/hooks/check-write-size.sh` enforces.

**Retry-storm rule:** API routes called by services that auto-retry (n8n, claw, Stripe webhooks, Inngest, Vercel crons) return **200 + `{ok: false, error}`** on transient failures, NOT 5xx. The full retry-storm checklist lives in the [Retry-storm vulnerability checklist](#retry-storm-vulnerability-checklist-run-mentally-for-every-change) below.

**What NOT to do (for every agent):**
- Don't introduce features beyond the task. Three similar lines beats a premature abstraction. No half-finished implementations.
- Don't add error handling for impossible cases. Trust internal code + framework guarantees. Validate at system boundaries only.
- Don't add backwards-compat shims for fresh code. Don't add feature flags when you can just change the code.
- Don't dump unrequested files (CHANGELOG, README, planning docs) without explicit user request.
- Don't run destructive ops (`rm -rf`, `git push --force`, `drop`, `--no-verify`) without explicit user confirmation. The cost of pausing is low; the cost of an unwanted action is high.
- Don't modify `business-operator.md` or `codex-operator.md` — clone/extend pattern. (Specific to the solopreneur experiment but worth flagging here.)

## Branch hygiene — preventing orphaned commits & stale branches

This is a multi-agent repo where branches stack and PRs merge out of order. The two recurring failure modes are **orphaned commits** (you push to a branch *after* its PR merged — the commits land in no PR and vanish on the next `main` sync) and **stale branches** (a branch far behind `main` becomes a conflict trap). The 2026-06-04 incident: the `check:operator-commands` guard was pushed to `chore/deploy-script-mac-primary` after PR #474 had already merged, stranding the whole guard until a later audit caught it. (Full recovery playbook + the older stranded-commit cases live in [CLAUDE.md → Branch Sync Protocol](CLAUDE.md#branch-sync-protocol--keep-main-as-the-moving-target); this section is the agnostic invariant every agent — Claude, Codex, opencode — must honour.)

**Three layers of defence — all must be active:**

1. **Repo setting** — `deleteBranchOnMerge: true` (enabled 2026-06-04). A second push to a merged branch then fails because the remote branch is gone. Verify: `gh repo view pinnacleadvisors/nexus --json deleteBranchOnMerge`.
2. **Local pre-push hook** — `.githooks/pre-push` blocks pushes to a branch whose PR is `MERGED`. It is **per-clone and per-worktree** and must be wired in every checkout (this is what was missing in the incident clone): `git config core.hooksPath .githooks`. Verify: `git config core.hooksPath` → `.githooks`.
3. **Mechanical guard** — `npm run check:branch-hygiene` detects, for the current branch: (a) **stranded commits** — PR `MERGED` but commits not in `origin/main` (fails, prints the cherry-pick recovery command), and (b) **stale** — ≥ 50 commits behind `origin/main` (warns). Fail-soft when `gh`/network is unavailable.

**The invariant (non-negotiable):**

- **One PR per branch. PR merged = branch dead.** New work = a new branch off latest `origin/main`. Never push another commit to a branch whose PR has merged.
- **Before pushing or opening a PR**, run `npm run check:branch-hygiene`. If it reports stranded commits, recover them onto a fresh branch (the command is in the output) — do not push to the dead branch.
- **As the last action of any session that opened a PR**, run `npm run check:branch-hygiene` (and the multi-PR check in the pre-commit checklist if > 1 PR). Stranded commits caught at end-of-session cost one cherry-pick; caught a week later they cost an archaeology session.
- **Recovery for a stranded/stacked branch** is `reset --hard origin/main` + `cherry-pick <your-unique-SHA>` (see CLAUDE.md) — NOT `rebase` (squash-merge SHAs collide with themselves).

## Stack Rules

### Next.js 16 (App Router)
- All pages live under `app/` using the App Router — no `pages/` directory
- Protected pages live under `app/(protected)/` — the route group is invisible in URLs
- Middleware is in `proxy.ts` (not `middleware.ts`) — do not rename it
- `'use client'` is required on any component that uses hooks, event handlers, or browser APIs
- `ssr: false` with `next/dynamic` is only valid inside Client Components (`'use client'`)

### Tailwind CSS 4
- Custom design tokens are declared in `app/globals.css` inside `@theme inline { }`
- No `tailwind.config.js` — Tailwind 4 is CSS-first
- Use `@import "tailwindcss"` as the first line of globals.css (already set)

### TypeScript
- All shared types live in `lib/types.ts` — add new interfaces there, not inline
- Run `npx tsc --noEmit` before every commit to catch type errors early

### Client / Server Component Boundary
- Any component with `onClick`, `onChange`, `onMouseEnter`, `useState`, `useEffect`, etc. needs `'use client'`
- Server Components cannot use `dynamic(..., { ssr: false })` — move to a Client Component
- recharts `ResponsiveContainer` uses `ResizeObserver` — always wrap in `dynamic(..., { ssr: false })` from within a Client Component

### AI SDK (Vercel AI SDK 6)
- `useChat` hook is in `@ai-sdk/react`, not `ai`
- `streamText`, `convertToModelMessages`, `DefaultChatTransport` are in `ai`
- API routes use: `streamText` → `result.toUIMessageStreamResponse()`
- Model: `anthropic('claude-sonnet-4-6')` via `@ai-sdk/anthropic`

### Icons (lucide-react)
- `Github` and `Trello` are removed in this version of lucide-react
- Use `GitBranch` instead of `Github`
- Use `Kanban` instead of `Trello`
- Always verify icon names with: `node -e "const l=require('./node_modules/lucide-react'); console.log('IconName' in l)"`

### Access Control — Adding Yourself as Owner

Nexus is a single-owner platform. Follow these steps the **first time** you access the live deployment:

**Step 1 — Create your Clerk account**
1. Open the deployed Vercel URL (e.g. `https://nexus-xxx.vercel.app`)
2. Sign up with your email (or Google/GitHub OAuth) on the sign-in page
3. Complete email verification if prompted

**Step 2 — Get your Clerk User ID**
1. Go to [clerk.com](https://clerk.com) → sign in → open your Nexus app
2. Navigate to **Users** in the left sidebar
3. Click your user → copy the **User ID** (format: `user_xxxxxxxxxxxxxxxxxxxxxxxx`)

**Step 2.5 — Verify bot protection is ON**
Clerk uses Cloudflare Turnstile for bot protection. The app's CSP (`next.config.ts`) already allows `challenges.cloudflare.com` so the CAPTCHA loads correctly. No action needed — keep bot protection enabled:
1. Clerk Dashboard → **Configure** → **Attack protection**
2. **Bot sign-up protection** should be **ON** (leave it enabled)

**Step 3 — Lock the platform to yourself**
1. In Doppler (or Vercel environment variables), add:
   ```
   ALLOWED_USER_IDS=user_xxxxxxxxxxxxxxxxxxxxxxxx
   ```
2. Also in Clerk Dashboard → **User & Authentication** → **Restrictions**:
   - Enable **"Block sign-ups"** — prevents anyone new from creating an account
   - (Optional) Add your email to the **Allowlist** for extra safety
3. Redeploy (Vercel auto-deploys on Doppler push, or trigger manually)

**How the guard works:** `proxy.ts` reads `ALLOWED_USER_IDS` (comma-separated for future team members). Any authenticated Clerk session whose user ID is not in the list is immediately redirected to the sign-in page. If `ALLOWED_USER_IDS` is unset, all authenticated users are allowed (useful pre-setup).

**To add a team member later:** append their Clerk user ID: `ALLOWED_USER_IDS=user_yours,user_theirs`

### Secrets
- All secrets managed via Doppler — never hardcode or commit `.env` files
- Required env vars: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- Access control: `ALLOWED_USER_IDS` — comma-separated Clerk user IDs; if set, only these users can access protected routes
- Optional env vars: `CLAUDE_CODE_GATEWAY_URL` + `CLAUDE_CODE_BEARER_TOKEN` (**primary** — self-hosted Claude Code on Hostinger+Coolify, drains the 20x Max plan; see `services/claude-gateway/`), `OPENCLAW_GATEWAY_URL` + `OPENCLAW_BEARER_TOKEN` (legacy fallback), `ANTHROPIC_API_KEY` (final fallback), `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (database), `SUPABASE_SERVICE_ROLE_KEY` (server writes), `STRIPE_WEBHOOK_SECRET` (revenue), `RESEND_API_KEY` (email alerts), `SENTRY_DSN` (error tracking)
- Phase 17 env vars: `TAVILY_API_KEY` (live web search — add first, works without DeerFlow), `DEERFLOW_BASE_URL` + `DEERFLOW_API_KEY` + `DEERFLOW_ENABLED` (DeerFlow 2.0 sidecar)
- Phase 18 env vars: `KLING_API_KEY` (cinematic video), `RUNWAY_API_KEY` (stylised video), `ELEVENLABS_API_KEY` (voiceover), `HEYGEN_API_KEY` (UGC/avatar), `DID_API_KEY` (talking-head fallback), `MUAPI_AI_KEY` (scene images), `SUNO_API_KEY` or `UDIO_API_KEY` (background music)
- Phase 20 env vars: `MEMORY_TOKEN` (PAT with repo scope), `MEMORY_REPO` (e.g. `pinnacleadvisors/nexus-memory`)
- n8n Strategist env vars: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` (set to `1` by `/api/claude-session/dispatch` when a step opts into swarm mode — required for Claude Code Agent Teams to spawn sub-agents)
- AI priority in `/api/chat`: Claude Code gateway (self-hosted on Hostinger+Coolify, plan-billed via 20x Max — see `services/claude-gateway/`) → OpenClaw (Claude Pro subscription, legacy fallback) → `ANTHROPIC_API_KEY` → helpful error message
- OpenClaw config stored in cookies via `/api/claw/config` — migrate to encrypted DB before production

### Per-agent hooks in `agent_library.hooks` (Phase 6 of collaborative-chat)

Migration 055 added a `hooks jsonb default '{}'` column to `agent_library`. Each agent can carry its own Claude-Code-shape hooks block (PreToolUse / UserPromptSubmit / SessionStart / etc.) — same JSON shape as `~/.claude/settings.json` `hooks` keys. When the claude-gateway spawns the agent, it merges:

1. The repo-wide hooks from `/repo/.claude/hooks/*.sh` (`check-write-size.sh`, `skill-router.sh`) — written to `/root/.claude/settings.json` at boot by `services/claude-gateway/entrypoint.sh` (PR #281).
2. The agent-specific hooks from `agent_library.hooks` for the spawned slug — fetched per-spawn by `services/claude-gateway/src/agentHooks.ts` (PR #299) and written to `/tmp/nexus-settings-<jobId>.json`, which is then passed to the CLI via `--mcp-config`.
3. (Future) The operator's own hooks from their own `~/.claude/settings.json` if mounted.

Merge semantics are additive — agent matcher groups CONCAT onto repo matcher groups for the same event key. Agents cannot remove repo hooks; the repo hooks are baseline guardrails (output cap enforcement, skill routing) and per-agent hooks ADD to them. The temp file is cleaned up after each spawn.

Opt an agent into custom hooks via `update agent_library set hooks = '...' where slug = '...'`. The fail-soft path (Supabase unreachable, slug not found, hooks column empty) silently falls back to the repo-wide settings.json — no risk of breaking a spawn.

Why per-agent: some agents (e.g. `business-operator` running cyclic crons) want very different hook behaviour than `platform-copilot` (interactive). The repo-wide hooks are the floor; the column lets each agent opt up.

### Docker images and docker-compose — Doppler as the source of truth

**Rule:** when you create a new `Dockerfile` or `docker-compose.yaml` for a Nexus service that ships on Coolify, **the only secret Coolify (or any orchestrator) should need to set is `DOPPLER_TOKEN`.** Every other env var is fetched from Doppler at container boot by wrapping the runtime command in `doppler run --`.

Why: a service with 12 secrets pasted into Coolify's env-var pane is 12 things to rotate, 12 places to drift from Doppler, and 12 places that go stale during a clone-this-service handoff. One `DOPPLER_TOKEN` per service collapses that to one rotation point and matches the rest of the platform.

**Canonical reference:** [`services/claude-gateway/Dockerfile`](services/claude-gateway/Dockerfile) + [`services/claude-gateway/docker-compose.yaml`](services/claude-gateway/docker-compose.yaml). Pattern:

1. **Dockerfile** — install Doppler CLI in the runtime stage:
   ```dockerfile
   RUN apt-get update \
    && apt-get install -y --no-install-recommends curl gnupg ca-certificates \
    && curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh \
    && rm -rf /var/lib/apt/lists/*
   ```
   Wrap the runtime command with `doppler run --` as the ENTRYPOINT:
   ```dockerfile
   ENTRYPOINT ["doppler", "run", "--fallback=/tmp/doppler.cache.json", "--"]
   CMD ["node", "dist/index.js"]
   ```
   `--fallback=...` caches the last successful pull so the container can still boot if Doppler is briefly unreachable.

2. **docker-compose.yaml** — the `environment:` block has ONE entry. Document the expected Doppler-sourced vars in a comment above the block so future readers know what the service actually consumes:
   ```yaml
   # Doppler-sourced env. Coolify only needs DOPPLER_TOKEN.
   # Vars expected at runtime (all populated in Doppler):
   #   FOO_BAR, BAZ_QUX, …
   services:
     my-service:
       environment:
         DOPPLER_TOKEN: "${DOPPLER_TOKEN}"
   ```
   Do NOT put `FOO_BAR: "${FOO_BAR}"` in the `environment:` block — it forces Coolify to know about every variable, defeating the point.

3. **Coolify env-var pane** — exactly one secret to set: `DOPPLER_TOKEN`. Mint a service token in Doppler scoped to the right config (typically `prd`) and paste it here. Rotation: rotate the token in Doppler → update Coolify → redeploy. One rotation, never twelve.

**Reference deployments:** `services/claude-gateway/`, `services/codex-gateway/`, `services/qa-runner/` (post-2026-05-23 migration). When forking a new service from one of these, the Doppler ENTRYPOINT and DOPPLER_TOKEN-only env shape carries over unchanged.

**Exceptions** — there are exactly two:
- The Nexus app itself when deployed on Vercel (Vercel has its own env-var system; Doppler syncs to Vercel via the Doppler→Vercel integration). Not relevant to Coolify-deployed services.
- A service that explicitly must NOT have any secrets at all (e.g. a public health-check responder). Document the exception in the Dockerfile comment header.

**Tooling supports this:** the [`scripts/coolify-create-compose-app.mjs`](scripts/coolify-create-compose-app.mjs) helper for creating new Coolify Compose resources only takes `--name` + `--compose` + `--doppler-token-secret` (the Doppler secret NAME that holds the service token). The token VALUE is never passed on the command line.

## File Structure
```
app/
├── (protected)/          # All authenticated pages
│   ├── layout.tsx        # Sidebar shell
│   ├── forge/            # Idea curation chatbot
│   ├── dashboard/        # Operations dashboard
│   ├── board/            # Kanban board
│   └── tools/            # Tools directory + OpenClaw config
├── api/
│   ├── chat/             # Streaming Claude chat endpoint
│   ├── claw/             # OpenClaw proxy API
│   └── oauth/            # OAuth flow (provider, callback, disconnect, status)
├── layout.tsx            # Root layout (ClerkProvider)
├── page.tsx              # Sign-in page
└── globals.css           # Tailwind + design tokens

components/
├── layout/               # Sidebar
├── forge/                # ChatMessages, MilestoneTimeline, GanttChart, ForgeActionBar
├── dashboard/            # KpiGrid, RevenueChart, AgentTable
├── board/                # KanbanColumn, KanbanCard, ReviewModal
└── tools/                # ToolsGrid, ToolCard

lib/
├── types.ts              # All TypeScript interfaces
├── mock-data.ts          # Seed data (replace with Supabase queries)
├── oauth-providers.ts    # OAuth provider config
└── utils.ts              # cn() helper
```

## Platform Memory — Local Knowledge Base

Platform knowledge lives in `memory/` inside this repo — chunked by concern, dense summaries, no API calls needed.

```
memory/
├── INDEX.md          ← START HERE — topic→file map
├── GRAPH.md          ← file dependency edges
├── platform/
│   ├── STACK.md      ← ALL dev rules (Next.js 16, Tailwind 4, Clerk, AI SDK 6, icons)
│   ├── ARCHITECTURE.md ← file structure, API patterns, DB access
│   ├── SECRETS.md    ← every env var by phase
│   └── OVERVIEW.md   ← what Nexus is, all pages, design principles
└── roadmap/
    ├── SUMMARY.md    ← one-liner per phase (1–22) with ✅/⬜ status (~300 tokens)
    └── PENDING.md    ← all ⬜ not-started items grouped by phase
```

**Query flow:** Read `memory/INDEX.md` first → read only the 1–2 files it points to. Saves 10× tokens vs scanning source docs.

**Keeping it current:** After a feature ships, edit `memory/roadmap/SUMMARY.md` and `PENDING.md` directly — no scripts or API calls needed.

> Note: `pinnacleadvisors/nexus-memory` (the GitHub repo) is the **runtime agent memory** for storing business outputs (research, content, financials). It is separate from this local platform documentation. See `lib/memory/github.ts` and Phase 20 in `ROADMAP.md`.

## Claude Code Managed Agents

Specialist subagents in `.claude/agents/` — Claude Code auto-discovers and delegates to these:

| Agent | File | Use when |
|-------|------|----------|
| **Nexus Memory** | `.claude/agents/nexus-memory.md` | Looking up platform context, reading/writing nexus-memory |
| **Nexus Architect** | `.claude/agents/nexus-architect.md` | Designing new pages/APIs, enforcing stack rules |
| **Nexus Tester** | `.claude/agents/nexus-tester.md` | Pre-commit TypeScript checks, validating component boundaries |
| **Agent Generator** | `.claude/agents/agent-generator.md` | User says "create an agent that…"; emits spec + DB row + memory records |
| **Firecrawl** | `.claude/agents/firecrawl.md` | Any agent needs web scrape / crawl / search |
| **Supermemory** | `.claude/agents/supermemory.md` | Every agent calls this after a run to record changes + promote facts |
| **Workflow Optimizer** | `.claude/agents/workflow-optimizer.md` | Review-node feedback triggers a minimal diff to the producing agent |
| **n8n Strategist** | `.claude/agents/n8n-strategist.md` | Designing an n8n workflow for an idea card (build or maintain). Classifies each step — managed agent? swarm? asset-gated review? — and emits importable JSON. Now emits **tool budgets** instead of single tool choices (see "Tool budget" below). |
| **n8n Debugger** | `.claude/agents/n8n-debugger.md` | Repair-only: takes a malformed workflow + error list, looks up canonical schemas via the n8n MCP, returns a patched workflow JSON. Called by `POST /api/n8n/debug`. Caps internal iterations at 3. |
| **Doppler Broker** | `.claude/agents/doppler-broker.md` | Mid-session secret-gated action. Parent supplies a `secret` name + `command`; broker fetches via `/api/composio/doppler`, runs the command with the secret in env, returns scrubbed output. The secret value never enters the parent's context. See ADR 001. |
| **Loop Runner** | `.claude/agents/loop-runner.md` | The agent the platform dispatches when an operator-declared **Loop** iteration fires (`POST /api/loops/[id]/start`). Reads the Loop config from its brief, emits an `iteration-plan` per cycle, runs ONE bounded iteration after approval, then POSTs the outcome to the loop's iteration-result callback to learn whether to continue / stop / await-approval. Generalises `business-operator` into an operator-configurable primitive. `task_plan-loops-sprints.md`. |

These agents are spawned automatically by Claude Code when tasks match their description. They share the Doppler-injected environment and have access to the tools listed in their frontmatter.

### n8n workflow generation

`POST /api/n8n/generate` uses the **n8n Strategist** rules. Per step it decides:

- **Managed agent vs plain capability** — specialist verbs ("design", "write", "research", "refactor") → session-dispatch node (`/api/claude-session/dispatch`). Simple data-shaping / provider calls stay on `/api/agent` or direct provider nodes.
- **Swarm mode** — when a step clearly decomposes into ≥3 independent sub-tasks ("build the full site", "launch a product across landing+video+ad+email") the dispatch carries `swarm: true`; `/api/claude-session/dispatch` then injects `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` into the session env so the lead agent can spawn a team with a shared task list.
- **Review nodes** — placed ONLY after asset-producing steps (website, image, video, app, ad, landing page, email, blog/content, product listing) plus a final launch/publish gate. The old "every 3 steps" cadence is gone.

`/api/claude-session/dispatch` auto-creates the `.claude/agents/<slug>.md` spec when `autoCreateAgent: true` (the default from the Strategist) and upserts it into `agent_library` so the agent survives across sessions.

### Agent generation protocol

When the user says "create an agent that…" (or any paraphrase), follow `docs/agents/GENERATION_PROTOCOL.md`:

1. Delegate to the `agent-generator` managed agent.
2. It emits a `.claude/agents/<slug>.md` spec, upserts an `agent_library` row via `POST /api/agents`, seeds molecular memory with an entity + atoms + MOC linkage, and updates `memory/platform/SECRETS.md` if new env vars are introduced.
3. Runs the transferability checklist so the agent is reusable outside Claude.

### Tool budget — runtime tool selection

Every managed-agent dispatch carries an `inputs.tools: string[]` budget — at least 2 plausible tools the agent can pick from for that step. The dispatch route prepends a "Tool budget — pick the most appropriate" instruction to the agent's brief so the runtime CLI selects based on what's installed in its container's MCP/skill set.

Anti-pattern: `tools: ['canva']` (single choice) — the whole point of dispatch is letting the agent react to the brief. Strategist enforces ≥2 options; `lib/n8n/validate.ts` warns on any node that violates this.

### Per-business containers (Phase 5+)

Each business gets its own Coolify Docker container running the Claude Code gateway. The container has the business's MCP set baked in (resolved from `lib/businesses/mcp-manifest.ts` by niche/money_model) and Composio connected-account IDs scoped to that business.

Provisioning: `POST /api/businesses/:slug/provision` — resolves manifest, creates the Coolify app via `lib/coolify/client.ts`, persists `business:<slug>` gateway secrets so `resolveClawConfig()` picks up the new container automatically. Activation is deferred (operator clicks Start in Coolify after review).

Idle scale-down: `app/api/cron/scale-down-businesses` runs every 30 min, stops containers idle > 1h based on `connected_accounts.last_used_at`. Never-used containers get a 24h grace period.

Feature-flag escape hatches:
- `DISABLE_PER_BUSINESS_GATEWAY=1` — globally bypass (emergency rollback).
- `BUSINESS_GATEWAY_BYPASS_SLUGS=foo,bar` — bypass listed slugs only.

Rollout playbook: `docs/runbooks/per-business-container-rollout.md`.

### Connected accounts (OAuth via Composio)

OAuth-authenticated platform integrations (Twitter/X, LinkedIn, Gmail, Slack, Notion, Stripe, Shopify, Canva, GA, etc.) are brokered through Composio. Tokens never touch our database — Composio holds them, we store only the `connected_account_id`.

- `lib/oauth/providers.ts` — registry of supported platforms + per-platform Composio action ids.
- `lib/composio/actions.ts` `executeBusinessAction()` — workflow-side helper. Looks up `connected_account_id` for `(user, business, platform)`, calls Composio, bumps `last_used_at`. Throws `ConnectedAccountMissingError` so workflow agents can surface a "connect <platform>" prompt rather than failing the whole run.
- `/settings/accounts` — owner UI (lists connections, connect via Composio OAuth, disconnect).
- `connected_accounts` table — `(user_id, business_slug, platform) → composio_account_id`. Migration 033.

### Review-node feedback loop

The Board review modal (`components/board/ReviewModal.tsx`) has a "Quality feedback" disclosure that POSTs to `/api/workflow-feedback`. The `workflow-optimizer` agent reads `open` rows, proposes a minimal diff against the producing agent's spec, and logs the change to `workflow_changelog` after the edit lands.

The `workflow-feedback` route also accepts a non-human shape (`{ summary, details, source }`) — designed for synthetic feedback agents (e.g. a future `user-tester-panel`) to post into the same table the human reviewer uses, so the `workflow-optimizer` ingestion path stays single. Don't fork it.

### Operator-gated loop pattern ("Ralph loop")

Multi-turn agents that iterate against a moving target — bug hunts, multi-file edits, repeat audits, future synthetic user-tester panels — all share the same shape. Live exemplars: [`bug-hunt-loop`](.claude/agents/bug-hunt-loop.md) (iteration-plan + cost gate + draft-only PRs), [`loop-runner`](.claude/agents/loop-runner.md) (the operator-configurable **Loops** primitive — declarative North Star + caps + gates, dispatched per iteration with an iteration-result callback; `task_plan-loops-sprints.md`), [`workflow-optimizer`](.claude/agents/workflow-optimizer.md) (feedback → diff → apply → log), and the `edit-plan` block in [`platform-copilot`](.claude/agents/platform-copilot.md) / [`business-copilot`](.claude/agents/business-copilot.md) for chunked multi-file edits across the turn-timeout boundary. When you write a new loop-shaped agent, fork the closest exemplar and honour the invariants below — the chat UI parses the typed blocks and renders them as approval cards in the FloatingActionBar.

| Invariant | What it means in practice |
|---|---|
| **No autonomous loops in chat** | Every iteration OPENS and CLOSES with a typed plan block (`iteration-plan`, `edit-plan`, `panel-review`, …). End the turn after emitting the block. The operator replies `APPROVAL [<id>]: approve <items>` (or amends) before the next action runs. Cron-driven loops (`business-operator`, `solopreneur-loop`, `codex-maintainer`) have their own gating via `approval_gates` / Slack inline buttons — not chat blocks. |
| **Bounded per cycle** | Each iteration declares `scope` (`"static-audit" \| "fix-pr" \| "stop" \| …`), an `intent` (one sentence), and an explicit `items[]` list. Items the operator doesn't approve never run. 2 ≤ items ≤ 6 — bigger lists mean the plan should've been two cycles. |
| **Cost-aware** | Before proposing the next iteration call `checkKillSwitch(businessSlug)` (per-business loops) AND check `usage.claude_max.sessionSharePct` against the session's `plan_window_share_pct`. If approaching the cap, propose `scope: "stop"` not `scope: "continue"` — the operator can override. |
| **Verify-then-propose** | Never emit the next plan before parsing the current cycle's output. Findings go in a typed block (`bug-hunt-finding`, `edit-group-complete`, …) so the chat poll route can persist them server-side — the agent has no direct DB tool. Emit completion blocks LAST after every side effect succeeded, so a mid-cycle crash leaves the resume hint anchored on the same group next turn. |
| **Stop-eligible by default** | Suggest `scope: "stop"` when two cycles return zero net-new signal, when usage is ≥ 95% of the plan-window cap, when `iteration_count >= max_iterations - 1`, or when all open findings are resolved. Operator picks "stop" or "extend"; never decide alone. |
| **No production mutations from inside the loop** | Deploys, env writes, secret rotation, customer-facing messages, payment mutations — all go to a `manual-task` block, never executed by the loop. Open drafts (`draft: true` PRs, proposed env diffs, pending audits); the operator merges. |
| **Memory on exit** | When a cycle uncovers a generalisable lesson (incident class, recurring vendor quirk), write one `memory_atom` linked to the relevant MOC per the [Post-incident memory protocol](#post-incident-memory-protocol). Trivial findings (one-line fixes, single-file typos) skip the atom — atom spam dilutes the signal. |

If your new agent matches an existing exemplar's shape, fork its spec into `.claude/agents/<slug>.md` and replace the domain-specific parts (block names, scope values, tool list). The invariants above are not negotiable — they're what keeps the loop reviewable and abortable.

### Platform debug loop pattern

A closed-loop variant of the Ralph pattern aimed at platform regressions: when an end-to-end verification surface goes red (a Playwright spec, a `/api/health/deep` upstream, a stack trace in `log_events`), a Codex-driven agent iterates "make a change → re-run the verification → grade → propose next iteration" until the verification is green or the cost cap fires. **Shipping in two stages** so the verification primitives prove value on their own before a loop agent depends on them:

- **Phase 1 (this initiative — verification primitives only):** a root-level [`tests/playwright/`](tests/playwright/) Playwright suite covering critical operator flows + a new owner-only [`GET /api/health/deep`](app/api/health/deep/route.ts) endpoint returning per-provider liveness for `claude_gateway`, `codex_gateway`, `supabase`, `redis`. Both are operator-owned and useful immediately to humans investigating production issues.
- **Phase 2+ (future initiative):** a `codex-debug-loop` agent (forked from [bug-hunt-loop](.claude/agents/bug-hunt-loop.md), retry semantics borrowed from [skill-trainer](.claude/agents/skill-trainer.md)) running inside a per-branch dev sandbox container (sibling to [`services/nexus-sandbox/`](services/nexus-sandbox/)), dispatching fix-attempts through the existing [codex-gateway](services/codex-gateway/) per [ADR 002](docs/adr/002-codex-gateway-sandbox.md). Plan: [`task_plan-codex-debug-loop.md`](task_plan-codex-debug-loop.md).

When Phase 2 lands, the loop agent inherits every Ralph-loop invariant above (operator-gated kickoff, bounded iterations, cost-aware via `checkKillSwitch`, draft PRs only, no auto-merge) and adds two more specific to this pattern:

| Extra invariant | What it means in practice |
|---|---|
| **Tests are operator-owned, not loop-writable** | The loop agent must NEVER edit files under `tests/playwright/` or `playwright.config.ts`. Phase 2 enforces this via filesystem permissions in the per-branch sandbox container; Phase 1 just establishes the directory boundary so future enforcement is a config flag, not a refactor. Otherwise the loop can game "passing" by deleting the failing test. |
| **Verification is the grader, not the agent's self-assessment** | The loop's stop-decision reads the structured output of the Playwright suite + `/api/health/deep`, never the agent's own claim of "I think it's fixed." Mirrors skill-trainer's `passes_required: 3` semantic — the agent doesn't get to grade its own work. |

`services/qa-runner/` (post-deploy production smoke against the live Vercel deploy) is a **distinct system** — same Playwright framework, different runtime and purpose. It stays the production safety net; `tests/playwright/` is the local + loop-time verification layer.

### Departments + ecosystem-agnostic teams

The "team" abstraction in this codebase is two-axis: a **department** (a named bundle of role specs + approval gates + KPI hooks) bound to an **ecosystem set** (concrete adapters for `video`, `code`, `design`, `memory`, … capabilities). Both axes are pluggable — swapping a business's Content video provider from Higgsfield to Runway is one DB-row update; no agent spec edits.

| Surface | Location |
|---|---|
| Architecture overlay | [task_plan-departments-and-ecosystems.md](task_plan-departments-and-ecosystems.md) |
| Adapter contract | [lib/ecosystems/types.ts](lib/ecosystems/types.ts) — every adapter implements `EcosystemAdapter` |
| Adapter registry | [lib/ecosystems/registry.ts](lib/ecosystems/registry.ts) — `getEcosystem(kind, name)` |
| Starter departments | [lib/teams/departments.ts](lib/teams/departments.ts) — 7 starter slugs (executive, engineering, design, content, sales-cs, operations, research) |
| Default bindings | [lib/teams/default-bindings.ts](lib/teams/default-bindings.ts) — per-niche ecosystem defaults |
| Spawn helper | [lib/teams/template.ts](lib/teams/template.ts) — `materialiseTeam()` |
| Persistence | [lib/teams/store.ts](lib/teams/store.ts) — `teams` + `team_members` tables (migration 060) |
| Spawn API | [app/api/teams/spawn/route.ts](app/api/teams/spawn/route.ts) |
| Admin UI | [app/(protected)/teams/page.tsx](app/(protected)/teams/page.tsx) |
| Org-chart UI (v3) | [app/(protected)/teams/org-chart/page.tsx](app/(protected)/teams/org-chart/page.tsx) — re-parent reporting lines, file custom departments |
| Lead-agent template | [.claude/agents/departments/_template.md](.claude/agents/departments/_template.md) |
| Role template (v2) | [.claude/agents/departments/_role-template.md](.claude/agents/departments/_role-template.md) |
| Concrete leads (all 7) | `.claude/agents/departments/{content,design,engineering,executive,sales-cs,operations,research}/<dept>-lead.md` |
| All role rosters (v3) | `.claude/agents/departments/<dept>/<role>.md` — 30+ specs across the 7 departments |

Rules for new ecosystems / departments:
- A new ecosystem adapter = a file under `lib/ecosystems/adapters/<name>.ts` + a row in `registry.ts`. Zero changes to department code.
- A new department = a row in `DEPARTMENTS` + (optionally) a lead spec under `.claude/agents/departments/<slug>/`. Roles can be added incrementally — empty `roles[]` is valid.
- Adapters MUST implement `available()` truthfully and return `{ ok: false, error: 'unavailable' }` when env vars are unset. Never crash the platform if an optional ecosystem isn't wired.
- Role specs are ecosystem-agnostic: declare verbs (`render_clip`, `generate_module`), let the registry resolve to the bound adapter at dispatch time. Provider names never appear in spec prose (the [`check:provider-agnostic`](AGENTS.md#pre-commit-checklist) script enforces).

Custom org-chart arrangements (custom departments, role borrowing, per-role ecosystem overrides, time-bounded teams, org-chart templates) are scoped as a future plan inside `task_plan-departments-and-ecosystems.md` — v1 ships the durable spine; the rearrangement UI is a follow-up.

### Harness taxonomy (Life-Harness layers `h2`–`h5`)

Absorbed from [Life-Harness](https://arxiv.org/abs/2605.22166) (Peking University, May 2026). Their headline insight is that **most LLM-agent failures come from interface mismatches, not model limits** — so adapt the harness (frozen LLM, evolving interface) instead of the weights. Their 4-layer taxonomy organises every harness intervention into one of these buckets. Nexus's surfaces already cover all four; the taxonomy is the org chart, not new code.

| Layer | What it does | Where it lives in Nexus |
|---|---|---|
| **`h2` — action realization** | Converts the model's stated action into an executable environment call. Tool wrappers, MCP shims, retry-on-malformed-args. | [`services/mcp-codex-delegate/`](services/mcp-codex-delegate/), [`lib/composio/actions.ts`](lib/composio/actions.ts), [`lib/n8n/finalize.ts`](lib/n8n/finalize.ts) (canonicalises agent-emitted JSON). |
| **`h3` — environment contract** | Tells the agent at runtime what tools / accounts / scopes exist for the current step. Tool budgets, MCP manifest, account discovery. | [`lib/businesses/mcp-manifest.ts`](lib/businesses/mcp-manifest.ts) (per-niche tool roster), `inputs.tools[]` (≥ 2-option budget on every dispatch), `connected_accounts` (the live account roster). |
| **`h4` — trajectory regulation** | Bounds the multi-step trajectory: when to ask for permission, when to stop, when to roll back. The Ralph-loop invariants live here. | [Operator-gated loop pattern](#operator-gated-loop-pattern-ralph-loop) (iteration-plan, edit-plan, scope=`stop`), [`PermissionPromptCard`](components/platform-chat/PermissionPromptCard.tsx), `approval-request` blocks, cost-guard kill switch ([`lib/cost-guard.ts`](lib/cost-guard.ts)). |
| **`h5` — procedural skill** | Reusable named procedures the agent can invoke. Each is a small, evaluable unit. | [`.claude/skills/<name>/SKILL.md`](.claude/skills/) (firecrawl, frontend-design, molecularmemory, signals-briefing), [`skill-trainer`](.claude/agents/skill-trainer.md) (closed upskilling loop, single-skill), **[`sub-harnesses`](.claude/sub-harnesses/) — COMPOSITE h5: a `mode=synthesize` Loop ([`loop-runner`](.claude/agents/loop-runner.md)) crystallizes skills + agent refs + tool manifest + tests + review-spec into a `.claude/sub-harnesses/<slug>/HARNESS.md` + a `sub_harnesses` row; replayable via [`/api/sub-harnesses/[slug]/invoke`](app/api/sub-harnesses/[slug]/invoke/route.ts) once verified**, [`/api/skills/[slug]/promote`](app/api/skills/[slug]/promote/route.ts) + [`/api/sub-harnesses/[slug]/promote`](app/api/sub-harnesses/[slug]/promote/route.ts) (draft → verified gates). |

Two operating invariants the taxonomy makes explicit:

- **Interface-only adaptation.** The model is frozen. Every "improvement" we ship lands in one of the four layers above — never in the LLM. The corollary is the **provider-agnostic invariant**: any hook or skill must work across `LLM_PROVIDER` swaps (Claude → Mimo → Ollama). Enforced by `npm run check:provider-agnostic`.
- **Cross-model transferability is the gold standard.** When you write a new skill / hook, ask "would this still make sense if the model were Qwen3 instead of Claude?" If not, it belongs in the agent spec (a per-agent prompt edit), not in `h5`. Life-Harness showed an `h2-h5` set evolved on Qwen3-4B transferred to 17 other models with 88.5% avg improvement — same property we want.

When you're proposing a fix and unsure where it lives, walk the layers: is this an `h2` (tool argument shape), `h3` (the agent doesn't know X tool exists), `h4` (it kept going when it should've stopped), or `h5` (a procedure worth reusing)? The right layer is usually obvious — and the wrong layer leaks across the others.

### Write Size Discipline (avoid Opus stream timeouts)

Long single-shot Write/Edit/Bash payloads are the #1 cause of API stream errors on Opus. The PreToolUse hook `.claude/hooks/check-write-size.sh` enforces these limits — exceeding them blocks the call with a chunking instruction. Defaults: 300 lines / 10 KB per Write/Edit, 300 lines per Bash heredoc.

Patterns to use, in order of preference:

- **New large file → skeleton + fill.** Write the file with section headers + empty bodies in call 1; Edit each section in its own call.
- **Existing file → Edit, never Write.** Re-emitting the full file to change a few lines wastes the stream and risks timeout. For multi-section refactors, use anchored Edits (unique section markers) so each pass is idempotent.
- **Append-only content → Bash heredoc append.** `cat >> path <<'EOF' ... EOF` keeps the model emitting only the new chunk.
- **Bulk generated data → external script.** For 1k+ lines of seed data or scaffolded code, write a small Node/Python generator and run it once. Stream the *script*, not the data.
- **After each chunk, Read to verify.** Stream errors leave files in undefined state — never blindly retry.

For long-horizon work in `task_plan.md`: every atomic task should fit in one tool call under the 300-line cap. If a task implies a 1000-line file, split it into `Task Na — scaffold`, `Task Nb — section A`, `Task Nc — section B`. Commit per chunk so a stream error costs at most one task.

### Pre-commit Checklist
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `npm run check:retry-storm` passes (or any new finding has a `// retry-storm-check: ignore` comment with a one-line justification)
- [ ] `npm run check:sentry-config` passes — Sentry configs use the shared `tracesSampler` (no `tracesSampleRate > 0.05`) AND any new polling endpoint (`setInterval(fetch('/api/...'), N)`) is listed in `SKIP_PATTERNS` at [`lib/sentry/sampler.ts`](lib/sentry/sampler.ts). The 2026-05-12 incident burned the 5M-spans-in-3-days budget cap; this check prevents regressions.
- [ ] `npm run check:topology` passes — no references to retired infra (KVM2, KVM1, ChatProviderToggle) outside the per-entry allowlist in [`scripts/check-topology.mjs`](scripts/check-topology.mjs). When retiring new infra (host, service, component), add a new `RETIRED` entry in that file so subsequent drift surfaces mechanically. Use `// topology-check: ignore` on the rare line that intentionally documents the historical reference.
- [ ] `npm run check:agent-spec-freshness` passes — every `.claude/agents/*.md` has a `topology_last_verified: YYYY-MM-DD` field in its frontmatter, dated within the last 90 days. If you touch a spec, bump the date to today. If the check fails for a spec you didn't touch: open it, read it end-to-end (especially platform-topology references), then bump the date — the act of stamping IS the audit.
- [ ] `npm run check:provider-agnostic` passes — `.claude/agents/*.md` and `.claude/skills/**/SKILL.md` don't pin specific model versions (e.g. `claude-sonnet-4-6`, `gpt-5.5`, `qwen3-4b`) in their prose body. Frontmatter `model:` field is allowed — it's an intentional per-agent pin. Absorbed from [Life-Harness](https://arxiv.org/abs/2605.22166): a harness evolved on Qwen3-4B transferred to 17 other models with 88.5% avg improvement when the interface stayed model-agnostic. Use `<!-- provider-agnostic-check: ignore -->` on the rare line that documents the routing-alias mapping itself.
- [ ] `npm run check:cron-route` passes — every route under `app/api/cron/*` returns 200 (with `{ok:false, error}` on transient failure), never 5xx. Born from the 2026-05-25 post-deploy-smoke auto-disable incident: cron-job.org disables a job after ~26 consecutive 5xx. Use `// cron-check: ignore` on the rare line that intentionally returns 5xx, with a `TODO(vN)` note. Auth warnings (no `CRON_SECRET` check) are non-blocking but should be triaged — add `// cron-check: auth-ok` only if the route legitimately runs unauthenticated (e.g. Vercel-cron-only).
- [ ] `npm run check:codeql-patterns` passes — catches the three CodeQL alert families that repeatedly land on Nexus PRs and burn a fix-cycle each time: **js/request-forgery** (SSRF — `new URL(req.url).origin` patterns + `url.includes('host.com')` substring checks), **js/clear-text-logging** (secret-shaped `process.env.X_TOKEN` reaching `console.*` without redaction), **js/path-injection** (`fs.*` / `require()` / `import()` with unsanitised slug interpolation). Use `// codeql-check: ignore` on the rare line that intentionally trips a pattern, with a one-line rationale. CodeQL's data-flow analysis catches more paths than these regex checks — but these regex checks catch the shapes that DEFINITELY trip CodeQL, so the operator doesn't burn a PR cycle round-tripping the same fix.
- [ ] `npm run check:operator-commands` passes — every operator-facing `npm run <x>` is documented in [`docs/runbooks/operator-commands.md`](docs/runbooks/operator-commands.md) (the mechanical half of the Script↔docs sync rule above). Internal scripts (`check:*`, `test:*`, `build`, `dev`, `lint`, `seed:*`, `types:*`, `sync:*`) are allowlisted by prefix in [`scripts/check-operator-commands.mjs`](scripts/check-operator-commands.mjs); `X:local`/`X:dry` variants ride on the base command's docs. A new operator command fails the check until documented (or explicitly allowlisted as non-operator-facing).
- [ ] **For UI changes**: verified at BOTH `1280px` (laptop) and `375px` (mobile iPhone) viewports. The operator manages Nexus from his phone while travelling — `grid-cols-2 lg:grid-cols-6` without a `sm:` fallback is a P0 regression. The Playwright `iphone` + `android` projects (`npx playwright test --project=iphone`) catch layout-class regressions mechanically. For changes touching `app/layout.tsx`, SSR meta tags, or root-level responsive behaviour, ALSO run `npx playwright test --project=real-device-mobile` — that project uses an iOS Safari UA without Playwright's device-injection so the page's own `<meta name="viewport">` is the only thing controlling responsive scaling (catches the PR-301 incident class). For an at-a-glance check, use Chrome DevTools' device toolbar at 375×812. Phase 2 of `task_plan-mobile-copilot.md`.
- [ ] All interactive components have `'use client'`
- [ ] No browser globals (`window`, `document`) in Server Components
- [ ] Icons verified to exist in lucide-react
- [ ] No secrets committed (check with `git diff --staged`)
- [ ] `ROADMAP.md` updated if a feature was completed or added
- [ ] **Script ↔ docs sync (bidirectional).** If this commit adds, renames, removes, or **changes the behaviour / target host / flags** of a script (`scripts/*`, `.claude/skills/*/cli.mjs`, any `package.json#scripts` entry, `services/*/run-*.sh`), update **every** doc that references it **in the same PR**: at minimum [`docs/runbooks/operator-commands.md`](docs/runbooks/operator-commands.md) (the canonical operator reference — stale commands there get copy-pasted into terminals and run as-is), plus the script's own header comment, and any runbook that documents the workflow. A *behaviour* change with no rename still counts — e.g. when `scripts/deploy.sh` switched its deploy target from KVM4 → the Mac local-OS stack (2026-06-04), the command string `npm run deploy -- --nexus-app` was unchanged but what it *did* changed, so its docs had to change too. Reverse direction: if you edit a command in a doc, confirm the underlying script actually does that. Grep for the script/command name across `docs/` + `AGENTS.md` + `CLAUDE.md` before declaring done.
- [ ] **Infra-impact check** — if the commit touches `services/`, `scripts/migrate-*`, `Dockerfile*`, `docker-compose*.yaml`, `vercel.json`, or any Coolify / Doppler / Cloudflare config:
  - [ ] Did this change *which host runs which service*, or retire / migrate / replace a managed resource? If yes → update the **Topology** paragraph near the top of this file IN THE SAME PR.
  - [ ] Did this change add or remove an env var? If yes → `memory/platform/SECRETS.md` in the same PR.
  - [ ] After the migration script completes, follow the [Post-infrastructure-change memory protocol](#post-infrastructure-change-memory-protocol) below and write a `memory_atom` so future sessions see the new topology via `memory_search`.
- [ ] **Superseding-component check** — if this commit adds a component / hook / API that replaces another, **delete the superseded render sites in the same PR** (not just deprecate the file). The 2026-05-24 ChatProviderToggle pill survived for weeks after `ModelSelector` shipped because its render sites in `PlatformChat.tsx` / `BusinessChat.tsx` were never deleted; the old behaviour silently coexisted alongside the new dropdown.
- [ ] **Multi-PR end-of-session sanity** — if this session opened more than one PR (stacked branches), run `gh pr list --author "@me" --state open --json number,headRefName,mergeable,mergeStateStatus` BEFORE declaring done. For any `mergeable: CONFLICTING`, rebase + resolve from OLDEST PR first (mainline-merging the oldest shifts main; newer stacked PRs need a re-rebase). Procedure documented in [CLAUDE.md → End-of-multi-PR-session](CLAUDE.md#end-of-multi-pr-session--verify-each-pr-is-mergeable). Skip when the session opened exactly one PR.
- [ ] **Parallel-PR shared-file discipline (prevents the recurring `task_plan` merge conflict)** — when ONE session will open MORE THAN ONE PR, do NOT let more than one of them edit the same shared *append-target* file: a `task_plan-*.md` `## Progress` section, `memory/` logs, `docs/adr/INDEX.md`, `CHANGELOG`, `ROADMAP.md`. **Parallel EOF-appends to the same file 3-way-merge-CONFLICT even though both sides are pure additions** — git can't auto-merge "both branches added different lines after the same last line," and it *cascades*: resolving by union re-conflicts the instant the first PR merges and shifts `main`. The 2026-05-30 session hit this on [#450](https://github.com/pinnacleadvisors/nexus/pull/450)/[#451](https://github.com/pinnacleadvisors/nexus/pull/451) (both appended a `task_plan` Progress note off the same base). **Rule: keep feature PRs CODE-ONLY; carry the plan / Progress / doc-index update for the whole batch in exactly ONE PR (a dedicated docs PR, or one nominated PR of the batch that owns the shared file).** If the conflict already happened, the robust fix is to **drop** the append from all-but-one PR — during the rebase run `git checkout origin/main -- <shared-file> && git add <shared-file> && git rebase --continue`, which turns the feature PR code-only — NOT a union (union cascades). Same root-cause family as the [End-of-multi-PR-session](CLAUDE.md#end-of-multi-pr-session--verify-each-pr-is-mergeable) protocol; this checklist item is the *prevention*, that one is the *recovery*.

### Retry-storm vulnerability checklist (run mentally for every change)

Lightweight version of `docs/RETRY_STORM_AUDIT.md` — if your change touches any of the surfaces below, walk the corresponding question. The static check (`npm run check:retry-storm`) catches the patterns mechanically, but these contextual judgement calls only show up here.

**If you added or modified an API route…**
- [ ] Will any external service call this route AND auto-retry on 5xx? (n8n: 3×, claw: 5×, Stripe: until 4xx for 3 days, Slack: rare, **cron-job.org: AUTO-DISABLES after ~26 consecutive 5xx** — 2026-05-25 `post-deploy-smoke` incident; the route returned 502 on qa-runner unreachability, cron-job.org disabled it after the 26-failure threshold. Operator sees the disable as a "your cronjob has been disabled" email and the cron silently stops firing.). If yes → return **200 + `{ok: false, error}`** instead of 5xx, OR call `claimEvent('source', eventId)` from `lib/webhooks/idempotency.ts` BEFORE any side effects so replays are no-ops. For cron-job.org specifically: also wire the cron into `/cron-health` (auto from `Nexus:` titled jobs) so the operator sees yellow/red before the disable threshold hits.
- [ ] Does the route make any paid LLM / search / video API call? Did you wire `lib/cost-guard.ts` so the call counts against `USER_DAILY_USD_LIMIT`?

**If you added or modified an Inngest function…**
- [ ] Did you set an explicit `retries:` on `createFunction`? Default is 3 — multiplies paid-call cost by 4× on flaky upstreams.
- [ ] Are individual `step.run` blocks wrapped in try/catch where appropriate, returning `{error}` instead of throwing? One throw triggers function-level retry of EVERY step before it.

**If you added or modified a Vercel cron route…**
- [ ] Is the route idempotent? A failed cron re-fires next slot — does the side effect (insert / external call) gracefully handle "I already did this"?
- [ ] Does it return 200 even on partial failure? 5xx prompts Vercel to log failure but does NOT re-fire (which is correct), but unhandled exceptions DO show up in alerts.

**If you added a `setInterval` / WebSocket reconnect / polling pattern in a Client Component…**
- [ ] Replace `setInterval(fetcher, N)` with `usePollWithBackoff(fetcher, { intervalMs: N })` from `lib/hooks/usePollWithBackoff.ts`. Bare `setInterval` keeps hammering a 5xx endpoint forever.

**If you added an outbound `fetch` to a paid or rate-limited service…**
- [ ] Did you add `signal: AbortSignal.timeout(15_000)` (or appropriate timeout)? A hung fetch holds the function open until Vercel's 60s platform timeout fires.
- [ ] Does the parent caller retry on failure? If yes, does the per-call cost matter? Use `lib/health/circuit-breaker.ts` `withBreaker()` wrapper to skip calls when the breaker is tripped.

**If you added a `tasks` table insert…**
- [ ] Use `insertTask(db, row)` from `lib/board/insert-task.ts` instead of raw `db.from('tasks').insert(...)`. The helper falls back to lineage-free inserts if migration 025 isn't applied — prevents the 2026-05-03 incident class.
- [ ] Exception: chained `.insert(...).select('id').single()` (because the helper doesn't expose the row id) — add a `// retry-storm-check: ignore` comment with a one-line justification.

**If you wrote a new SQL migration…**
- [ ] Is the migration idempotent? Use `IF NOT EXISTS` / `DROP POLICY IF EXISTS` / `ON CONFLICT` so re-running it is safe.
- [ ] Does it add any column that existing app code might INSERT into before the migration is applied in production? If yes, the existing `lib/board/insert-task.ts` fail-soft pattern is your model — write a similar runtime detection.

**General — for any change touching shared infrastructure…**
- [ ] If a new external integration was added, append a row to `docs/SPEND_CAPS.md` Tier 1 or 2.
- [ ] If a new pattern was discovered, add a row to `docs/RETRY_STORM_AUDIT.md`.

The mechanical check (`npm run check:retry-storm`) takes ~1s and catches the 6 grep-detectable patterns. The contextual checklist above takes ~30s of mental effort and catches the patterns that need human judgement. Run both before every commit that touches the surfaces above.

### Webhook self-amplification checklist (log feedback loops)

Cousin of retry-storm: a webhook receiver whose own output is fed back into itself by the same upstream that triggered it. Common shapes — Vercel log drains ingesting their own function logs, Sentry breadcrumbs hitting an endpoint that emits more breadcrumbs, an analytics POST handler that calls `console.log()` which the runtime ships to a drain pointing back at it. Cost grows superlinearly with rate; memory + invocation count both inflate even though no single call is expensive. We hit this on 2026-05-04 with `/api/vercel/log-drain` running at 70-100 req/s and 338MB middleware memory. Fix pattern is always: (1) drop the matcher / auth that doesn't apply, (2) filter self-traffic at the receiver before any side effect.

**If you added a webhook receiver that the platform also logs/observes…**
- [ ] Does the upstream observe its own function invocations? (Vercel log drains, Datadog log forwarders, Axiom drains, anything wired to a "send all logs" sink). If yes, filter lines where `proxy.path === '<this route>'` BEFORE writing anything downstream — the existing pattern is `/api/vercel/log-drain` which drops self-traffic at [route.ts](app/api/vercel/log-drain/route.ts).
- [ ] Are you `console.log`ing inside the handler? Each log line is one more event the upstream will deliver back. Demote to `console.warn` only on real errors, and keep them short — long messages mean larger NDJSON batches when they loop.
- [ ] Is the receiver returning 5xx on transient failure? Most observability platforms retry. Combine with the retry-storm rule: return **200 + `{ok: false}`** for non-fatal errors.

**If you added an HMAC- or signature-authenticated webhook route…**
- [ ] Confirm the middleware matcher in [proxy.ts](proxy.ts) excludes the route. Clerk auth on a route that's already auth'd by HMAC adds ~300MB middleware memory per invocation and gives zero security benefit. Use the negative-lookahead pattern in the existing matcher (`(?!api/vercel/log-drain)...`).
- [ ] Are heavy SDKs (AWS S3, Supabase service-role, Stripe) imported at module scope inside the route? At 70+ req/s these cold-start every container instance. Lazy-import inside the handler so the import cost is per-instance, not per-bundle.

**If you wired a third-party drain pointing at a Nexus route…**
- [ ] Does the destination route's path appear in the drain's own filter / exclusion config in the upstream dashboard? Vercel drains have an exclusion list — set it as defense-in-depth on top of the receiver-side filter.
- [ ] Document the drain in `memory/platform/SECRETS.md` so future ops work knows the loop topology.

### Post-incident memory protocol

When you finish a debugging session, root-cause investigation, or non-trivial fix that produced a generalisable lesson, write the lesson to memory-hq before ending the session. This is the mechanism that prevents the same incident class from being re-discovered cold by a future Claude session — the molecular memory atoms in `pinnacleadvisors/memory-hq` are queryable from any repo, by any model, at any time.

**Default — MCP `memory-hq` server (preferred when available):**

```json
memory_atom({
  scope:    { repo: "pinnacleadvisors/nexus" },
  payload:  {
    title:      "<short indexable phrase, include date if recurring class>",
    body:       "<symptom · root cause · fix (commit SHA) · forward-looking prevention>",
    kind:       "incident",
    importance: "high"
  },
  locators: [
    { kind: "github", repo: "pinnacleadvisors/nexus", path: "<file/route/migration>" }
  ],
  links: ["[[mocs/memory-and-cost-incidents]]"]
})
```

The MCP server is registered in `~/.claude/settings.json` (Claude Code) and `~/Library/Application Support/Claude/claude_desktop_config.json` (Claude Desktop). If `memory_atom` isn't in your tool list, the server failed to start — see fallback below.

**Fallback — CLI with explicit `--backend=github`:**

```bash
node .claude/skills/molecularmemory_local/cli.mjs --backend=github atom \
  "<title>" --fact="<one-line summary>" --source=<commit-sha-or-file>
```

`MOLECULAR_BACKEND=github` is set in Doppler so `--backend=github` is also the default — but state it explicitly when invoking from a script so the intent is reviewable.

**When to write an atom:**
- A bug whose root cause wasn't obvious from the surface (webhook self-amplification, missing migration cascade, eager SDK init, retry storm).
- A non-obvious config / secret / infra interaction the next session would re-discover (Coolify quirks, Cloudflare Tunnel topology, MCP path resolution).
- A pattern that should also become a checklist row in `AGENTS.md` or `docs/RETRY_STORM_AUDIT.md` — the atom is the case study, the checklist is the prevention.
- A new entity (person, company, vendor product, internal service) the codebase now depends on — write an `entity` instead of an `atom`.

**When to skip:**
- Trivial fixes (typo, one-line config, filename rename, dependency bump). Atom spam dilutes the signal.
- The lesson is already covered by an existing atom — extend the atom's body or its MOC instead of duplicating.
- The user explicitly said "don't record" or the work is private to the session.
- The "fix" hasn't been verified yet — write the atom AFTER the fix lands and is confirmed working, not before.

**Linking and discoverability:**
- Always link to the relevant MOC (`mocs/memory-and-cost-incidents`, `mocs/claude-code-gateway`, etc.). Atoms without a MOC link become orphans on the next `cli.mjs lint` run.
- If no MOC exists for the lesson's category, create one with `cli.mjs moc`. A 3-atom MOC is more valuable than 3 orphan atoms.
- After writing, verify with `memory_search` (MCP) or by reading `pinnacleadvisors/memory-hq/atoms/55bedf46-nexus/<slug>.md` — the canonical scope-id for this repo is `55bedf46-nexus`.

**Source-of-truth note:** memory-hq is the canonical store; `memory/molecular/` in this repo is a development cache. After a successful MCP write, you do NOT need to also write to local. The Supabase mirror webhook on `pinnacleadvisors/memory-hq` propagates the atom to `mol_*` tables within seconds.

### Post-infrastructure-change memory protocol

Sibling to the post-incident protocol above. **Whenever you decommission, migrate, or replace a host / service / container / managed resource, write a memory-hq atom in the same session as the change** — before the chat ends, before the PR opens. The 2026-05-24 platform-state cleanup ([PR #300](https://github.com/pinnacleadvisors/nexus/pull/300)) had to retroactively document a KVM2 retirement that happened 2 weeks earlier ([scripts/migrate-to-lean-kvm.mjs](scripts/migrate-to-lean-kvm.mjs)) because the migration session never wrote one. Every subsequent agent session was reasoning about a dead topology.

**Default — MCP `memory-hq` server:**

```json
memory_atom({
  scope:    { repo: "pinnacleadvisors/nexus" },
  payload:  {
    title:      "<old-host>/<service> → <new-host>/<service> migrated YYYY-MM-DD",
    body:       "<what moved> · <why> · <script or PR that did it> · <verification command> · <doc updates landed in same PR>",
    kind:       "infra-change",
    importance: "high"
  },
  locators: [
    { kind: "github", repo: "pinnacleadvisors/nexus", path: "scripts/migrate-<topic>.mjs" }
  ],
  links: ["[[mocs/platform-topology]]"]
})
```

**When to write an infra-change atom:**
- Migrated a service between hosts / KVMs / Coolify instances (e.g. KVM2 → KVM4, Hostinger → Coolify)
- Decommissioned a host, container, or managed resource
- Replaced a managed resource with another (Vercel → Coolify, Hostinger n8n → Coolify n8n, polling → SSE, etc.)
- Retired an env var, secret, or Doppler config
- Renamed or relocated a service in a way that breaks existing URLs / health-check paths
- Swapped a vendor (Resend → Postmark, etc.) or auth provider

**When to skip:**
- A version bump of an existing service in place (`claude-gateway:v1.2 → v1.3` on the same host). That's a deploy, not an infra change.
- A rename inside the same host with no host-level effect (renaming a container without changing what it does).

**Linking:**
- Always link to `[[mocs/platform-topology]]`. Create that MOC the first time if it doesn't exist — it becomes the canonical entry point for "what runs where, when did it last change". Subsequent atoms link to the same MOC so the timeline reconstructs itself.
- Reference the migration script or PR by exact GitHub path. Cold-reading the atom 6 months later, the next agent needs to find the script.

**Concrete example** — the right atom to have written on 2026-05-22:

```
title: "codex-gateway: KVM2 (Hostinger) → KVM4 migrated 2026-05-22"
body:  "Codex-gateway container relocated from Hostinger KVM2 to KVM4 (Coolify shared host) via scripts/migrate-to-lean-kvm.mjs --apply per ADR 006 (lean-mode pivot). KVM2 VPS decommissioned. Verification: npm run diagnose:codex → /health passes on new host. AGENTS.md Topology paragraph updated in same PR. COOLIFY_KVM2_* env vars retained in Doppler as dead-weight; new scripts use COOLIFY_KVM4_* exclusively."
kind: infra-change
importance: high
locators: [github: scripts/migrate-to-lean-kvm.mjs, github: docs/runbooks/migrate-to-lean-kvm.md, github: docs/adr/006-lean-mode-pivot.md]
links: [[mocs/platform-topology]]
```

That atom would have shown up on the very first `memory_search "KVM2"` from any subsequent session — saving the 2026-05-24 cleanup work entirely.


# Nexus — Architecture

## File Structure

```
app/
├── (protected)/          # All authenticated pages (route group — invisible in URL)
│   ├── layout.tsx        # Sidebar shell
│   ├── forge/            # Idea curation chatbot
│   ├── dashboard/        # Operations dashboard + org chart (/dashboard/org)
│   ├── board/            # Kanban board
│   ├── swarm/            # Multi-agent swarm orchestration
│   ├── graph/            # 3D relational knowledge graph
│   ├── build/            # Dev console + research loop (Phase 19)
│   ├── learn/            # Phase 23 — Duolingo-style learning surface (path/session/stats); manual Sync now button
│   ├── idea/             # Capture new ideas (description / remodel modes)
│   ├── idea-library/     # Browse captured ideas
│   ├── settings/         # Platform config + /settings/businesses (business_operators CRUD)
│   ├── signals/          # Platform-improvement inbox + LLM council
│   ├── manage-platform/  # Dev console + Research loop + Health tab (cron status + orphan sweep)
│   ├── tools/
│   │   ├── agents/       # 10 specialist agent capabilities
│   │   ├── claw/         # OpenClaw config + skill registry + status
│   │   ├── content/      # Tribe v2 neuro-optimised content engine
│   │   ├── knowledge/    # Notion / Obsidian knowledge base
│   │   ├── library/      # Reusable code / prompt / agent / skill library
│   │   ├── memory/       # Agent memory viewer (Phase 20)
│   │   ├── n8n/          # Workflow automation + bridge
│   │   └── video/        # Video generation pipeline (Phase 18, partial)
├── api/
│   ├── agent/            # Streaming specialist agent endpoint
│   ├── alerts/           # Email/Slack alert dispatcher
│   ├── audit/            # Audit log reader (auth-gated)
│   ├── board/            # Kanban CRUD
│   ├── build/            # Plan + dispatch (Phase 19) + diff viewer (A12)
│   ├── chat/             # Streaming chat (auth-gated, graph-atom short-circuit cache — C7)
│   ├── claw/             # OpenClaw proxy
│   ├── claude-session/   # Dispatch endpoint (auto-creates managed agent + forwards to OpenClaw with swarm env + run-aware A6)
│   ├── content/          # Score + generate + variants (Tribe v2, auth-gated, writes experiment variants)
│   ├── cron/             # Scheduled jobs: metric-optimiser (A9), ingest-metrics (A11), regression-sweep (C2), rebuild-graph (C8), sync-learning-cards (Phase 23), sync-memory, sweep-orphan-cards (2026-05-03), post-deploy-smoke (autonomous QA)
│   ├── businesses/       # business_operators CRUD; PATCH triggers Slack verification + creates a "🔌 connected" board card (2026-05-03)
│   ├── health/           # Owner-only health endpoints: /api/health/cron returns per-cron last-run + verdict
│   ├── dashboard/        # KPI + chart data
│   ├── experiments/      # A/B experiment CRUD (C5)
│   ├── gdrive/           # Google Drive upload
│   ├── graph/            # Graph API (full, node, path, query, context, mcp)
│   ├── inngest/          # Inngest background jobs endpoint
│   ├── learn/            # Phase 23 — session/review/grade-feynman/stats/path
│   ├── library/          # Library CRUD + search + promoteRunId (C4)
│   ├── memory/           # GitHub memory read/write/search (Phase 20 runtime)
│   ├── milestones/       # Milestone CRUD
│   ├── n8n/              # n8n workflow generate + bridge + templates
│   ├── notion/           # Notion append + search
│   ├── oauth/            # OAuth flow (provider, callback, disconnect, status)
│   ├── org/              # Agent hierarchy for org chart
│   ├── projects/         # Project CRUD
│   ├── publish/          # Publish/distribute step — YouTube live, TikTok + Instagram stubbed (A10)
│   ├── r2/               # Cloudflare R2 storage (auth-gated, URL-egress allow-list)
│   ├── runs/             # Run state machine — list/get/advance (A4)
│   ├── storage/          # Supabase Storage (auth-gated, user-id prefixed)
│   ├── swarm/            # Swarm dispatch + status + MCP
│   ├── token-events/     # Token usage logging
│   ├── video/            # Video generation + polling
│   └── webhooks/         # Stripe, Claw, n8n webhook receivers
├── layout.tsx            # Root layout (ClerkProvider)
├── page.tsx              # Sign-in page
└── globals.css           # Tailwind 4 + design tokens

components/
├── layout/               # Sidebar
├── forge/                # ChatMessages, MilestoneTimeline, GanttChart, ForgeActionBar
├── dashboard/            # KpiGrid, RevenueChart, AgentTable
├── board/                # KanbanColumn, KanbanCard, ReviewModal
├── graph/                # GraphScene (Three.js)
├── learn/                # PathView (Duolingo-style)
├── admin/                # HealthPanel — cron table + orphan-sweep buttons (Health tab on /manage-platform)
└── tools/                # ToolsGrid, ToolCard

lib/
├── types.ts              # ALL TypeScript interfaces (add new ones here) — includes Run, RunEvent, RunPhase, RunMetrics (A2)
├── mock-data.ts          # Seed data (fallback when Supabase unconfigured)
├── supabase.ts           # Supabase client
├── r2.ts                 # Cloudflare R2 S3-compatible client
├── r2-url-guard.ts       # URL egress allow-list (reject RFC1918, metadata IPs) — B3
├── crypto.ts             # AES-256-GCM encryption for OAuth tokens (fail-closed in production) — B6
├── cost-guard.ts         # Per-user daily USD cap; returns 402 when exceeded — B9
├── ratelimit.ts          # Upstash Redis rate limiter (in-memory fallback)
├── csrf.ts               # CSRF origin check
├── audit.ts              # Fire-and-forget audit log writes
├── observability.ts      # metric_samples writer; per-run + per-agent telemetry — C1
├── observability/regression.ts  # 7-day vs 24-hour p50/p95 regression detector — C2
├── oauth-providers.ts    # OAuth provider config
├── notion.ts             # Notion API client
├── memory/github.ts      # GitHub memory read/write (Phase 20 runtime)
├── runs/                 # Run controller — startRun, advancePhase, appendEvent; measure-ingester, metric-triggers — A3/A9/A11
├── publish/              # youtube.ts (live), tiktok.ts + instagram.ts (stubbed), metrics poller — A10
├── experiments/          # A/B harness — types, client, two-proportion z-test winner — C5
├── learning/             # Phase 23 — fsrs.ts (FSRS-4 scheduler), card-generator.ts, atom-sync.ts, types.ts
├── library/promoter.ts   # Promotes successful-run output into library tagged with run_id — C4
├── agent-capabilities.ts # 10+ capability definitions + system prompts
├── n8n/                  # n8n client, templates, gap-detector, types
├── swarm/                # Queen, Consensus, Router (decay C6), ReasoningBank (A8), WASM, TokenOptimiser (prompt-cache C3), GraphRetriever (A7)
├── graph/                # types, builder (force-layout, Louvain, PageRank)
├── neuro-content/        # principles, templates, tones, types
├── video/                # kling.ts, runway.ts (partial: heygen, did pending)
└── utils.ts              # cn() helper
```

## API Patterns

- All API routes → `app/api/*/route.ts` (Next.js App Router convention)
- Auth: `auth()` from `@clerk/nextjs/server` — throws 401 if unauthenticated
- Rate limiting: import `ratelimit` from `lib/ratelimit.ts`; call before expensive ops
- Supabase: try live query first, fall back to mock when `NEXT_PUBLIC_SUPABASE_URL` unset
- Streaming: `streamText` → `result.toUIMessageStreamResponse()`
- Audit: `log()` from `lib/audit.ts` — fire-and-forget, never await

## Database Access

- Client: `lib/supabase.ts` — `createClient()` (browser) / `createServiceClient()` (server writes)
- Migrations: `supabase/migrations/` — apply with `npm run migrate`
- Applied migrations:
  - 001 initial schema · 002 tasks/projects · 003 businesses/milestones · 004 RLS · 005 audit_log
  - 006 swarm · 007 libraries · 008 agent_hierarchy · 009 build_research · 010 ideas_and_automations
  - 011 agent_library_and_feedback · 012 task_types_and_dependencies · 013 token_events_user_id
  - **014 user_secrets** — encrypted per-user secret store (replaces cookie-based OpenClaw config) — B10
  - **015 runs** — Run state machine + `run_events` append-only log — A1
  - **016 plan_patterns** — ReasoningBank archive for successful decompositions — A8
  - **017 metric_samples** — per-run + per-agent observability samples — C1
  - **018 experiments** — A/B variant record with z-test winner selection — C5
  - 019 token_events_business_slug · 020 signals · 021 molecular_mirror · 022 log_events · 023 learning_system
  - **024 business_operators** — Phase A autonomous orchestrator config (slug PK, money_model JSONB, slack_webhook_url, current_run_id FK)
  - **025 tasks_lineage** — adds `idea_id`/`run_id` (FK ON DELETE SET NULL) + `business_slug` to `tasks`. Closes the orphan-card detection gap. Existing rows stay NULL (legacy-keep)
  - **026 encrypt_slack_webhook** — adds `slack_webhook_url_enc` (AES-256-GCM via `lib/crypto.ts`); plaintext column kept for back-compat until owner re-saves
  - **027 idempotency_and_dedup** — generic `webhook_events` idempotency table + dedup constraints (retry-storm audit follow-up)
  - **028 kill_switches** — six hot-reloadable feature gates (`llm_dispatch`, `auto_assign`, `scheduler`, `dashboard_mutations`, `slack_warroom`, `swarm_consensus`). Read via `lib/kill-switches.ts` with 60s cache; toggled at `/manage-platform → Switches`. Mission Control Kit Pack 02.
  - **029 molecular_salience** — adds `salience`, `pinned`, `last_used_at`, `superseded_by` to `mol_atoms` + RPCs `mol_atoms_fts_search` / `mol_atoms_vec_search`. Backs `lib/molecular/hybrid-search.ts` (RRF) and the relevance-feedback loop. Mission Control Kit Pack 06.
  - **030 audit_pinning** — adds `pinned` boolean to `audit_log`; daily `/api/cron/audit-prune` deletes rows older than 90 days where `pinned=false`. Mission Control Kit Pack 03.
- Realtime: enabled on agents, tasks, projects, milestones, businesses, swarm tables

## Key Contracts

- `proxy.ts` (middleware) reads `ALLOWED_USER_IDS` — comma-separated Clerk user IDs; if set, rejects unlisted users
- Agent outputs auto-create Board cards and append to Notion (when `notionPageId` set)
- Memory writes go to GitHub (`lib/memory/github.ts`); reads hit Supabase cache first (5-min TTL)
- **Runs are the spine** — every long-horizon idea has a `runs` row; `/api/claude-session/dispatch` accepts an optional `runId` and appends `run_events` on completion; `advancePhase()` drives the Board state
- **Cost guard** — `/api/chat` + `/api/content/generate` return HTTP 402 once a user crosses `USER_DAILY_USD_LIMIT` (default $25)
- **Graph-cache short-circuit** — `/api/chat` POST detects when a prompt maps to a single dominant molecular atom or MOC and returns the cached answer with a `<graph-cache nodeId=.../>` marker (C7)
- **Nightly graph rebuild** — `/api/cron/rebuild-graph` re-runs `.claude/skills/molecularmemory_local/cli.mjs graph` + `reindex` and logs node/orphan/degree metrics (C8)
- **Autonomous QA loop** — Vercel cron `/api/cron/post-deploy-smoke` HMAC-pings the qa-runner on Coolify; the runner mints a Clerk sign-in ticket via `/api/admin/issue-bot-session`, runs Playwright smoke specs as `qa-bot`, and on failure dispatches a fix-attempt to the self-hosted gateway. Server-side context comes from `lib/logs/vercel.ts::attachLogsToBrief` — see `task_plan-autonomous-qa.md`.
- **Vercel log drain** — Vercel JSON drain → `POST /api/vercel/log-drain` (HMAC) → R2 archive (`logs/<deployment>/YYYY-MM-DD/HH.jsonl`) + `log_events` hot-field index. Service-role only; agents query through `lib/logs/vercel.ts::searchLogs` or `POST /api/logs/slice` (bot-token auth).
- **Webhook fail-closed in production** — `/api/webhooks/n8n` (`N8N_WEBHOOK_SECRET`) and `/api/webhooks/claw` (`OPENCLAW_BEARER_TOKEN`) refuse unsigned POSTs in production with 503 when their secret env var is unset. Dev still allows the unsigned path so local OpenClaw / n8n iteration works.
- **Visible-failure surface** — `/manage-platform` Health tab + `GET /api/health/cron`. Each cron in `vercel.json` is mirrored in `app/api/health/cron/route.ts` `CRONS` array; verdict is green/amber/red based on `log_events` last invocation. Adding a new cron requires updating BOTH files.
- **Orphan-card sweep** — nightly `/api/cron/sweep-orphan-cards` at 04:30 UTC + `POST ?dryRun=1` for the admin button. See atom `[[orphan-sweep-cron]]`.
- **Slack webhook verification on save** — `POST /api/businesses` compares `slack_webhook_url` against the persisted row; if changed, calls `lib/slack/client.ts::postVerification()` which sends a Block Kit "✅ connected" message AND inserts a `🔌 Slack connected` card into the `review` column. Failures return `slack_warning` in the response so the UI can prompt the owner to retry.

## New routes (autonomous QA)

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/admin/issue-bot-session` | POST | HMAC (`BOT_ISSUER_SECRET`) | Mints a Clerk sign-in ticket the qa-runner redeems for a real session as `qa-bot`. |
| `/api/vercel/log-drain` | POST | HMAC (`VERCEL_LOG_DRAIN_SECRET`) | Receives Vercel NDJSON log batches, redacts sensitive headers, writes raw to R2 + indexes hot fields in `log_events`. |
| `/api/logs/slice` | POST | Bot bearer (`BOT_API_TOKEN`) | Returns a markdown slice of the last `windowSeconds` of logs for embedding in a dispatch brief. |
| `/api/cron/post-deploy-smoke` | POST/GET | Vercel `CRON_SECRET` or bot bearer | Webhooks the qa-runner with the live deployment URL. Schedule: `*/30 * * * *`. |

## New service: `services/claude-gateway/`

Self-hosted Claude Code gateway running on Hostinger + Coolify, plan-billed via 20× Max. HMAC-protected (`CLAUDE_CODE_BEARER_TOKEN`). The primary AI provider for `/api/chat` and `/api/agent` — falls back to OpenClaw, then `ANTHROPIC_API_KEY`. See `task_plan-claude-gateway.md` for the deploy walkthrough.

## New service: `services/qa-runner/`

Sits next to `services/claude-gateway/` on the Coolify host. Headless Playwright (`mcr.microsoft.com/playwright:v1.49.0-noble` base) + Hono entrypoint listening on `:3001`. On HMAC-verified `/run`:

1. POST to `/api/admin/issue-bot-session` → sign-in ticket URL.
2. Spawn `npx playwright test --workers=1` with `BASE_URL` + `BOT_SESSION_TICKET_URL` injected.
3. On failure: fetch a 30 s slice via `/api/logs/slice`, dispatch a fix-attempt to the gateway over the private `coolify` network, file a `workflow_feedback` row.

Plan-budget cost: 0 tokens on a clean deploy. ~1 dispatch on a failing one.

## New library code

- `lib/auth/bot.ts` — `authBotToken()` + `resolveCallerUserId()`. Bearer token → `BOT_CLERK_USER_ID`; uniform identity for routes accepting human-or-bot.
- `lib/logs/vercel.ts` — `searchLogs()` + `attachLogsToBrief()`. Service-role queries against `log_events`; markdown formatting for dispatch briefs.

Migration `022_log_events.sql` adds the `log_events` table (RLS deny-by-default, service-role only) with hot-path indexes on `request_id`, `created_at`, `(route, created_at)`, and a partial index on `level in ('error','warn')`.

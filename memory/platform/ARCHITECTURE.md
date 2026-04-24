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
│   ├── cron/             # Scheduled jobs: metric-optimiser (A9), ingest-metrics (A11), regression-sweep (C2), rebuild-graph (C8)
│   ├── dashboard/        # KPI + chart data
│   ├── experiments/      # A/B experiment CRUD (C5)
│   ├── gdrive/           # Google Drive upload
│   ├── graph/            # Graph API (full, node, path, query, context, mcp)
│   ├── inngest/          # Inngest background jobs endpoint
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
- Realtime: enabled on agents, tasks, projects, milestones, businesses, swarm tables

## Key Contracts

- `proxy.ts` (middleware) reads `ALLOWED_USER_IDS` — comma-separated Clerk user IDs; if set, rejects unlisted users
- Agent outputs auto-create Board cards and append to Notion (when `notionPageId` set)
- Memory writes go to GitHub (`lib/memory/github.ts`); reads hit Supabase cache first (5-min TTL)
- **Runs are the spine** — every long-horizon idea has a `runs` row; `/api/claude-session/dispatch` accepts an optional `runId` and appends `run_events` on completion; `advancePhase()` drives the Board state
- **Cost guard** — `/api/chat` + `/api/content/generate` return HTTP 402 once a user crosses `USER_DAILY_USD_LIMIT` (default $25)
- **Graph-cache short-circuit** — `/api/chat` POST detects when a prompt maps to a single dominant molecular atom or MOC and returns the cached answer with a `<graph-cache nodeId=.../>` marker (C7)
- **Nightly graph rebuild** — `/api/cron/rebuild-graph` re-runs `.claude/skills/molecularmemory_local/cli.mjs graph` + `reindex` and logs node/orphan/degree metrics (C8)

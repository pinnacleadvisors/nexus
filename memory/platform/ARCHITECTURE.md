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
│   ├── audit/            # Audit log reader
│   ├── board/            # Kanban CRUD
│   ├── build/            # Plan + dispatch (Phase 19)
│   ├── claw/             # OpenClaw proxy
│   ├── content/          # Score + generate + variants (Tribe v2)
│   ├── dashboard/        # KPI + chart data
│   ├── gdrive/           # Google Drive upload
│   ├── graph/            # Graph API (full, node, path, query, context, mcp)
│   ├── inngest/          # Inngest background jobs endpoint
│   ├── library/          # Library CRUD + search
│   ├── memory/           # GitHub memory read/write/search (Phase 20 runtime)
│   ├── milestones/       # Milestone CRUD
│   ├── n8n/              # n8n workflow generate + bridge + templates
│   ├── notion/           # Notion append + search
│   ├── oauth/            # OAuth flow (provider, callback, disconnect, status)
│   ├── org/              # Agent hierarchy for org chart
│   ├── projects/         # Project CRUD
│   ├── r2/               # Cloudflare R2 storage
│   ├── storage/          # Supabase Storage
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
├── types.ts              # ALL TypeScript interfaces (add new ones here)
├── mock-data.ts          # Seed data (fallback when Supabase unconfigured)
├── supabase.ts           # Supabase client
├── r2.ts                 # Cloudflare R2 S3-compatible client
├── crypto.ts             # AES-256-GCM encryption for OAuth tokens
├── ratelimit.ts          # Upstash Redis rate limiter (in-memory fallback)
├── csrf.ts               # CSRF origin check
├── audit.ts              # Fire-and-forget audit log writes
├── oauth-providers.ts    # OAuth provider config
├── notion.ts             # Notion API client
├── memory/github.ts      # GitHub memory read/write (Phase 20 runtime)
├── agent-capabilities.ts # 10+ capability definitions + system prompts
├── n8n/                  # n8n client, templates, gap-detector, types
├── swarm/                # Queen, Consensus, Router, ReasoningBank, WASM, TokenOptimiser
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
- Applied migrations: 001 (schema), 002 (tasks/projects), 003 (businesses/milestones), 004 (RLS), 005 (audit_log), 006 (swarm), 007 (libraries), 008 (agent_hierarchy)
- Realtime: enabled on agents, tasks, projects, milestones, businesses, swarm tables

## Key Contracts

- `proxy.ts` (middleware) reads `ALLOWED_USER_IDS` — comma-separated Clerk user IDs; if set, rejects unlisted users
- Agent outputs auto-create Board cards and append to Notion (when `notionPageId` set)
- Memory writes go to GitHub (`lib/memory/github.ts`); reads hit Supabase cache first (5-min TTL)

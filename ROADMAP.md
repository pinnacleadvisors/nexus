# Nexus — Platform Roadmap

> Last updated: 2026-04-15 (Phases 1–17c + 19a + 19b complete; Phases 20–22 planned)
> Goal: A fully automated, cloud-native business management platform where AI agents build, market, and maintain business ideas 24/7 — managed through a single secure dashboard.

---

## Legend
- ✅ Done
- 🔧 In progress / partial
- ⬜ Not started
- 🔒 Security-sensitive — requires audit before production use

---

## Manual Steps

> One-time tasks that require action in a browser, terminal, or third-party dashboard.
> Claude tracks SQL migrations automatically via `schema_migrations`; everything else here is manual.
> Tick each box when done.

---

### ☁️ Supabase (Database)

- [✅] Create a Supabase project at https://supabase.com/dashboard
- [✅] Add `NEXT_PUBLIC_SUPABASE_URL` to Doppler — Project Settings → API → Project URL
- [✅] Add `NEXT_PUBLIC_SUPABASE_ANON_KEY` to Doppler — Project Settings → API → anon public key
- [✅] Add `SUPABASE_SERVICE_ROLE_KEY` to Doppler — Project Settings → API → service_role secret key
- [✅] Add `SUPABASE_PROJECT_REF` to Doppler — Project Settings → General → Reference ID (e.g. `abcdefghijklmnop`)
- [✅] Add `SUPABASE_ACCESS_TOKEN` to Doppler — https://supabase.com/account/tokens → Generate new token
- [ ] **Run migrations on your MacBook:** `cd nexus && npm run migrate`
  > This uses Doppler to inject credentials and applies all pending `.sql` files via the Supabase Management API. Safe to re-run — already-applied files are skipped.
  > Alternative: paste each file into Supabase dashboard → SQL Editor in order.

#### SQL Migrations

Tracked automatically by `npm run migrate`. Update ✅/⬜ after each successful run.

| File | Description | Applied |
|------|-------------|---------|
| `001_initial_schema.sql` | Core tables: agents, revenue_events, token_events, alert_thresholds, schema_migrations | ⬜ |
| `002_tasks_and_projects.sql` | Kanban tasks + projects tables with Supabase Realtime | ⬜ |
| `003_businesses_milestones.sql` | businesses + milestones tables; user_id on projects + agents; Realtime enabled | ⬜ |
| `004_rls_policies.sql` | Row-level security on all tables; businesses per-user via Clerk JWT sub | ⬜ |
| `005_audit_log.sql` | audit_log table with indexes on user_id, action, resource, created_at | ⬜ |
| `006_swarm.sql` | swarm_runs, swarm_tasks, reasoning_patterns tables; Realtime enabled | ⬜ |
| `007_libraries.sql` | code_snippets, agent_templates, prompt_templates, skill_definitions; GIN tag indexes; RLS | ⬜ |
| `008_agent_hierarchy.sql` | Extends agents table (parent_agent_id, layer, tokens, cost); new agent_actions table | ⬜ |

> **⚠️ Cannot be run from the cloud dev environment** — migrations require `SUPABASE_PROJECT_REF` + `SUPABASE_ACCESS_TOKEN` which are only available via Doppler on your MacBook.
>
> **Adding a new migration?** Create `supabase/migrations/NNN_description.sql`, add a row above with ⬜, then run `npm run migrate`.

---

### 📓 Notion (Knowledge Base)

- [ ] Connect Notion at `/tools/knowledge` — click "Connect Notion" (uses OAuth flow)
- [ ] Optional: Set `NOTION_API_KEY` in Doppler — internal integration token (bypasses OAuth, for server-side agent writes) (membership required)
  - Create at https://www.notion.so/my-integrations → New integration → copy "Internal Integration Token"
  - Share your target pages/databases with the integration in Notion
- [ ] Link a Notion page to each Forge project at `/tools/knowledge` — agents will read + write to it

---

### 🤖 OpenClaw / MyClaw (AI Agent)

- [ ] Configure gateway URL + hook token at `/tools/claw` in the Nexus dashboard
- [ ] Set `OPENCLAW_GATEWAY_URL` in Doppler — your MyClaw instance base URL (e.g. `https://xyz.myclaw.ai`)
- [ ] Set `OPENCLAW_BEARER_TOKEN` in Doppler — your bearer token (overrides cookie-based config when set)
- [ ] Register the Nexus webhook receiver in your OpenClaw / MyClaw config:
  - URL: `https://<your-vercel-domain>/api/webhooks/claw`
  - Events to enable: `task_completed`, `asset_created`, `status_update`
- [ ] Audit skill permissions at `/tools/claw/skills` — enable only what you need

---

### 🔌 OAuth Apps (platform access for agents)

- [ ] **Google** — https://console.cloud.google.com → APIs & Services → Credentials → Create OAuth 2.0 Client ID
  - Redirect URI: `https://<your-vercel-domain>/api/oauth/google/callback`
  - Scopes: `drive.file`, `docs`, `spreadsheets`
  - Add `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` to Doppler
- [ ] **GitHub** — https://github.com/settings/developers → New OAuth App
  - Redirect URI: `https://<your-vercel-domain>/api/oauth/github/callback`
  - Add `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` to Doppler
- [ ] **Slack** — https://api.slack.com/apps → Create New App → From scratch
  - Redirect URI: `https://<your-vercel-domain>/api/oauth/slack/callback`
  - Add `SLACK_CLIENT_ID` + `SLACK_CLIENT_SECRET` to Doppler
- [ ] **Notion** — https://www.notion.so/my-integrations → New integration
  - Redirect URI: `https://<your-vercel-domain>/api/oauth/notion/callback`
  - Add `NOTION_CLIENT_ID` + `NOTION_CLIENT_SECRET` to Doppler

---

### 💳 Stripe (Payments)

- [✅] Add `STRIPE_WEBHOOK_SECRET` to Doppler — Stripe Dashboard → Developers → Webhooks → endpoint secret
- [✅] Register webhook endpoint in Stripe Dashboard:
  - URL: `https://<your-vercel-domain>/api/webhooks/stripe`
  - Events: `payment_intent.succeeded`, `invoice.payment_succeeded`

---

### 📧 Resend (Email Alerts)

- [ ] Add `RESEND_API_KEY` to Doppler — resend.com → API Keys
- [ ] Verify your sending domain in the Resend dashboard
- [ ] Set `ALERT_FROM_EMAIL` in Doppler — verified sender address (e.g. `alerts@yourdomain.com`)

---

### 📊 Sentry (Error Tracking)

- [ ] Run `npm install @sentry/nextjs`
- [ ] Run `npx @sentry/wizard@latest -i nextjs` (generates config files)
- [ ] Add `SENTRY_DSN` to Doppler — Sentry project → Settings → Client Keys

---

### 🗄️ Cloudflare R2 (Asset Storage — alternative to Supabase Storage)

- [✅] Create R2 bucket in Cloudflare Dashboard → R2 → Create bucket (e.g. `nexus-assets`)
- [✅] Create R2 API token: Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API Token
- [✅] Add `R2_ACCOUNT_ID` to Doppler — Cloudflare Dashboard → right sidebar → Account ID
- [✅] Add `R2_ACCESS_KEY_ID` to Doppler — from R2 API token creation
- [✅] Add `R2_SECRET_ACCESS_KEY` to Doppler — from R2 API token creation
- [✅] Add `R2_BUCKET_NAME` to Doppler — bucket name (e.g. `nexus-assets`)
- [ ] Optional: Add `R2_PUBLIC_URL` to Doppler — public bucket URL for direct links (enable public access in R2 dashboard)

---

### ⚙️ Inngest (Background Jobs)

- [ ] Sign up at https://inngest.com → create an app called `nexus`
- [ ] Add `INNGEST_EVENT_KEY` to Doppler — Inngest dashboard → App → Event Key
- [ ] Add `INNGEST_SIGNING_KEY` to Doppler — Inngest dashboard → App → Signing Key
- [ ] Add `NEXT_PUBLIC_APP_URL` to Doppler — your Vercel deployment URL (e.g. `https://nexus.pinnacleadvisors.com`)
- [ ] Register the Inngest endpoint in Inngest dashboard → Syncs → Add endpoint: `https://<your-vercel-domain>/api/inngest`
- [ ] For local dev: run `npx inngest-cli@latest dev` alongside `npm run dev`

---

### 🔒 Security Hardening (Phase 9)

- [ ] **Clerk MFA** — Clerk Dashboard → Organization Settings → Multi-factor authentication → Enforce for all members (pro membership required)
- [ ] **ENCRYPTION_KEY** — Generate and add to Doppler (how-to?): 
  ```
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  Add as `ENCRYPTION_KEY` in Doppler. Existing OAuth tokens in cookies will re-encrypt on next login.
- [✅] **Upstash Redis** — https://console.upstash.com → Create Database → copy REST URL + token
  - Add `UPSTASH_REDIS_REST_URL` to Doppler
  - Add `UPSTASH_REDIS_REST_TOKEN` to Doppler
- [✅] **GitHub Dependabot** — Repo Settings → Security → Dependabot → Enable "Dependabot alerts" + "Dependabot security updates"
- [ ] **Snyk** (optional) — https://app.snyk.io → Import repo → run first scan
- [ ] Run `npm run migrate` to apply migration 005 (audit_log table)

---

### 🔐 Row-Level Security (RLS — Clerk + Supabase JWT)

- [✅] In Clerk Dashboard → JWT Templates → New template → choose "Supabase"
  - Set audience to your Supabase project URL
  - Ensure `sub` claim maps to `{{user.id}}`
- [✅] In Supabase Dashboard → Settings → API → copy JWT Secret
- [✅] Paste the JWT Secret into the Clerk JWT template "Signing key" field
- [ ] Run `npm run migrate` to apply migration 004 (enables RLS + policies)

---

### 🤖 Agent Capabilities (Phase 10)

- [✅] Add `ANTHROPIC_API_KEY` to Doppler — required for `/tools/agents` to function
  - Get key at https://console.anthropic.com → API Keys → Create Key
  - Without this key the agents page returns a 503 with a clear error message
- [ ] Optional: set `OPENCLAW_GATEWAY_URL` + `OPENCLAW_BEARER_TOKEN` to route agent runs through OpenClaw (Claude Pro subscription) instead of direct API

---

### 💰 Cost & Rate Caps

- [✅] Set `CLAW_DAILY_DISPATCH_CAP` in Doppler — max Claw agent dispatches per day (default: `100`)
- [✅] Set `COST_ALERT_PER_RUN_USD` in Doppler — alert threshold per AI run (default: `0.50`)

---

## Phase 1 — Foundation (Complete)

| Status | Item |
|--------|------|
| ✅ | Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 project scaffold |
| ✅ | Clerk authentication (sign-in, sign-up, session management) |
| ✅ | Doppler secrets management integrated |
| ✅ | Protected route group `(protected)/` with middleware redirect |
| ✅ | Collapsible sidebar navigation (Forge, Dashboard, Board, Tools) |
| ✅ | Dark space theme with Tailwind CSS 4 custom design tokens |
| ✅ | Deployed to Vercel (auto-deploy on push to `main`) |
| ✅ | Code stored in GitHub (`pinnacleadvisors/nexus`) |

---

## Phase 2 — Idea Forge (Complete)

| Status | Item |
|--------|------|
| ✅ | Streaming Claude chatbot (Vercel AI SDK + `@ai-sdk/anthropic`) |
| ✅ | Business consulting system prompt with milestone extraction |
| ✅ | Live milestone timeline panel — populates as conversation progresses |
| ✅ | Gantt chart view — auto-generated from milestones, colour-coded by phase |
| ✅ | Agent count selector + rough budget estimator |
| ✅ | "Launch Agents" button triggers Gantt view |
| ✅ | "Dispatch to OpenClaw" button — sends milestones to cloud agent |
| ✅ | Consulting agent asks about budget, team size, target market upfront |
| 🔧 | Save/resume sessions — persist conversations and milestones (localStorage; Supabase pending) |
| 🔧 | Multi-business support — create named projects, switch between them (localStorage; Supabase pending) |
| ✅ | Export finalised business plan as PDF (browser print dialog) |
| ✅ | Token efficiency: sliding window — compresses messages > 20 into synopsis in system prompt |

---

## Phase 3 — Dashboard (Partial)

| Status | Item |
|--------|------|
| ✅ | KPI grid (revenue, cost, net profit, active agents, tokens, tasks) |
| ✅ | Revenue vs cost area chart (recharts) |
| ✅ | Agent performance table (status, tasks, tokens, cost, last active) |
| 🔧 | Connect to real data source (Supabase) — scaffold complete; run `npm run migrate`, set `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| 🔧 | Stripe webhook → real revenue figures — endpoint at `/api/webhooks/stripe`; set `STRIPE_WEBHOOK_SECRET` in Doppler |
| ✅ | Token cost tracking — `/api/token-events` logs per-agent usage + cost to `token_events` table |
| ✅ | Real-time agent status via Supabase Realtime — dashboard subscribes to `agents` table changes |
| 🔧 | Sentry integration — stub in `lib/sentry.ts`; install `@sentry/nextjs` + set `SENTRY_DSN` to activate |
| ✅ | Mobile-optimised layout — dashboard + AgentTable responsive (stacked cards on mobile) |
| ✅ | Date range filter (7d / 30d / 90d / all) on charts |
| ✅ | Email/Slack alerts when cost exceeds threshold or errors spike — `/api/alerts` + AlertsPanel UI |

---

## Phase 4 — Kanban Board (Partial)

| Status | Item |
|--------|------|
| ✅ | 4-column board: Backlog → In Progress → Review → Completed |
| ✅ | Drag-and-drop between columns (dnd-kit) |
| ✅ | Review modal: asset preview, approve / reject |
| ✅ | Reject flow: revision note input → card moves back to Backlog |
| ✅ | Connect to real agent task queue (Supabase) — `/api/board` CRUD, falls back to mock when unconfigured |
| ✅ | Hover preview on Completed cards — asset type detection (Drive, GitHub, PDF, Notion, Miro) + tooltip on hover |
| ✅ | Click-through on asset links — Google Drive, hosted URLs, GitHub PRs; opens in new tab |
| ✅ | Real-time card updates when agents complete tasks (Supabase Realtime on `tasks` table) |
| ✅ | Card shows which agent is actively working on it — animated pulse badge on In Progress cards |
| ✅ | Filter board by project / business — project dropdown reads from localStorage (synced with Forge) |
| ✅ | Approve triggers next milestone dispatch to OpenClaw — fires `/api/claw` agent dispatch on approval |

---

## Phase 5 — OpenClaw / MyClaw Integration (Complete)

| Status | Item |
|--------|------|
| ✅ | `/tools/claw` configuration page (gateway URL + hook token) |
| ✅ | Claw API proxy (`/api/claw`) — routes agent dispatch calls |
| ✅ | OAuth connection manager page (Google, GitHub, Slack, Notion) |
| ✅ | OAuth flow backend (`/api/oauth/[provider]`, callback, disconnect) |
| ✅ | Forge "Dispatch to OpenClaw" — sends project milestones to agent |
| 🔧 | OAuth token storage — currently uses cookies, move to encrypted DB |
| 🔒 | Security audit on OAuth proxy and token handling |
| ✅ | `/api/chat` uses OpenClaw (Claude Code CLI) as primary AI, `ANTHROPIC_API_KEY` as fallback |
| ✅ | Connect Claw to Claude Code CLI — `code` action dispatches to `/hooks/code`; UI at `/tools/claw` → Code Task section |
| ✅ | Skill registry — `/tools/claw/skills` lists all skills with scope, risk level, enable/disable audit per browser |
| ✅ | Claw webhook receiver — `POST /api/webhooks/claw`; HMAC-verified; `task_completed`/`asset_created` auto-create Kanban cards |
| ✅ | Claw status page — `/tools/claw/status`; live session list, current task, auto-refresh every 8 s |
| ✅ | Multi-agent parallelism — `dispatch_phases` action; Forge groups milestones by phase, dispatches one session per phase in parallel |
| ✅ | Rate limiting + cost cap — per-IP rate limit (30 req/min) + daily dispatch cap (`CLAW_DAILY_DISPATCH_CAP`, default 100); `GET /api/claw` returns usage |
| ✅ | Claw produces assets → auto-creates Kanban card in Review column — webhook receiver handles `asset_created` events |

---

## Phase 6 — Knowledge Base / Notes (Complete)

| Status | Item |
|--------|------|
| ✅ | Notion API integration — `lib/notion.ts` client; agents create pages, append blocks, query databases via OAuth token |
| ✅ | Notion database as project knowledge base — `/tools/knowledge` UI; link any Notion page to a Forge project; KB entries stored per-project in localStorage |
| ✅ | Each milestone completion appends to a shared Notion doc — board `handleApprove` fires `POST /api/notion/append` with milestone title, description, agent, timestamp, and asset bookmark |
| ✅ | Research PDFs auto-uploaded to Notion / Google Drive — `POST /api/gdrive/upload` (type=pdf) fetches PDF from URL and uploads to Drive; `POST /api/notion` creates bookmark page |
| ✅ | Agent context window uses Notion docs to avoid repetition — `GET /api/notion/search?pageId=` fetches page text; `/api/chat` injects it into system prompt before each reply (RAG) |
| ✅ | Alternative: self-hosted Obsidian vault synced via Obsidian Sync — `/tools/knowledge` Obsidian tab with setup guide, Local REST API plugin config (URL + key saved to localStorage) |

---

## Phase 7 — Backend & Data Layer (Complete)

| Status | Item |
|--------|------|
| ✅ | Supabase project setup — client in `lib/supabase.ts`; migrations 001–004; Realtime on agents, tasks, projects, milestones, businesses |
| ✅ | Schema — `businesses` + `milestones` tables added (migration 003); `user_id` column on projects + agents for future RLS isolation |
| ✅ | Migrate all mock data to live database queries — all API routes (`/api/dashboard`, `/api/board`, `/api/projects`, `/api/milestones`) try Supabase first, fall back to mock when unconfigured |
| ✅ | Row-level security (RLS) policies — migration 004 enables RLS on all tables; `businesses` policies use Clerk `sub` JWT claim; see Manual Steps → RLS to activate Clerk JWT integration |
| ✅ | Supabase Storage — `POST /api/storage` uploads files; `GET /api/storage` lists + returns signed URLs; auto-creates bucket if missing |
| ✅ | Cloudflare R2 — `lib/r2.ts` S3-compatible client; `POST/GET/DELETE /api/r2`; presigned upload + download URLs; remote-URL mirror helper |
| ✅ | Background job queue (Inngest) — `inngest/client.ts` + `inngest/functions/`; 4 functions: milestone completed, asset created, daily cost check (cron), agent-down alert; served at `POST /api/inngest` |

---

## Phase 8 — Token Efficiency & Agent Intelligence (In Progress)

| Status | Item |
|--------|------|
| ✅ | Sliding window summarisation — compress old messages before context limit (20-message window, last 10 kept + synopsis) |
| ✅ | Model routing — Opus as strategic advisor, configurable executioner model for implementation tasks |
| ✅ | Dual-model architecture — advisor/executioner split with UI model selector in Forge settings |
| ✅ | Prompt caching — Anthropic cache_control breakpoints on system prompt + first user turn |
| ✅ | Token usage logged per request — input/output/cached tokens tracked, cost estimated in `/api/chat` response headers |
| ✅ | Cost alert when a single agent run exceeds configurable threshold — checked server-side, fires via `/api/alerts` |
| ✅ | Retrieval-Augmented Generation (RAG) — Notion page content injected into system prompt via `/api/notion/search`; see Phase 6 |

---

## Phase 9 — Security Hardening (Complete)

| Status | Item |
|--------|------|
| ✅ | Clerk MFA — see Manual Steps → Clerk MFA |
| ✅ | All API keys via Doppler — zero `.env` files in repo; confirmed clean |
| ✅ | OAuth tokens encrypted at rest (AES-256-GCM) — `lib/crypto.ts`; tokens encrypted before cookie storage when `ENCRYPTION_KEY` set; `decryptIfNeeded()` called on read in Notion + Google Drive routes |
| ✅ | Rate limiting — `lib/ratelimit.ts`; Upstash Redis when configured, in-memory fallback; claw route upgraded; standard headers (`X-RateLimit-*`) returned |
| ✅ | CSRF protection — `lib/csrf.ts` origin-check helper; exempts HMAC-verified webhooks and OAuth callbacks |
| ✅ | Audit log — `supabase/migrations/005_audit_log.sql` + `lib/audit.ts`; fire-and-forget writes on: OAuth connect/disconnect, board approve/reject/move, Claw dispatch, Claw webhook events; readable via `GET /api/audit` |
| ✅ | Per-skill security audit — risk levels + scope visible at `/tools/claw/skills`; enable/disable toggles; audit entries written when skills are toggled |
| ✅ | Vulnerability scan — enable GitHub Dependabot in repo settings (see Manual Steps); Snyk optional |
| ✅ | Content Security Policy — `next.config.ts` sets CSP + X-Frame-Options + HSTS + Referrer-Policy + Permissions-Policy + CORP headers on all routes |

---

## Phase 10 — Agent Capabilities (Complete)

10 specialised AI agents accessible at `/tools/agents`. Each produces a full deliverable document, saves to your knowledge base, and creates a Review card on the board.

| Status | Capability |
|--------|------------|
| ✅ | **Research** — competitor analysis, market sizing → deliverable report → Notion |
| ✅ | **Content** — landing page copy, blog posts, email sequences → full draft |
| ✅ | **Code** — full-stack app spec + architecture → technical blueprint |
| ✅ | **SEO** — keyword research, on-page optimisation → actionable report |
| ✅ | **Social Media** — post drafts for LinkedIn, X, Instagram → content calendar |
| ✅ | **Customer Service** — reply agent trained on business context → response templates |
| ✅ | **Email Outreach** — cold outreach sequences via Resend → sequence copy |
| ✅ | **Design Briefs** — structured prompts for image/brand generation → brief doc |
| ✅ | **Financial Modelling** — revenue projections, cost breakdowns → financial model |
| ✅ | **Legal** — terms of service / privacy policy draft generation → legal doc |

### Implementation details
- `lib/agent-capabilities.ts` — 10 capability definitions with detailed system prompts, input schemas, and output flags
- `app/api/agent/route.ts` — streaming dispatch endpoint; rate-limited (10 req/min); creates board card + appends to Notion on completion
- `app/(protected)/tools/agents/page.tsx` — capability browser with category filter, launch panel with streaming output, copy, and stop
- `components/layout/Sidebar.tsx` — Agents nav item added

---

---

## Phase 11 — Multi-Agent Orchestration (Complete)

> Inspired by [ruvnet/ruflo](https://github.com/ruvnet/ruflo). Architecture: **Queen agents** coordinate swarms of specialist agents. A `StrategicQueen` breaks goals into phases, a `TacticalQueen` assigns tasks to specialists, an `AdaptiveQueen` monitors for drift. All decisions go through a configurable consensus layer.

| Status | Item |
|--------|------|
| ✅ | **Swarm kernel** — `lib/swarm/`: `Queen.ts`, `Consensus.ts`, `Router.ts`, `ReasoningBank.ts`, `TokenOptimiser.ts`, `WasmFastPath.ts`, `index.ts` |
| ✅ | **Agent registry** — 22 specialist agent definitions in `lib/swarm/agents/registry.ts`: researcher, analyst, strategist, coder, reviewer, tester, architect, security-auditor, marketer, copywriter, SEO, social-media, email, designer, data-analyst, finance-analyst, legal-advisor, customer-support, devops, product-manager, qa-engineer, brand-strategist |
| ✅ | **Consensus layer** — Raft (simple majority, default), BFT (strict 2/3 with confidence weighting, for finance/legal), Gossip (fast-accept for content tasks) |
| ✅ | **Intelligent router** — Q-Learning router (`lib/swarm/Router.ts`); ε-greedy exploration; reward = quality / normalised token cost; routing decisions saved to ReasoningBank |
| ✅ | **ReasoningBank** — `supabase/migrations/006_swarm.sql` `reasoning_patterns` table; stores task_type, agent_role, model, result_quality, tokens_used; in-memory fallback when Supabase unconfigured |
| ✅ | **WASM fast-path** — `lib/swarm/WasmFastPath.ts` JS implementation of 6 transforms (format-json, extract-urls, normalise, word-count, parse-date, strip-markdown) at zero LLM cost |
| ✅ | **Token optimiser** — `lib/swarm/TokenOptimiser.ts`; whitespace normalisation, paragraph deduplication, code block compression, smart truncation; target 12k token context |
| ✅ | **Swarm API** — `POST /api/swarm/dispatch` (SSE stream, X-Swarm-Id header); `GET /api/swarm/:id` (state + tasks); `DELETE /api/swarm/:id` (abort) |
| ✅ | **Swarm UI** — `/swarm` page with goal/context input, queen/consensus/budget settings, real-time event log, phase/task progress cards, synthesis output |
| ✅ | **MCP server** — `lib/swarm/mcp.ts` tool definitions; served at `GET/POST /api/swarm/mcp/:tool`; tools: `create_swarm`, `get_swarm_status`, `abort_swarm`, `list_agents` |
| ✅ | **Drift prevention** — AdaptiveQueen checks alignment at every N tasks; re-emits `drift` event when swarm diverges from goal |
| ✅ | **Fault tolerance** — per-task error isolation; failed tasks don't block phase; all failures written to audit log; budget cap enforced per phase |

### Implementation details
- `lib/swarm/Queen.ts` — `strategicDecompose()` uses Opus; `tacticalAssign()` uses Router; `executeTask()` runs fast-path → LLM → consensus pipeline; `runSwarm()` orchestrates phases
- `supabase/migrations/006_swarm.sql` — `swarm_runs`, `swarm_tasks`, `reasoning_patterns` tables; Realtime enabled
- `lib/database.types.ts` — updated with all 3 new tables
- Sidebar — Swarm nav item added (Network icon)

### Manual steps
- Run `npm run migrate` to apply migration 006
- `ANTHROPIC_API_KEY` required (already documented in Phase 10 manual steps)
- MCP integration: `claude mcp add nexus-swarm <your-vercel-url>/api/swarm/mcp/manifest`

---

## Phase 12 — Tribe v2: Neuro-Optimised Content Engine ✅ Complete

> Content creation informed by cognitive neuroscience: dopamine anticipation loops, curiosity gaps, social proof triggers, novelty detection, and narrative tension arcs — proven to increase engagement and memorability.

| Status | Item |
|--------|------|
| ✅ | **Neuro-content library** — `lib/neuro-content/` with types, 12 principles, 8 format templates, 5 tone profiles; scoring + revision prompt builders; full re-export via index |
| ✅ | **Neuro-content agent** — new `'neuro-content'` capability in `lib/agent-capabilities.ts`; system prompt encodes all 12 cognitive engagement principles with application guidance |
| ✅ | **Content scoring API** — `POST /api/content/score` scores text against all 12 principles using Claude Sonnet; returns `ContentScore` with per-principle scores (0–100), overall score, grade (A–F), topStrengths, topWeaknesses, and 3 concrete suggestions |
| ✅ | **Revision loop** — `POST /api/content/generate` generates draft → scores with Claude Haiku (fast) → if score < `targetScore`, rewrites targeting the weakest principles → up to 3 iterations; returns `X-Neuro-Score`, `X-Neuro-Grade`, `X-Neuro-Iterations` headers |
| ✅ | **Format templates** — 8 formats: LinkedIn post, X/Twitter thread, Instagram caption, long-form blog, cold email, landing page hero, VSL script, YouTube description; each with structure blueprint, format-specific neuro guidelines, and a structural example |
| ✅ | **Tribe tone profiles** — 5 profiles: authority (declarative, data-backed), peer (warm, conversational), challenger (provocative, counterintuitive), storyteller (narrative-driven, sensory), data-driven (precise, evidence-first); each with voice paragraph, do/don't lists, sample phrase |
| ✅ | **A/B variant generator** — `POST /api/content/variants` produces 3 variants in parallel, each emphasising a different trigger: curiosity gap, loss aversion, social proof; side-by-side in UI with copy buttons |
| ✅ | **Tribe v2 UI** — `app/(protected)/tools/content/page.tsx`; format picker (dropdown), tone picker (pill buttons), topic/context inputs, target score slider, generate button, streaming output, score panel with 12 principle bars (expandable), variant tabs; "Content" added to sidebar (Sparkles icon) |
| ⬜ | **Content analytics** — connect published content performance (CTR, time-on-page, shares) back to neuro score; surface correlation on dashboard to improve future scoring weights |
| ⬜ | **muapi.ai media pairing** — after content is generated, automatically call muapi.ai to generate a matching image/visual; result attached to board card and uploaded to R2/Supabase Storage |

### Implementation Notes
- `lib/neuro-content/types.ts` — all TypeScript interfaces: `NeuroPrinciple`, `PrincipleScore`, `ContentScore`, `FormatTemplate`, `ToneProfile`, `GenerateContentRequest`, `ContentVariant`, `VariantsResponse`
- `lib/neuro-content/principles.ts` — 12 `NeuroPrinciple` objects + `buildScoringPrompt()` + `buildRevisionPrompt()`
- `lib/neuro-content/templates.ts` — 8 `FormatTemplate` objects + `getTemplate()` helper
- `lib/neuro-content/tones.ts` — 5 `ToneProfile` objects + `getToneProfile()` helper
- Scoring uses Claude Sonnet 4.6 for quality, Claude Haiku for fast revision-loop scoring
- Rate limits: score 20/min, generate 10/min, variants 5/min (expensive — 3 parallel Sonnet calls)

### Reference
- Tribe v2 philosophy: content is a neurological event before it is a marketing event — engineer for brain state first, message second.

---

## Phase 13 — Consultant Agent + n8n Workflow Automation (Complete — 13a + 13b + 13c)

> A strategic consultant agent researches the best tool combinations for your business, then generates executable n8n workflow blueprints. Every step the user must take (add API key, create account, review workflow) is automatically added as a Kanban card and Notion note so agents stay in context.

### 13a — Consultant Agent ✅ Complete

| Status | Item |
|--------|------|
| ✅ | **Consultant capability** — `'consultant'` in `lib/agent-capabilities.ts`; accepts business name + description + current tools + pain points + budget; outputs ranked automation recommendations with rationale, cost estimates, and complexity scores; JSON block + full markdown report |
| ✅ | **Tool research** — `GET /api/tools/research`: curated database of 40+ SaaS tools in `lib/n8n/tools-db.ts`; filterable by keyword, category, n8n_only; returns compatibility matrix with n8n node types, setup time, monthly cost, OpenClaw flag |
| ✅ | **Workflow gap analysis** — consultant system prompt identifies n8n-automatable steps vs OpenClaw-required steps; gap report saved to Notion via existing `/api/agent` `onFinish` hook; includes `openClawEscalations[]` in JSON output |
| ✅ | **Recommendation cards** — `/api/agent` `onFinish` parses consultant JSON block; creates one Board card per recommendation in Backlog (priority → high/medium/low); summary card in Review; max 8 cards per run |

### Implementation Notes (13a)
- `lib/n8n/types.ts` — `N8nNode`, `N8nWorkflow`, `WorkflowTemplate`, `ToolEntry`, `AutomationRecommendation`, `ConsultantReport`
- `lib/n8n/client.ts` — n8n REST API client: `listWorkflows`, `createWorkflow`, `activateWorkflow`, `listExecutions`, `checkHealth`; requires `N8N_BASE_URL` + `N8N_API_KEY`
- `lib/n8n/tools-db.ts` — 40+ tools across CRM, email, social, payments, analytics, devops, AI, support
- `app/api/tools/research/route.ts` — `GET /api/tools/research?q=&category=&n8n_only=`
- `app/api/agent/route.ts` — updated: consultant gets multi-card board creation + new input labels

### 13b — n8n Workflow Generation ✅ Complete

| Status | Item |
|--------|------|
| ✅ | **n8n blueprint generator** — `POST /api/n8n/generate` accepts a workflow description + business context; Claude Sonnet generates valid n8n v1 JSON with setup checklist; creates Backlog board card; returns `importUrl` deep-link |
| ✅ | **Workflow templates** — `lib/n8n/templates.ts`: 8 pre-built blueprints: social post scheduler, lead capture → CRM, invoice generation, content republishing, competitor monitoring, onboarding email sequence, support ticket routing, weekly analytics digest |
| ✅ | **muapi.ai node** — muapi.ai integrated as `n8n-nodes-base.httpRequest` node inside content workflow templates; credentials configured via n8n credential store |
| ✅ | **Setup checklist generation** — every template and generated workflow includes a step-by-step setup checklist; `/api/n8n/generate` saves checklist to Board card description |
| ✅ | **n8n webhook receiver** — `POST /api/webhooks/n8n`: HMAC-SHA256 signature verification (`N8N_WEBHOOK_SECRET`); updates Board card status (success → Review, error → In Progress); appends result to Notion |
| ✅ | **Workflow status page** — `/tools/n8n`: live workflow list (activate/deactivate), last execution status, 8 template cards with expandable checklists + import buttons, AI workflow generator panel |

### Implementation Notes (13b)
- `lib/n8n/templates.ts` — 8 `WorkflowTemplate` objects; `WORKFLOW_TEMPLATES`, `getTemplate(id)`, `getTemplatesByCategory(cat)`, `WORKFLOW_CATEGORIES`
- `app/api/n8n/generate/route.ts` — `POST /api/n8n/generate`; rate-limited (5/min); uses `claude-sonnet-4-6` with `generateText`; structured output parsing; board card creation
- `app/api/n8n/workflows/route.ts` — `GET /api/n8n/workflows` proxies `listWorkflows()` from n8n client
- `app/api/n8n/workflows/[id]/activate/route.ts` + `deactivate/route.ts` — activate/deactivate individual workflows
- `app/api/webhooks/n8n/route.ts` — HMAC-verified; updates Supabase task status; appends to Notion
- `app/(protected)/tools/n8n/page.tsx` — full workflow management UI: live list, template grid, generate panel, import toast
- `components/layout/Sidebar.tsx` — Workflows nav item added (Workflow icon, `/tools/n8n`)

### 13c — OpenClaw Fallback Bridge ✅ Complete

| Status | Item |
|--------|------|
| ✅ | **API gap detection** — `lib/n8n/gap-detector.ts`: `analyzeWorkflow()` inspects every n8n node type + parameter for browser-automation signals; `analyzeDescription()` scans free-text descriptions using 25 keyword patterns; both return a `GapAnalysis` with `apiNativeSteps`, `openClawSteps`, `hybridRequired`, `routingExplanation`, and `summary` |
| ✅ | **Hybrid workflow** — `POST /api/n8n/bridge`: Claude Sonnet splits the description into n8n-native vs OpenClaw steps, generates an n8n v1 workflow for the API-native half (with a Webhook trigger node for callback), dispatches OpenClaw steps to the configured gateway, and returns a unified plan; results flow back via the existing `POST /api/webhooks/n8n` receiver |
| ✅ | **Priority routing rule** — n8n is always attempted first (all node types checked against 50-entry allowlist); OpenClaw is escalated only when a step genuinely requires browser automation, 2FA, JS-rendered scraping, or platform DM APIs without a public REST tier; routing decision documented in every response as `routingExplanation` |

### Implementation Notes (13c)
- `lib/n8n/gap-detector.ts` — `WorkflowStep`, `GapAnalysis` types; `analyzeWorkflow(workflow)` (node-level); `analyzeDescription(text)` (heuristic, no LLM); 50-node allowlist + 25 browser-automation keyword patterns
- `app/api/n8n/bridge/route.ts` — `POST /api/n8n/bridge`; rate-limited (5/min); Claude-powered split analysis + n8n workflow generation; OpenClaw dispatch with HMAC-free direct session POST; board card creation; returns `plan`, `n8nWorkflow`, `openClawDispatched`, `openClawSessionId`, `importUrl`
- `app/api/n8n/generate/route.ts` — now also returns `gapAnalysis` (from `analyzeWorkflow`) alongside the generated workflow
- `app/(protected)/tools/n8n/page.tsx` — `GapAnalysisPanel` component: shows routing summary badge, per-step n8n vs OpenClaw breakdown, "Dispatch OpenClaw Steps" button that calls `/api/n8n/bridge`; displayed inline in the `GeneratePanel` result area after each generation

### Manual Steps — n8n
- [ ] Deploy n8n: self-hosted (`docker run n8nio/n8n`) or n8n Cloud (https://n8n.io/cloud/)
- [ ] Add `N8N_BASE_URL` to Doppler — your n8n instance URL (e.g. `https://n8n.yourdomain.com`)
- [ ] Add `N8N_API_KEY` to Doppler — n8n Settings → API → Create API Key
- [ ] Register Nexus webhook in n8n: URL = `https://<your-vercel-domain>/api/webhooks/n8n`
- [ ] Add `MUAPI_AI_KEY` to Doppler — register at https://muapi.ai → API Keys
- [✅] Import starter workflow blueprints from `/tools/n8n` — 8 templates available; use "Import to n8n" button on each card

---

## Phase 14 — 3D Relational Knowledge Graph ✅ Complete

> A live 3D graph where every business, project, milestone, agent, tool, workflow, and code repository is a node. Edges show relationships: "project uses tool", "agent created asset", "milestone depends on milestone", "workflow triggers agent". Agents query the graph via a lightweight API to get full relational context in a single call — inspired by Graphify's 71x token reduction and GitNexus's precomputed relational intelligence.

| Status | Item |
|--------|------|
| ✅ | **Graph data model** — `lib/graph/types.ts`: `GraphNode` (id, type, label, metadata, position3d, clusterId, pageRank, connections), `GraphEdge` (source, target, relation, weight, createdAt); 10 node types; 10 edge relation types; `NODE_COLORS` + `EDGE_COLORS` visual encoding maps |
| ✅ | **Graph builder** — `lib/graph/builder.ts`: queries Supabase (businesses, projects, milestones, agents, tasks); server-side force-directed spring simulation assigns 3D positions; Louvain community detection (graphology-communities-louvain) assigns cluster IDs; PageRank power iteration sizes nodes; 60 s in-memory cache; rich 30-node mock fallback when Supabase unconfigured |
| ✅ | **Graph API** — `GET /api/graph` (full graph, 60 s cache); `GET /api/graph/node/:id` (node + 1-hop neighbourhood); `GET /api/graph/path?from=&to=` (BFS shortest path); `POST /api/graph/query` (keyword-ranked subgraph); `GET/POST /api/graph/mcp` (MCP manifest + tool invocation) |
| ✅ | **3D renderer** — `/graph` page using `react-three-fiber` + `@react-three/drei`; nodes as glowing spheres (MeshStandardMaterial + emissive) sized by PageRank + degree; edges as `<Line>` with opacity ∝ weight; camera orbit/zoom/pan via OrbitControls; auto-fit camera to bounding sphere on load; SSR disabled via `next/dynamic` |
| ✅ | **Node type visual encoding** — businesses: gold, projects: indigo, milestones: teal, agents: purple, tools: grey, workflows: orange, repos: green, assets: pink, prompts: sky, skills: amber; node size = PageRank + connections; edge colour = relation type; labels above each sphere |
| ✅ | **Agent context API** — `POST /api/graph/context`: finds top-3 anchor nodes via keyword relevance scoring, expands 1 hop, returns minimal subgraph (≤20 nodes default); returns `summary`, `tokenEstimate`, `anchorNodeIds`; no embeddings needed (keyword + PageRank scoring) |
| ✅ | **MCP tool exposure** — `GET /api/graph/mcp` returns manifest; `POST /api/graph/mcp` invokes `get_graph_context`, `query_graph`, or `get_node`; add with: `claude mcp add nexus-graph <url>/api/graph/mcp/manifest` |
| ✅ | **Search + filter panel** — sidebar with text search (dims non-matching nodes in 3D view), node type filter pills with counts, clear filter button |
| ✅ | **Temporal replay** — ON/OFF toggle + range slider (1–100%); shows oldest N% of nodes by `createdAt`; reveals graph growth over time |
| ✅ | **Auto-layout modes** — force-directed (server-computed spring, default), hierarchical (layer by node type priority), radial (concentric rings by type), cluster-grid (grid by Louvain cluster); toggle in sidebar |
| ⬜ | **Embed in Forge / Dashboard** — minimap 2D projection in Forge sidebar; deep-link on click (planned Phase 14b) |

### Implementation Notes (Phase 14)
- `lib/graph/types.ts` — all TypeScript interfaces + `NODE_COLORS`, `EDGE_COLORS`, `NODE_TYPE_LABELS` maps
- `lib/graph/builder.ts` — `buildGraph()`, `getNodeNeighbourhood()`, `findShortestPath()`, `scoreNodeRelevance()`; `runForceLayout()` (spring simulation); `assignClusters()` (Louvain); `assignPageRank()` (power iteration)
- `app/api/graph/route.ts` — GET full graph with `s-maxage=60` CDN cache
- `app/api/graph/node/[id]/route.ts` — GET single node + 1-hop neighbourhood
- `app/api/graph/path/route.ts` — GET BFS shortest path
- `app/api/graph/query/route.ts` — POST keyword-ranked subgraph search
- `app/api/graph/context/route.ts` — POST agent context API (anchor expansion)
- `app/api/graph/mcp/route.ts` — MCP manifest + 3 tool dispatch handlers
- `components/graph/GraphScene.tsx` — `'use client'` Three.js scene: `NodeMesh`, `EdgeLine`, `CameraFit`, `Scene`, `GraphScene`
- `app/(protected)/graph/page.tsx` — full page: dynamic GraphScene import (ssr:false), sidebar (search/filter/layout/replay/stats/MCP info), node detail panel, legend, toolbar
- `components/layout/Sidebar.tsx` — Graph nav item added (Share2 icon, `/graph`, segment `graph`)
- New packages: `three`, `@types/three`, `@react-three/fiber`, `@react-three/drei`, `graphology`, `graphology-communities-louvain`, `graphology-shortest-path`

### Manual Steps (Phase 14)
- No additional secrets needed for mock mode
- For live Supabase data: ensure migrations 001–006 are applied (`npm run migrate`)
- MCP registration: `claude mcp add nexus-graph https://<your-vercel-domain>/api/graph/mcp/manifest`

---

## Phase 15 — Library Layer & Token Efficiency ✅

> A structured, searchable store of reusable building blocks — code functions, agent configs, prompt templates, and skill definitions. Agents query the library before writing anything new, dramatically reducing duplicate generation and per-task token spend.

| Status | Item |
|--------|------|
| ✅ | **Database schema** — migration `007_libraries.sql`: tables `code_snippets`, `agent_templates`, `prompt_templates`, `skill_definitions`; GIN tag indexes, `updated_at` triggers, RLS via Clerk JWT `sub`; keyword search via `ilike` (pgvector optional) |
| ✅ | **Code function library** — 6 seed snippets (Supabase pagination, streaming Claude route, rate limiter, DnD kit helpers, Clerk auth, localStorage hook); `GET /api/library?type=code&q=` search |
| ✅ | **Agent template library** — 4 seed templates (Market Research, Tech Spec Writer, Growth Copywriter, Legal Risk Reviewer); versioned, system-prompt copy button |
| ✅ | **Prompt library** — 5 seed templates (milestone extractor, competitor analysis few-shot, CoT debugger, launch email, code review checklist); neuro score, variable pills |
| ✅ | **Skill definitions library** — 5 seed skills (web_search, notion_create_page, github_create_issue, send_email, execute_bash); MCP tool name, risk level badge, input schema viewer |
| ✅ | **Keyword search** — `GET /api/library?type=&q=&tags=&limit=&offset=` with Supabase `ilike` + in-memory scored fallback |
| ✅ | **Auto-population** — `onFinish` in `/api/agent` extracts code blocks from every agent run and saves to library (max 3 per run, authenticated users only) |
| ✅ | **Library UI** — `/tools/library` with tab bar (Code / Agents / Prompts / Skills), search, tag filter, expand/view, copy buttons, quality dots, usage count |
| ✅ | **Token savings tracker** — header banner showing estimated tokens saved across all library hits; per-type breakdown (code=350, agent=800, prompt=250, skill=150) |
| ✅ | **Sidebar** — Library nav item (BookOpen icon) added between Workflows and Tools |
| ✅ | **CRUD API** — `POST /api/library`, `PATCH /api/library/:id` (increment_usage, update_score), `DELETE /api/library/:id?type=` |

---

## Phase 16 — Organisation Chart & Agent Hierarchy ✅

> A live org chart showing the full hierarchy of agents active in Nexus: who spawned whom, which queen is coordinating which specialists, what each layer is currently doing, and the accountability chain back to the user.

| Status | Item |
|--------|------|
| ✅ | **Agent hierarchy model** — migration `008_agent_hierarchy.sql`: adds `parent_agent_id`, `layer` (0–4), `swarm_id`, `tokens_used`, `cost_usd`, `current_task`, `model`, `last_active_at` to `agents`; new `agent_actions` table with RLS |
| ✅ | **Org chart page** — `/dashboard/org` renders a top-down tree: User → Strategic Queens → Tactical Queens → Specialist Agents → Background Workers; each node shows status, task count, tokens |
| ✅ | **Layer definitions** — **L0: User** · **L1: Strategic Queens** (Opus) · **L2: Tactical Queens** (Sonnet) · **L3: Specialist Agents** · **L4: Workers** (Haiku / Inngest) |
| ✅ | **Auto-refresh** — page polls `/api/org` every 15 seconds; running agents have animated spinner, errors glow red with pulse ring |
| ✅ | **Drill-down panel** — click any agent node to see: current task, last actions, tokens, cost, model, layer description, terminate button |
| ✅ | **Swimlane view** — toggle between tree and swimlane layout; swimlane groups agents by business/project with per-layer rows inside each lane |
| ✅ | **Stats bar** — total agents, active swarms, total tokens, total cost, layer breakdown bar chart, status overview |
| ✅ | **Sidebar nav** — Org Chart nav item (GitBranch icon) added under Dashboard |
| ⬜ | **Supabase Realtime** — subscribe to `agents` channel for push updates (replaces 15s polling) — wire when Supabase is set up |
| ⬜ | **Accountability chain** — Board card detail links to spawning agent + queen — Phase 16b |
| ⬜ | **Agent utilisation chart** — stacked bar on Dashboard by layer — Phase 16b |

---

## Phase 17 — DeerFlow 2.0 Integration (Not Started)

> Deploy ByteDance's open-source SuperAgent harness (58k+ GitHub stars, MIT licence) as a **sidecar microservice** alongside Nexus. DeerFlow 2.0 provides two things Nexus currently lacks: (1) multi-hop live web research with cited sources, and (2) sandboxed code execution in Docker/Kubernetes — reducing or eliminating OpenClaw dependency for coding tasks. Everything else (business management, content engine, auth, billing, approval flow) stays in Nexus.

> **Architecture:** Nexus Swarm (TypeScript) → dispatches research/coding tasks → DeerFlow REST API → returns cited report or verified code → Nexus persists result + creates Board card.

> **ByteDance compliance note:** DeerFlow is MIT-licensed open-source code that you self-host. No data leaves your infrastructure to ByteDance. Formal compliance review is required before deploying in regulated industries (finance, health, government).

### 17a — DeerFlow Deployment

| Status | Item |
|--------|------|
| ⬜ | **Deploy DeerFlow 2.0** — self-hosted on Railway or Render (~$25–50/mo for a 4 vCPU / 8 GB instance); use `make up` (standard mode) or `make up-pro` (Gateway mode, fewer processes); expose on internal network only — no public IP |
| ⬜ | **Environment config** — `make setup` wizard: choose Claude Sonnet 4.6 as LLM, Tavily as search provider, Docker as sandbox mode; store `DEERFLOW_BASE_URL` + `DEERFLOW_API_KEY` in Doppler |
| ⬜ | **Health check** — `GET /health` endpoint; Inngest background job pings every 5 minutes; alerts via Resend if DeerFlow goes down |
| ⬜ | **Sandbox isolation** — DeerFlow's Docker sandbox runs in a separate container network; no access to Nexus's database or secrets; read `make doctor` output to verify |

### 17b — Nexus Integration Layer

| Status | Item |
|--------|------|
| ⬜ | **DeerFlow client** — `lib/deerflow/client.ts`: `submitTask(goal, context)` → POST to DeerFlow Gateway API → returns `{ taskId, streamUrl }`; `pollTask(taskId)` → GET result; `streamTask(taskId)` → SSE reader |
| ⬜ | **Swarm routing hook** — in `lib/swarm/Queen.ts`, `executeTask()` checks task tags: if `researcher` or `coder` and DeerFlow is configured → dispatch to DeerFlow client instead of direct LLM call; falls back to LLM if DeerFlow unreachable |
| ⬜ | **Researcher agent upgrade** — researcher agent in `lib/swarm/agents/registry.ts` gains `useDeerFlow: true` flag; DeerFlow provides multi-hop Tavily search + cited markdown report; citations extracted and stored in `reasoning_patterns` |
| ⬜ | **Coder agent upgrade** — coder agent dispatches to DeerFlow sandbox; DeerFlow writes, runs, and verifies code in Docker container; returns working code + test output; result saved as artifact in Supabase Storage |
| ⬜ | **Cost tracking** — DeerFlow tasks log token usage via `POST /api/token-events`; LLM model + token count extracted from DeerFlow task result metadata; cost estimate added to swarm budget tracking |
| ⬜ | **DeerFlow status page** — `/tools/deerflow`: shows connection status, active tasks, last 10 completed tasks, total tokens used, estimated cost savings vs OpenClaw |

### 17c — Tavily Live Web Search ✅

> Tavily integrated directly into Nexus's researcher agent without deploying DeerFlow. Closes the live-web-research gap independently of the DeerFlow sidecar.

| Status | Item |
|--------|------|
| ✅ | **Install Tavily** — `@tavily/core` installed; add `TAVILY_API_KEY` to Doppler (free: 1k searches/mo; pro: $50/mo for 10k) |
| ✅ | **Search tool** — `lib/tools/tavily.ts`: `searchWeb()`, `searchWebMulti()`, `formatResultsAsContext()`, `formatCitations()`, `buildResearchQueries()`; auto-truncates to 4,000 tokens; `SEARCH_ENABLED_CAPABILITIES` set |
| ✅ | **Inject into capability agent route** — `app/api/agent/route.ts`: pre-search fires for `research`, `seo`, `consultant`, `financial`, `legal` capabilities; results injected as `## Live Web Research` block above user prompt; `X-Tavily-Count` header returned |
| ✅ | **Inject into swarm researcher** — `lib/swarm/Queen.ts`: `executeTask()` fires Tavily search for `researcher`, `analyst`, `strategist` roles before LLM call; `lib/swarm/agents/registry.ts` researcher prompt updated to cite sources inline |
| ✅ | **Citation rendering** — Notion append includes `formatCitations()` footer with source URLs; agents page shows live "N web sources" badge during and after generation |

### Manual Steps — DeerFlow

- [ ] Provision Railway service: `railway up` from the deer-flow repo root, or use Railway GitHub integration
- [ ] Add `DEERFLOW_BASE_URL` to Doppler — internal Railway service URL (e.g. `https://deerflow.internal.railway.app`)
- [x] Add `TAVILY_API_KEY` to Doppler — register at https://tavily.com → API Keys (**Phase 17c complete; Tavily wired without DeerFlow**)
- [ ] Add `DEERFLOW_API_KEY` to Doppler — set in DeerFlow's `.env` as `API_KEY`, then copy here
- [ ] Verify sandbox: run `make doctor` on the DeerFlow instance; confirm Docker sandbox accessible
- [ ] Set `DEERFLOW_ENABLED=true` in Doppler — gates the routing hook in `lib/swarm/Queen.ts`

### Reference
- DeerFlow 2.0 GitHub: https://github.com/bytedance/deer-flow (MIT, 58k+ stars)
- DeerFlow skills DeerFlow can use: web research, slide decks, podcast export, image gen prompts, video gen prompts, data analysis, code execution
- Cost comparison: DeerFlow sidecar (~$25–50/mo infra) vs OpenClaw (Claude Pro subscription ~$20–100/mo) — DeerFlow wins on coding tasks; OpenClaw wins on browser automation + tasks requiring 2FA

---

## Phase 18 — Video Generation Pipeline (Not Started)

> End-to-end AI video production: Tribe v2 generates the script (already built) → n8n orchestrates the render pipeline → Kling 2.0 / Runway Gen-4 render the video → ElevenLabs adds voiceover → final video stored in R2 and linked to a Board card for approval. Covers both cinematic short-form content and ultra-realistic UGC (talking head / product demo) formats.

> **Key insight:** Neither DeerFlow nor any other agent framework renders video natively. All video AI tools require API integration. The advantage of building this in Nexus is that Tribe v2's neuro-optimised VSL script format (already live) feeds directly into the pipeline — DeerFlow would need to replicate this from scratch.

### 18a — Script-to-Video (Cinematic)

| Status | Item |
|--------|------|
| ⬜ | **Video brief agent** — new agent capability in `lib/agent-capabilities.ts`: accepts topic + format (`cinematic-short` \| `ugc-product` \| `ugc-talking-head` \| `explainer`) → generates structured video brief: scene-by-scene breakdown, shot descriptions, audio cues, on-screen text; saved as Notion page + Board card |
| ⬜ | **Tribe v2 VSL integration** — `/tools/content` gains "Export to Video" button when format = `vsl-script`; sends script to video brief agent; populates scene descriptions from VSL structure |
| ⬜ | **Kling 2.0 integration** — `lib/video/kling.ts`: `generateClip(prompt, referenceImage?, duration?)` → POST to Kling API → polls for completion → returns video URL; supports text-to-video and image-to-video (first/last frame guidance) |
| ⬜ | **Runway Gen-4 integration** — `lib/video/runway.ts`: `generateClip(prompt, style?)` → Runway API; used for cinematic/stylised output where Kling is less suitable; model selected per scene via video brief agent |
| ⬜ | **Scene assembly** — n8n workflow stitches clips: for each scene in brief → call Kling/Runway → collect video files → pass to FFmpeg node (n8n built-in) for concatenation → output final MP4 |
| ⬜ | **Video API route** — `POST /api/video/generate`: accepts video brief JSON → dispatches to n8n workflow → returns `{ jobId, estimatedDuration, estimatedCost }`; `GET /api/video/:jobId` streams progress via SSE |

### 18b — Voiceover & Audio Layer

| Status | Item |
|--------|------|
| ⬜ | **ElevenLabs integration** — `lib/audio/elevenlabs.ts`: `generateVoiceover(script, voiceId, stability?)` → ElevenLabs API → returns MP3; voice cloning optional (upload reference audio); `ELEVENLABS_API_KEY` in Doppler |
| ⬜ | **Voice profile store** — Supabase table `voice_profiles`: `{ id, name, elevenlabs_voice_id, sample_url, language }`; user selects per-project; agents recall saved voice for consistent brand audio |
| ⬜ | **Background music** — `lib/audio/suno.ts` or `lib/audio/udio.ts`: `generateTrack(mood, duration)` → AI music API → returns MP3; mood inferred from video brief (e.g. "high energy" for product demo, "ambient" for explainer) |
| ⬜ | **Audio mix** — n8n FFmpeg node: voiceover + background music → duck music at -18dB under speech → mixed MP4 |
| ⬜ | **Lip-sync / dubbing** — optional: pass final audio through ElevenLabs dubbing API or D-ID to sync mouth movement if using a talking avatar |

### 18c — UGC Format (Talking Head / Product Demo)

| Status | Item |
|--------|------|
| ⬜ | **HeyGen integration** — `lib/video/heygen.ts`: `generateAvatar(script, avatarId, voiceId)` → HeyGen API → returns video URL; supports 100+ photorealistic avatars + custom avatar upload; `HEYGEN_API_KEY` in Doppler |
| ⬜ | **Avatar library** — `/tools/video/avatars`: browse + preview HeyGen avatar catalogue; user pins 1–3 brand avatars; avatar ID stored in business profile |
| ⬜ | **Product demo mode** — `lib/video/heygen.ts` `generateProductDemo(productImages[], script)` → HeyGen screen-record mode; avatar presents on-screen product walkthrough |
| ⬜ | **D-ID fallback** — `lib/video/did.ts`: cheaper alternative to HeyGen for simple talking-head; `generateTalkingPhoto(imageUrl, audioUrl)` → D-ID API → MP4 |
| ⬜ | **muapi.ai scene images** — `lib/media/muapi.ts`: `generateSceneImage(prompt, style?)` → muapi.ai API → PNG; used as reference frames for Kling image-to-video or as static inserts in the final video; `MUAPI_AI_KEY` in Doppler (planned since Phase 12) |

### 18d — Asset Management & Approval

| Status | Item |
|--------|------|
| ⬜ | **Video storage** — completed MP4s uploaded to Cloudflare R2 (`lib/r2.ts`, already exists); presigned URL returned; thumbnail extracted via FFmpeg and stored alongside |
| ⬜ | **Board card auto-creation** — on video completion, Board card created in Review column: card includes video player (HTML5 `<video>` with presigned URL), script, cost breakdown, platform export links |
| ⬜ | **Video player in Review modal** — `components/board/ReviewModal.tsx` gains video-aware rendering: detects `.mp4` / `.webm` asset URLs → renders inline video player with playback controls |
| ⬜ | **Platform export** — one-click download as: 9:16 (TikTok/Reels/Shorts), 1:1 (Instagram feed), 16:9 (YouTube/LinkedIn); aspect ratio conversion via FFmpeg in n8n workflow |
| ⬜ | **Video dashboard widget** — `/dashboard` gains "Video Production" section: videos in pipeline, avg render time, total cost this month, top-performing format |

### Manual Steps — Video Pipeline

- [ ] Register Kling 2.0 API: https://klingai.com/api → add `KLING_API_KEY` to Doppler
- [ ] Register Runway Gen-4 API: https://runwayml.com → add `RUNWAY_API_KEY` to Doppler
- [ ] Register ElevenLabs: https://elevenlabs.io → add `ELEVENLABS_API_KEY` to Doppler
- [ ] Register HeyGen: https://heygen.com → add `HEYGEN_API_KEY` to Doppler (for UGC/avatar videos)
- [ ] Register D-ID: https://d-id.com → add `DID_API_KEY` to Doppler (cheaper talking-head fallback)
- [ ] Register muapi.ai: https://muapi.ai → add `MUAPI_AI_KEY` to Doppler (scene image generation)
- [ ] Optional — Suno or Udio for AI background music: add `SUNO_API_KEY` or `UDIO_API_KEY` to Doppler
- [ ] Ensure FFmpeg available in n8n instance (pre-installed in n8n Docker image)
- [ ] Set R2 CORS policy to allow presigned URL playback from Vercel domain

### Cost Reference (per video, approximate)

| Format | Tools | Estimated Cost |
|--------|-------|----------------|
| 60s cinematic (8 scenes) | Kling 2.0 + ElevenLabs + Suno | ~$2–8 |
| 30s UGC talking head | HeyGen + ElevenLabs | ~$1–3 |
| 90s explainer | Runway Gen-4 + ElevenLabs + muapi.ai | ~$5–15 |
| 3-min product demo | HeyGen enterprise + ElevenLabs | ~$5–10 |

---

## Phase 19 — Nexus Builds Nexus (Self-Development Mode) (19a + 19b Complete)

> Use the platform's own AI agent infrastructure to develop and improve itself — eliminating reliance on Claude Code CLI (and its usage limits) as the primary dev tool. Two sub-modes: **Dev Console** (user-driven feature requests and bug fixes) and **Research Loop** (scheduled agent that monitors AI/dev research and proposes improvements autonomously). Start on MacBook 2019 locally; graduate to cloud execution as the platform matures.

### Design Decisions

**MacBook 2019 as local dev host**
OpenClaw / Claude Code CLI is already available locally via `claude` in your terminal. The platform can dispatch tasks to it via the existing OpenClaw gateway (`OPENCLAW_GATEWAY_URL` pointing to `localhost`). No new infrastructure needed for phase 1 — just run the dev server and OpenClaw sidecar side-by-side. When graduating to cloud, deploy OpenClaw on Railway or Fly.io.

**Why this is safe**
The agent only has access to the local repo. Git is the safety net — every change is on a branch, user reviews the diff, approves via the Board, and merges manually. No auto-merge to main without explicit approval.

### 19a — Dev Console (User-Driven) ✅

| Status | Item |
|--------|------|
| ✅ | **`/build` page** — dedicated dev console with feature/bug/error request types; split input + streaming plan view |
| ✅ | **Task planner agent** — `POST /api/build/plan` streams Claude Opus; outputs human analysis then `<plan>…</plan>` JSON with title, steps, affected files, complexity (S/M/L/XL), risk, branchName, commitMessage, testInstructions |
| ✅ | **OpenClaw dispatch** — `POST /api/build/dispatch` sends approved plan to OpenClaw gateway with full coding conventions; creates Board card in In-Progress column; returns sessionId + branchUrl |
| ✅ | **File tree context** — `GET /api/build/filetree` returns recursive depth-3 file tree (excludes node_modules/.git/.next); injected into every plan prompt |
| ✅ | **Git integration** — plan JSON includes `branchName: claude/<slug>` and `commitMessage` in conventional commit format; OpenClaw instructed to create branch, implement, tsc check, commit, push |
| ✅ | **Board card creation** — dispatch creates a Supabase task in `in-progress` column with plan summary + branch link; visible at `/board` |
| ✅ | **Sidebar nav** — Build (`Terminal` icon) added between Board and Swarm |
| ⬜ | **Diff viewer** — Board Review card renders the git diff with syntax highlighting; user approves (merge) or rejects (close branch) from the UI |
| ⬜ | **Error paste mode** — paste a TypeScript/Next.js error → agent reads the relevant source files via the graph → diagnoses root cause → proposes fix → dispatches to OpenClaw |
| ⬜ | **CI status badge** — card shows Vercel deploy status; if deploy fails after merge, auto-creates a new fix task and re-dispatches |

### 19b — Research Loop (Autonomous Improvement) ✅ Complete

| Status | Item |
|--------|------|
| ✅ | **Weekly research cron** — Inngest scheduled function (`inngest/functions/research-loop.ts`) runs every Sunday 09:00 UTC; uses Tavily to search 6 queries covering AI frameworks, Next.js, LLM cost, TypeScript, Vercel, Supabase, Tailwind, Clerk, Inngest, Anthropic |
| ✅ | **Research digest agent** — Claude Haiku synthesises search results into up to 8 structured suggestions: new tools, deprecations, breaking changes, performance/cost improvements |
| ✅ | **Suggestion cards** — high/medium impact suggestions auto-create Board cards in Backlog with source link, impact level, work estimate; critical/high security issues create priority cards |
| ✅ | **Stack health monitor** — `npm audit --json` run by the agent; moderate+ vulnerabilities auto-create high-priority security cards on the Board |
| ✅ | **Research tab on `/build`** — tab switcher (Console / Research) on the build page; shows digest, category-filtered suggestion cards (security/performance/cost/DX/deprecation/new-tool), stack health panel, run history; Run Now button triggers manual research run |

### Manual Steps — Phase 19

- [ ] Ensure OpenClaw gateway is running locally: `claude` CLI in server mode or via MyClaw
- [ ] Set `OPENCLAW_GATEWAY_URL=http://localhost:<port>` in Doppler for local dev
- [ ] Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in Doppler for cron jobs
- [ ] Create `claude/<branch>` branch protection rule: require PR review before merge to main

---

## Phase 20 — Local-First Memory Engine ✅

> Replace the Notion dependency for knowledge storage with a local-first, free, version-controlled alternative. Notion API requires a paid subscription ($8–$16/mo); this phase builds an equivalent store that is fully owned, costs nothing, and can optionally mirror to Notion or GitHub for backup.

### Design Decision: GitHub Repo as Free Notion

**The approach:** A private GitHub repo (`pinnacleadvisors/nexus-memory`) stores knowledge as Markdown files in a structured folder hierarchy. Every agent write operation commits a new file or appends to an existing one. GitHub's API is free for private repos (up to rate limits). The repo becomes a versioned, searchable, diffable knowledge base.

```
nexus-memory/
├── businesses/
│   └── <business-id>/
│       ├── README.md          ← Business profile
│       ├── market-research/   ← Research agent outputs
│       ├── content/           ← Tribe v2 outputs
│       └── financials/        ← Financial model outputs
├── projects/
│   └── <project-id>/
│       ├── spec.md
│       └── decisions/         ← ADRs
├── agent-runs/
│   └── <YYYY-MM-DD>/          ← Daily logs
└── library/                   ← Phase 15 library entries as markdown
```

**Why not AppFlowy / AFFiNE / Obsidian?**
- AppFlowy / AFFiNE require self-hosting (extra infra, maintenance)
- Obsidian has no free API for programmatic writes
- GitHub API: free, already authenticated (GitHub MCP in place), universally readable, zero extra infra

**Migration path:** When business is generating revenue, add Notion as an optional sync target — one-way push from GitHub to Notion on each write. No lock-in.

| Status | Item |
|--------|------|
| ✅ | **`nexus-memory` repo** — create private GitHub repo `pinnacleadvisors/nexus-memory`; initialise folder structure above; add `README.md` explaining the schema |
| ✅ | **`lib/memory/github.ts`** — `writePage(path, content, message?)`: calls GitHub Contents API to create or update a file; `readPage(path)`: fetch and decode; `searchPages(q)`: GitHub code search API; `listPages(folder)`: directory listing |
| ✅ | **Memory API routes** — `POST /api/memory` (write page), `GET /api/memory?path=` (read), `GET /api/memory/search?q=` (search), `GET /api/memory/list?folder=` (tree); all authenticated via Clerk; writes go to GitHub, reads served from cache (5-min TTL) |
| ✅ | **Agent write integration** — `writeAgentRun()` called in `app/api/agent/route.ts` `onFinish`; Notion append kept as optional secondary sink when `notionPageId` is set |
| ✅ | **Memory viewer** — `/tools/memory` page: file tree browser, markdown renderer with syntax highlighting, search bar backed by GitHub search API, edit button (opens inline editor that commits on save) |
| ✅ | **Context injection** — before every agent run, `searchMemory(businessName)` retrieves relevant pages and prepends as `## Prior Agent Memory` context block; reduces cold-start hallucinations |
| ✅ | **Supabase cache layer** — `memory_cache` table: `{ path, content, sha, cached_at }`; reads hit cache first, revalidate after 5 min; avoids GitHub rate limits during high-volume agent sessions |
| ⬜ | **Notion sync (optional)** — when `NOTION_TOKEN` is set: after each GitHub write, push the same content to the linked Notion page via the existing `lib/notion.ts` `appendBlocks()`; bidirectional sync is out of scope |

### Manual Steps — Phase 20

- [✅] Create private repo `pinnacleadvisors/nexus-memory` on GitHub
- [✅] Generate GitHub PAT with `repo` scope → add as `GITHUB_MEMORY_TOKEN` in Doppler
- [✅] Create `GITHUB_MEMORY_REPO=pinnacleadvisors/nexus-memory` in Doppler
- [ ] (Optional) Upgrade to Notion paid plan for sync: add `NOTION_TOKEN` to Doppler

---

## Phase 21 — OSS-First Stack & Validated Tool Upgrades (Not Started)

> For every paid tool in the stack: identify the best free/open-source alternative for the zero-revenue phase, and the right time to upgrade based on revenue milestones. Principle: **own your stack until you can afford to delegate**.

### Tool Audit & Replacement Map

| Layer | Current (Paid) | Free/OSS Alternative | Upgrade Trigger |
|-------|---------------|----------------------|-----------------|
| **Auth** | Clerk v7 (~$25/mo at scale) | **Keep Clerk** — free tier is 10k MAU which covers the entire zero-revenue phase | >10k users |
| **Secrets** | Doppler (free tier) | **Infisical** (fully OSS, self-hostable) — same DX as Doppler, MIT licence | Never — Doppler free tier sufficient |
| **Hosting** | Vercel (free tier, then $20/mo) | **Coolify** (self-host on Hetzner €4/mo) — one-click Next.js deploy, auto SSL, preview URLs | First paying customer or >100k page views |
| **Database** | Supabase (free 500MB) | **PocketBase** (single binary, self-host) or **Neon** (free 10GB serverless Postgres) — migrate when Supabase free tier limit hit | >500MB data or >50k DB requests/day |
| **Email** | Resend (free 3k/mo) | **Brevo** (free 10k/mo) or **Nodemailer + SMTP** (free via Gmail/Zoho) — swap transport in `lib/email.ts` | >10k emails/month |
| **Error tracking** | Sentry (free 5k events) | **GlitchTip** (OSS Sentry clone, self-host free) or **OpenStatus** | >5k errors/mo or need data ownership |
| **Analytics** | PostHog (free 1M events) | **Umami** (OSS, self-host, no limits) or **Plausible** (OSS) | >1M events/month |
| **Workflow automation** | n8n (already self-host free) | ✅ Already free — n8n Community Edition is OSS | — |
| **Notes/Memory** | Notion ($8–16/mo) | ✅ **Phase 20 GitHub memory engine** — replaces Notion entirely for free ✅ Done | When revenue > $500/mo, add Notion as premium sync |
| **Video — cinematic** | Kling 2.0 / Runway ($per-use) | **CogVideoX** (OSS, run on GPU) or **AnimateDiff** — quality gap exists; use for internal/draft | First video product revenue |
| **Video — talking head** | HeyGen / D-ID ($per-use) | **SadTalker** (OSS, local) or **Wav2Lip** (OSS) — lower quality, needs local GPU | First video product revenue |
| **Voiceover** | ElevenLabs (free 10k chars/mo) | **Coqui TTS** (OSS, local, no limits) or **Bark** (OSS, local) — quality close to EL at ~60% | >10k chars/mo |
| **Community detection** | Louvain (`graphology-communities-louvain`) | **Leiden algorithm** — better quality, no disconnected communities (see note below) | Already OSS; migrate in Phase 22 |
| **Agent execution** | OpenClaw / MyClaw (Claude Pro ~$20/mo) | **Open-source Claude Code CLI** already free with API key — MyClaw adds convenience, not capability | Keep MyClaw; it IS the OSS tool |

### Leiden vs Louvain — Decision

**Current:** Louvain via `graphology-communities-louvain` (Phase 14).

**The problem with Louvain for this use case:**
Louvain can produce **disconnected communities** — nodes grouped into the same cluster that have no path between them inside that cluster. In the knowledge graph where clusters represent business domains (projects, agents, tools), this means visually unrelated nodes appear in the same colour group. It also gets stuck in local optima and produces different results on each run (non-deterministic), making the graph unstable across page loads.

**Why Leiden is better here:**
- Guarantees **well-connected communities** (no disconnected nodes within a cluster)
- Produces higher modularity scores consistently
- Deterministic output when seeded (stable graph across loads)
- Developed specifically to fix Louvain's flaws (Traag, Waltman, van Eck 2019)

**The catch:**
`graphology-communities-leiden` does not exist yet in the JS ecosystem. Options:
1. **Pure JS port** — implement the Leiden refinement phase as a TypeScript function in `lib/graph/leiden.ts` (medium complexity, ~200 lines)
2. **Python sidecar via DeerFlow** — run Leiden via `leidenalg` Python package inside DeerFlow's sandbox; return cluster assignments as JSON
3. **WASM build** — compile `igraph` or `libleidenalg` to WASM (complex, overkill at current graph scale)

**Recommendation: Option 1 — Pure JS port** (Phase 22). The graph is small enough (<1000 nodes) that a clean TypeScript implementation outperforms calling a Python sidecar. Replace `assignClusters()` in `lib/graph/builder.ts`.

**Verdict: Switch to Leiden in Phase 22.** Louvain is acceptable for now (graph is small, clusters are illustrative not analytical). When graph has real data and users are navigating by cluster, the stability and correctness of Leiden will matter.

### OSS Tool Integration Order

1. **Phase 21a — Brevo email** (drop-in Resend replacement for >3k/mo volume, same API shape)
2. **Phase 21b — Umami analytics** (self-host alongside Nexus on same Coolify instance)
3. **Phase 21c — GlitchTip error tracking** (Sentry-compatible SDK, zero code changes)
4. **Phase 21d — Coolify hosting** (when Vercel free tier limits hit or first paid customer)
5. **Phase 21e — Coqui TTS** (local voiceover for draft video content, no per-char cost)
6. **Phase 21f — SadTalker / Wav2Lip** (local talking-head for internal demos)

### Manual Steps — Phase 21

- [ ] Self-host Umami: `docker run -d -p 3001:3000 ghcr.io/umami-software/umami` on same VPS as n8n
- [ ] Self-host GlitchTip: `docker-compose` from `glitchtip/glitchtip-docker`; set `DSN` env var
- [ ] Register Brevo: https://brevo.com → free 10k/mo → add `BREVO_API_KEY` to Doppler
- [ ] Evaluate Coolify on Hetzner CX21 (€4/mo) when Vercel usage exceeds free tier
- [ ] Install Coqui TTS locally: `pip install TTS` → test voice clone → wrap in FastAPI endpoint

---

## Immediate Next Steps (Priority Order)

### Quick wins (hours, not days)
1. **Add Tavily web search** — `npm i @tavily/core`; add `TAVILY_API_KEY` to Doppler; inject live search results into the researcher swarm agent in `lib/swarm/agents/registry.ts`. Closes the biggest quality gap vs DeerFlow (~4 hrs)
2. **Configure OpenClaw** at `/tools/claw` → Forge chat goes live using Claude Pro subscription (no API key needed)
3. **Set `ANTHROPIC_API_KEY`** in Doppler (optional) → fallback if OpenClaw is unavailable

### Infrastructure (this week)
4. **Set up Supabase** → replace mock data with real agent state
5. **Add Stripe webhook** → real revenue on Dashboard
6. **Phase 20 memory engine** → create `nexus-memory` GitHub repo + `GITHUB_MEMORY_TOKEN` in Doppler; replaces Notion dependency entirely for free
7. **Enable Clerk MFA** → security baseline for production use

### Phase 19 — Start "Nexus builds Nexus" on MacBook
8. **Run OpenClaw gateway locally** (`claude` CLI in server mode, `OPENCLAW_GATEWAY_URL=http://localhost:<port>`)
9. **Build `/build` dev console page** → first task: have it implement itself
10. **Wire research loop** → Inngest cron + Tavily → weekly improvement suggestions on Board

### Phase 17 fast-track (deploy DeerFlow alongside Nexus)
11. **Deploy DeerFlow 2.0** to Railway ($25/mo) — gives sandboxed bash execution + live multi-hop web research with source citations; integrate via `lib/deerflow/client.ts`; reduces or eliminates OpenClaw dependency for coding tasks

---

## Tech Stack Reference

| Layer | Tool | Status |
|-------|------|--------|
| Framework | Next.js 16 (App Router) | ✅ Live |
| UI | React 19 + Tailwind CSS 4 + lucide-react | ✅ Live |
| Auth | Clerk v7 (MFA capable) | ✅ Live |
| Secrets | Doppler | ✅ Integrated |
| AI (advisor) | Claude Opus 4.6 (strategic reasoning) | ✅ Wired up |
| AI (executioner) | Claude Sonnet 4.6 (default, configurable) | ✅ Wired up |
| AI (fallback) | OpenAI GPT-4o | ⬜ Configured, not wired |
| Agent orchestration | OpenClaw / MyClaw | ✅ Integrated |
| Database | Supabase (Postgres + Realtime) | ⬜ Not set up |
| ORM | Prisma | ⬜ Not set up |
| Storage | Supabase Storage / Cloudflare R2 | ✅ API routes wired |
| Payments | Stripe | ⬜ Not set up |
| Email | Resend | ⬜ Not set up |
| Monitoring | Sentry | ⬜ Not set up |
| Analytics | PostHog | ⬜ Not set up |
| Memory / Notes | GitHub repo (Phase 20) → Notion optional sync | ✅ Phase 20 |
| Hosting | Vercel | ✅ Live |
| CI/CD | GitHub → Vercel auto-deploy | ✅ Live |
| Drag & drop | dnd-kit | ✅ Live |
| Charts | Recharts | ✅ Live |
| Workflow automation | n8n (self-hosted or cloud) | ✅ Phase 13b |
| Web research | Tavily (multi-hop search + citations) | ⬜ Phase 17c (quick win) |
| SuperAgent sidecar | DeerFlow 2.0 (ByteDance OSS, MIT) | ⬜ Phase 17 |
| Media image generation | muapi.ai | ⬜ Phase 18 |
| Video generation (cinematic) | Kling 2.0 / Runway Gen-4 | ⬜ Phase 18 |
| Video generation (UGC/avatar) | HeyGen / D-ID | ⬜ Phase 18 |
| Voiceover | ElevenLabs | ⬜ Phase 18 |
| Background music | Suno / Udio | ⬜ Phase 18 |
| 3D graph rendering | react-three-fiber + three.js | ⬜ Phase 14 |
| Graph computation | graphology + Louvain (→ Leiden in Phase 22) | ✅ Phase 14 |
| Swarm orchestration | Ruflo-inspired (custom) | ✅ Phase 11 |
| Vector search | Supabase pgvector | ⬜ Phase 14/15 |

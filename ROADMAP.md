# Nexus — Platform Roadmap

> Last updated: 2026-04-14 (Phases 11–13a complete; 13b/13c + Phases 14–18 planned)
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
- [ ] Run `npm run migrate` to apply all pending SQL migrations

#### SQL Migrations

Tracked automatically by `npm run migrate`. Update ✅/⬜ after each successful run.

| File | Description | Applied |
|------|-------------|---------|
| `supabase/migrations/001_initial_schema.sql` | Core tables: agents, revenue_events, token_events, alert_thresholds | ⬜ |
| `supabase/migrations/002_tasks_and_projects.sql` | Kanban tasks + projects tables with Supabase Realtime | ⬜ |
| `supabase/migrations/003_businesses_milestones.sql` | businesses + milestones tables; user_id on projects + agents; Realtime enabled | ⬜ |
| `supabase/migrations/004_rls_policies.sql` | Row-level security on all tables; businesses per-user via Clerk JWT sub | ⬜ |
| `supabase/migrations/005_audit_log.sql` | audit_log table with indexes on user_id, action, resource, created_at | ⬜ |
| `supabase/migrations/006_swarm.sql` | swarm_runs, swarm_tasks, reasoning_patterns tables; Realtime enabled | ⬜ |

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

## Phase 13 — Consultant Agent + n8n Workflow Automation (Partial — 13a Complete)

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

### 13b — n8n Workflow Generation

| Status | Item |
|--------|------|
| ⬜ | **n8n blueprint generator** — `POST /api/n8n/generate` accepts a workflow description and outputs a valid n8n JSON workflow file (compatible with n8n v1+ import format) |
| ⬜ | **Workflow templates** — pre-built blueprint library: social post scheduler, lead capture → CRM, invoice generation, content republishing pipeline, competitor monitoring, onboarding email sequence, support ticket routing, analytics digest |
| ⬜ | **muapi.ai node** — custom n8n HTTP node configuration for muapi.ai; generates images/video/audio assets as part of content workflows; credentials stored in n8n credential store (not Doppler) |
| ⬜ | **Setup checklist generation** — for each workflow blueprint, consultant generates a human-readable checklist of: accounts to create, API keys to obtain, OAuth connections to authorise, n8n credentials to configure; list is saved to Notion + added to Board as sequential Backlog cards |
| ⬜ | **n8n webhook receiver** — `POST /api/webhooks/n8n` receives workflow completion events; parses payload, updates relevant Board card status, appends result to Notion |
| ⬜ | **Workflow status page** — `/tools/n8n` shows all active n8n workflows, last run status, next scheduled run, and a "trigger now" button |

### 13c — OpenClaw Fallback Bridge

| Status | Item |
|--------|------|
| ⬜ | **API gap detection** — consultant flags any workflow step that cannot be accomplished via a public API (e.g. scraping, browser automation, actions requiring 2FA); these steps are automatically dispatched to OpenClaw |
| ⬜ | **Hybrid workflow** — n8n handles API-native steps → OpenClaw handles browser/scraping steps → result flows back into n8n via webhook; orchestrated from `/api/swarm/dispatch` |
| ⬜ | **Priority routing rule** — Consultant agent always checks n8n first; only escalates to OpenClaw when n8n cannot accomplish the task natively |

### Manual Steps — n8n
- [ ] Deploy n8n: self-hosted (`docker run n8nio/n8n`) or n8n Cloud (https://n8n.io/cloud/)
- [ ] Add `N8N_BASE_URL` to Doppler — your n8n instance URL (e.g. `https://n8n.yourdomain.com`)
- [ ] Add `N8N_API_KEY` to Doppler — n8n Settings → API → Create API Key
- [ ] Register Nexus webhook in n8n: URL = `https://<your-vercel-domain>/api/webhooks/n8n`
- [ ] Add `MUAPI_AI_KEY` to Doppler — register at https://muapi.ai → API Keys
- [ ] Import starter workflow blueprints from `/tools/n8n` after Phase 13b is deployed

---

## Phase 14 — 3D Relational Knowledge Graph (Not Started)

> A live 3D graph where every business, project, milestone, agent, tool, workflow, and code repository is a node. Edges show relationships: "project uses tool", "agent created asset", "milestone depends on milestone", "workflow triggers agent". Agents query the graph via a lightweight API to get full relational context in a single call — inspired by Graphify's 71x token reduction and GitNexus's precomputed relational intelligence.

| Status | Item |
|--------|------|
| ⬜ | **Graph data model** — `lib/graph/types.ts`: `GraphNode` (id, type, label, metadata, position3d), `GraphEdge` (source, target, relation, weight, createdAt); node types: `business`, `project`, `milestone`, `agent`, `tool`, `workflow`, `repository`, `asset`, `prompt`, `skill` |
| ⬜ | **Graph builder** — `lib/graph/builder.ts`: queries Supabase for all entities and relationships; constructs in-memory graph; runs Leiden community detection to assign cluster IDs; exports `graph.json`; incremental update on entity change |
| ⬜ | **Graph API** — `GET /api/graph` returns full serialised graph; `GET /api/graph/node/:id` returns node + 1-hop neighbourhood; `GET /api/graph/path?from=&to=` returns shortest path; `POST /api/graph/query` accepts natural language query, returns subgraph |
| ⬜ | **3D renderer** — `/graph` page using `react-three-fiber` + `@react-three/drei`; nodes rendered as glowing spheres sized by PageRank score; edges as lines with opacity proportional to relationship strength; clusters occupy distinct 3D regions; camera orbit/zoom/pan |
| ⬜ | **Node type visual encoding** — businesses: gold, projects: indigo, milestones: teal, agents: purple, tools: grey, workflows: orange, repos: green, assets: pink; node size = connection count; edge colour = relation type |
| ⬜ | **Agent context API** — `POST /api/graph/context` accepts a task description; returns the minimal subgraph of relevant nodes (cosine similarity on node embeddings); agents call this before starting any task to get relational context without scanning all files |
| ⬜ | **MCP tool exposure** — `get_graph_context(task_description)` MCP tool so OpenClaw and Claude Code can call it natively; returns JSON subgraph of ≤20 nodes; target: 50–70x token reduction vs raw file scanning (per Graphify benchmarks) |
| ⬜ | **Search + filter panel** — sidebar on `/graph` with text search, node type filter, relationship filter, time-range slider; matching nodes pulse in the 3D view |
| ⬜ | **Temporal replay** — scrub through time to see how the graph grew: each node appears at its `createdAt` timestamp; reveals growth patterns and bottlenecks |
| ⬜ | **Auto-layout modes** — force-directed (default), hierarchical (org-chart), radial (business-centric), cluster-grid; toggle in UI |
| ⬜ | **Embed in Forge / Dashboard** — minimap 2D projection of the graph shown in Forge sidebar; clicking a node deep-links to the relevant project or tool |

### Technical approach
- **Renderer**: `react-three-fiber` + `@react-three/drei` + `three.js` (already a transitive dep) — no new rendering engine needed
- **Graph computation**: `graphology` + `graphology-communities-louvain` (JS-native, no Python); runs server-side at build/refresh time
- **Embeddings**: Supabase `pgvector` + `text-embedding-3-small` (OpenAI) or Anthropic's embedding endpoint for `POST /api/graph/context`
- **Performance**: graph snapshot cached in Redis/Supabase, rebuilt on entity mutation; 3D scene uses instanced meshes for up to 10,000 nodes at 60 fps

---

## Phase 15 — Library Layer & Token Efficiency (Not Started)

> A structured, searchable store of reusable building blocks — code functions, agent configs, prompt templates, and skill definitions. Agents query the library before writing anything new, dramatically reducing duplicate generation and per-task token spend.

| Status | Item |
|--------|------|
| ⬜ | **Database schema** — migration `006_libraries.sql`: tables `code_snippets`, `agent_templates`, `prompt_templates`, `skill_definitions`; all with `embedding vector(1536)`, `tags text[]`, `usage_count int`, `avg_quality_score float` |
| ⬜ | **Code function library** — `/tools/library/code`: stores reusable TypeScript/Python/SQL snippets; each tagged with language, purpose, dependencies; agents call `GET /api/library/code?q=` before generating boilerplate |
| ⬜ | **Agent template library** — `/tools/library/agents`: stores agent system prompt blueprints (role, constraints, output format, example); versioned; consultant agent uses this to spawn specialist agents without re-writing prompts |
| ⬜ | **Prompt library** — `/tools/library/prompts`: curated prompt templates for common tasks; each template has fill-in variables, neuro-optimisation score, and usage analytics; agents retrieve best-scoring template for task type |
| ⬜ | **Skill definitions library** — `/tools/library/skills`: structured skill definitions compatible with MCP tool format; agents check this library before requesting new OpenClaw skills |
| ⬜ | **Semantic search** — `POST /api/library/search?type=code|agent|prompt|skill&q=` does pgvector cosine similarity search; returns top-5 matches with similarity score; embedded at task start in every swarm run |
| ⬜ | **Auto-population** — after every completed agent run: extract reusable fragments (functions, prompts, patterns) via a post-processing agent; auto-add to library with quality score derived from user approval |
| ⬜ | **Library UI** — `/tools/library` with tabbed interface (Code / Agents / Prompts / Skills); search bar, tag filter, usage stats, copy button, "use in Forge" button |
| ⬜ | **Token savings tracker** — dashboard widget showing estimated tokens saved this week via library hits vs cold generation; motivates curation |

---

## Phase 16 — Organisation Chart & Agent Hierarchy (Not Started)

> A live org chart showing the full hierarchy of agents active in Nexus: who spawned whom, which queen is coordinating which specialists, what each layer is currently doing, and the accountability chain back to the user.

| Status | Item |
|--------|------|
| ⬜ | **Agent hierarchy model** — extend `agents` table: add `parent_agent_id`, `layer` (strategic/tactical/operational), `spawned_by`, `swarm_id`; all agent spawning events written to audit log |
| ⬜ | **Org chart page** — `/dashboard/org` renders a top-down tree: User → Strategic Queens → Tactical Queens → Specialist Agents → Background Workers; each node shows current status (idle/running/error), task count, and cost |
| ⬜ | **Layer definitions** — **L0: User** (approves, rejects, redirects); **L1: Strategic Queens** (goal decomposition, phase planning); **L2: Tactical Queens** (task assignment, resource allocation); **L3: Specialist Agents** (execution — coder, researcher, marketer etc.); **L4: Workers** (background jobs — Inngest functions, webhooks) |
| ⬜ | **Real-time updates** — org chart subscribes to Supabase Realtime `agents` channel; spawned agents appear instantly; completed agents dim; errors glow red |
| ⬜ | **Drill-down panel** — click any agent node to see: current task, last 5 actions, tokens used this session, model being used, associated board cards, and a "terminate" button |
| ⬜ | **Swimlane view** — alternative layout grouping agents by business/project rather than by hierarchy; shows cross-project agent sharing |
| ⬜ | **Accountability chain** — every Board card, Notion append, and file commit links back to the agent that created it and the queen that assigned it; visible in card detail view |
| ⬜ | **Agent utilisation chart** — stacked bar chart on dashboard showing agent hours (token-equivalent) by layer; highlights if strategic layer is over-indexing (plan-heavy) or if operational layer is bottlenecked |

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

### 17c — Tavily Live Web Search (Quick Win — Do First)

> Tavily can be integrated directly into Nexus's researcher agent without deploying DeerFlow. This closes the live-web-research gap in ~4 hours and can be done independently.

| Status | Item |
|--------|------|
| ⬜ | **Install Tavily** — `npm i @tavily/core`; add `TAVILY_API_KEY` to Doppler (free tier: 1,000 searches/mo; pro: $50/mo for 10,000) |
| ⬜ | **Search tool** — `lib/tools/tavily.ts`: `searchWeb(query, maxResults?)` → calls Tavily API → returns `{ title, url, content, score }[]`; auto-truncates to 4,000 tokens |
| ⬜ | **Inject into researcher agent** — researcher system prompt updated: "Before answering, call the `search_web` tool with your research queries. Cite all sources." Tool calling wired via Vercel AI SDK `tools` parameter |
| ⬜ | **Citation rendering** — Board card detail view renders citations as clickable source links; Notion append includes citation list below report |

### Manual Steps — DeerFlow

- [ ] Provision Railway service: `railway up` from the deer-flow repo root, or use Railway GitHub integration
- [ ] Add `DEERFLOW_BASE_URL` to Doppler — internal Railway service URL (e.g. `https://deerflow.internal.railway.app`)
- [ ] Add `TAVILY_API_KEY` to Doppler — register at https://tavily.com → API Keys (do this first; works without DeerFlow)
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

## Immediate Next Steps (Priority Order)

### Quick wins (hours, not days)
1. **Add Tavily web search** — `npm i @tavily/core`; add `TAVILY_API_KEY` to Doppler; inject live search results into the researcher swarm agent in `lib/swarm/agents/registry.ts`. Closes the biggest quality gap vs DeerFlow (~4 hrs)
2. **Configure OpenClaw** at `/tools/claw` → Forge chat goes live using Claude Pro subscription (no API key needed)
3. **Set `ANTHROPIC_API_KEY`** in Doppler (optional) → fallback if OpenClaw is unavailable

### Infrastructure (this week)
4. **Set up Supabase** → replace mock data with real agent state
5. **Add Stripe webhook** → real revenue on Dashboard
6. **Implement Notion API** → agents write to knowledge base
7. **Enable Clerk MFA** → security baseline for production use

### Phase 17 fast-track (deploy DeerFlow alongside Nexus)
8. **Deploy DeerFlow 2.0** to Railway ($25/mo) — gives sandboxed bash execution + live multi-hop web research with source citations; integrate via `lib/deerflow/client.ts`; reduces or eliminates OpenClaw dependency for coding tasks

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
| Notes | Notion API | ✅ Integrated (Phase 6) |
| Hosting | Vercel | ✅ Live |
| CI/CD | GitHub → Vercel auto-deploy | ✅ Live |
| Drag & drop | dnd-kit | ✅ Live |
| Charts | Recharts | ✅ Live |
| Workflow automation | n8n (self-hosted or cloud) | ⬜ Phase 13 |
| Web research | Tavily (multi-hop search + citations) | ⬜ Phase 17c (quick win) |
| SuperAgent sidecar | DeerFlow 2.0 (ByteDance OSS, MIT) | ⬜ Phase 17 |
| Media image generation | muapi.ai | ⬜ Phase 18 |
| Video generation (cinematic) | Kling 2.0 / Runway Gen-4 | ⬜ Phase 18 |
| Video generation (UGC/avatar) | HeyGen / D-ID | ⬜ Phase 18 |
| Voiceover | ElevenLabs | ⬜ Phase 18 |
| Background music | Suno / Udio | ⬜ Phase 18 |
| 3D graph rendering | react-three-fiber + three.js | ⬜ Phase 14 |
| Graph computation | graphology + Louvain community detection | ⬜ Phase 14 |
| Swarm orchestration | Ruflo-inspired (custom) | ✅ Phase 11 |
| Vector search | Supabase pgvector | ⬜ Phase 14/15 |

# Nexus — Platform Roadmap

> Last updated: 2026-04-11 (Phase 10)
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

- [ ] Create a Supabase project at https://supabase.com/dashboard
- [ ] Add `NEXT_PUBLIC_SUPABASE_URL` to Doppler — Project Settings → API → Project URL
- [ ] Add `NEXT_PUBLIC_SUPABASE_ANON_KEY` to Doppler — Project Settings → API → anon public key
- [ ] Add `SUPABASE_SERVICE_ROLE_KEY` to Doppler — Project Settings → API → service_role secret key
- [ ] Add `SUPABASE_PROJECT_REF` to Doppler — Project Settings → General → Reference ID (e.g. `abcdefghijklmnop`)
- [ ] Add `SUPABASE_ACCESS_TOKEN` to Doppler — https://supabase.com/account/tokens → Generate new token
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

> **Adding a new migration?** Create `supabase/migrations/NNN_description.sql`, add a row above with ⬜, then run `npm run migrate`.

---

### 📓 Notion (Knowledge Base)

- [ ] Connect Notion at `/tools/knowledge` — click "Connect Notion" (uses OAuth flow)
- [ ] Optional: Set `NOTION_API_KEY` in Doppler — internal integration token (bypasses OAuth, for server-side agent writes)
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

- [ ] Add `STRIPE_WEBHOOK_SECRET` to Doppler — Stripe Dashboard → Developers → Webhooks → endpoint secret
- [ ] Register webhook endpoint in Stripe Dashboard:
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

- [ ] Create R2 bucket in Cloudflare Dashboard → R2 → Create bucket (e.g. `nexus-assets`)
- [ ] Create R2 API token: Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API Token
- [ ] Add `R2_ACCOUNT_ID` to Doppler — Cloudflare Dashboard → right sidebar → Account ID
- [ ] Add `R2_ACCESS_KEY_ID` to Doppler — from R2 API token creation
- [ ] Add `R2_SECRET_ACCESS_KEY` to Doppler — from R2 API token creation
- [ ] Add `R2_BUCKET_NAME` to Doppler — bucket name (e.g. `nexus-assets`)
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

- [ ] **Clerk MFA** — Clerk Dashboard → Organization Settings → Multi-factor authentication → Enforce for all members
- [ ] **ENCRYPTION_KEY** — Generate and add to Doppler:
  ```
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  Add as `ENCRYPTION_KEY` in Doppler. Existing OAuth tokens in cookies will re-encrypt on next login.
- [ ] **Upstash Redis** — https://console.upstash.com → Create Database → copy REST URL + token
  - Add `UPSTASH_REDIS_REST_URL` to Doppler
  - Add `UPSTASH_REDIS_REST_TOKEN` to Doppler
- [ ] **GitHub Dependabot** — Repo Settings → Security → Dependabot → Enable "Dependabot alerts" + "Dependabot security updates"
- [ ] **Snyk** (optional) — https://app.snyk.io → Import repo → run first scan
- [ ] Run `npm run migrate` to apply migration 005 (audit_log table)

---

### 🔐 Row-Level Security (RLS — Clerk + Supabase JWT)

- [ ] In Clerk Dashboard → JWT Templates → New template → choose "Supabase"
  - Set audience to your Supabase project URL
  - Ensure `sub` claim maps to `{{user.id}}`
- [ ] In Supabase Dashboard → Settings → API → copy JWT Secret
- [ ] Paste the JWT Secret into the Clerk JWT template "Signing key" field
- [ ] Run `npm run migrate` to apply migration 004 (enables RLS + policies)

---

### 🤖 Agent Capabilities (Phase 10)

- [ ] Add `ANTHROPIC_API_KEY` to Doppler — required for `/tools/agents` to function
  - Get key at https://console.anthropic.com → API Keys → Create Key
  - Without this key the agents page returns a 503 with a clear error message
- [ ] Optional: set `OPENCLAW_GATEWAY_URL` + `OPENCLAW_BEARER_TOKEN` to route agent runs through OpenClaw (Claude Pro subscription) instead of direct API

---

### 💰 Cost & Rate Caps

- [ ] Set `CLAW_DAILY_DISPATCH_CAP` in Doppler — max Claw agent dispatches per day (default: `100`)
- [ ] Set `COST_ALERT_PER_RUN_USD` in Doppler — alert threshold per AI run (default: `0.50`)

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

## Immediate Next Steps (Priority Order)

1. **Configure OpenClaw** at `/tools/claw` → Forge chat goes live using Claude Pro subscription (no API key needed)
2. **Set `ANTHROPIC_API_KEY`** in Doppler (optional) → fallback if OpenClaw is unavailable
3. **Set up Supabase** → replace mock data with real agent state
4. **Add Stripe webhook** → real revenue on Dashboard
5. **Implement Notion API** → agents write to knowledge base
6. **Enable Clerk MFA** → security baseline for production use

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

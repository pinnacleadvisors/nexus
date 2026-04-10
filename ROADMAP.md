# Nexus — Platform Roadmap

> Last updated: 2026-04-10
> Goal: A fully automated, cloud-native business management platform where AI agents build, market, and maintain business ideas 24/7 — managed through a single secure dashboard.

---

## Legend
- ✅ Done
- 🔧 In progress / partial
- ⬜ Not started
- 🔒 Security-sensitive — requires audit before production use

---

## Manual Setup Checklist

> These are one-time steps that require action in a browser or terminal.
> Tick each box once done — Claude tracks which SQL migrations have been applied automatically via `schema_migrations` in your database, but everything else here is manual.

### Supabase (Database)

- [ ] Create a Supabase project at https://supabase.com/dashboard
- [ ] Add `NEXT_PUBLIC_SUPABASE_URL` to Doppler — Project Settings → API → Project URL
- [ ] Add `NEXT_PUBLIC_SUPABASE_ANON_KEY` to Doppler — Project Settings → API → anon public key
- [ ] Add `SUPABASE_SERVICE_ROLE_KEY` to Doppler — Project Settings → API → service_role secret key
- [ ] Add `SUPABASE_PROJECT_REF` to Doppler — Project Settings → General → Reference ID (e.g. `abcdefghijklmnop`)
- [ ] Add `SUPABASE_ACCESS_TOKEN` to Doppler — https://supabase.com/account/tokens → Generate new token
- [ ] Run `npm run migrate` to apply all pending SQL migrations

#### SQL Migrations

Tracked automatically — `npm run migrate` records each applied file in the `schema_migrations` table so nothing runs twice. Update the ✅/⬜ below after each successful run.

| File | Description | Applied |
|------|-------------|---------|
| `supabase/migrations/001_initial_schema.sql` | Core tables: agents, revenue_events, token_events, alert_thresholds | ⬜ |

> **Adding a new migration?** Create `supabase/migrations/NNN_description.sql`, add a row to this table with ⬜, then run `npm run migrate`. Claude will do this automatically when generating new SQL.

---

### Stripe (Payments)

- [ ] Add `STRIPE_WEBHOOK_SECRET` to Doppler — Stripe Dashboard → Developers → Webhooks → endpoint secret
- [ ] Register webhook endpoint in Stripe Dashboard:
  - URL: `https://<your-vercel-domain>/api/webhooks/stripe`
  - Events to subscribe: `payment_intent.succeeded`, `invoice.payment_succeeded`

---

### Sentry (Error Tracking)

- [ ] Run `npm install @sentry/nextjs`
- [ ] Run `npx @sentry/wizard@latest -i nextjs` (generates config files automatically)
- [ ] Add `SENTRY_DSN` to Doppler — Sentry project → Settings → Client Keys

---

### Resend (Email Alerts)

- [ ] Add `RESEND_API_KEY` to Doppler — resend.com → API Keys
- [ ] Verify your sending domain in the Resend dashboard

---

### OpenClaw / MyClaw (AI Agent)

- [ ] Configure gateway URL + hook token at `/tools/claw` in the Nexus dashboard

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
| ⬜ | Connect to real agent task queue (Supabase) |
| ⬜ | Hover preview on Completed cards (thumbnail of asset created) |
| ⬜ | Click-through on asset links — Google Drive, hosted URLs, GitHub PRs |
| ⬜ | Real-time card updates when agents complete tasks (Supabase Realtime) |
| ⬜ | Card shows which agent is actively working on it |
| ⬜ | Filter board by project / business |
| ⬜ | Approve triggers next milestone dispatch to OpenClaw |

---

## Phase 5 — OpenClaw / MyClaw Integration (In Progress)

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
| ⬜ | Connect Claw to Claude Code CLI (Command) for code generation tasks |
| ⬜ | Skill registry — list and audit each OpenClaw skill with permission scope |
| ⬜ | Claw webhook receiver — agent posts task completions back to Nexus |
| ⬜ | Claw status page — live view of what the agent is currently doing |
| ⬜ | Multi-agent parallelism — dispatch separate Claw instances per phase |
| ⬜ | Rate limiting + cost cap on Claw API proxy |
| ⬜ | Claw produces assets → auto-creates Kanban card in Review column |

---

## Phase 6 — Knowledge Base / Notes (Not Started)

| Status | Item |
|--------|------|
| ⬜ | Notion API integration — agents write research notes as pages |
| ⬜ | Notion database as project knowledge base (linked across businesses) |
| ⬜ | Each milestone completion appends to a shared Notion doc |
| ⬜ | Research PDFs auto-uploaded to Notion / Google Drive |
| ⬜ | Agent context window uses Notion docs to avoid repetition |
| ⬜ | Alternative: self-hosted Obsidian vault synced via Obsidian Sync |

---

## Phase 7 — Backend & Data Layer (Not Started)

| Status | Item |
|--------|------|
| ⬜ | Supabase project setup (PostgreSQL + Realtime + Storage) |
| ⬜ | Prisma schema — businesses, projects, milestones, agents, tasks, users |
| ⬜ | Migrate all mock data to live database queries |
| ⬜ | Row-level security (RLS) policies per user |
| ⬜ | Supabase Storage — agent-generated assets (PDFs, images, docs) |
| ⬜ | Cloudflare R2 for large binary asset storage (alternative) |
| ⬜ | Background job queue (e.g. Inngest or Trigger.dev) for async tasks |

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
| ⬜ | Retrieval-Augmented Generation (RAG) — agents query knowledge base not full history |

---

## Phase 9 — Security Hardening (Not Started)

| Status | Item |
|--------|------|
| ⬜ | Clerk MFA enforced for owner accounts |
| ⬜ | All API keys via Doppler — zero `.env` files in repo |
| ⬜ | OAuth tokens encrypted at rest (AES-256) before storing in DB |
| ⬜ | Rate limiting on all `/api/*` routes (Upstash Redis) |
| ⬜ | CSRF protection on mutation endpoints |
| ⬜ | Audit log — every agent action recorded with timestamp and actor |
| ⬜ | Per-skill security audit for each OpenClaw capability |
| ⬜ | Vulnerability scan with Snyk or GitHub Dependabot |
| ⬜ | Content Security Policy headers on all pages |

---

## Phase 10 — Agent Capabilities (Not Started)

These are the tasks agents should be able to execute autonomously:

| Status | Capability |
|--------|------------|
| ⬜ | **Research** — web search, competitor analysis, market sizing → Notion doc |
| ⬜ | **Content** — landing page copy, blog posts, email sequences |
| ⬜ | **Code** — web app scaffolding via Claude Code CLI, auto-PR to GitHub |
| ⬜ | **SEO** — keyword research, on-page optimisation recommendations |
| ⬜ | **Social media** — post drafts for LinkedIn, X, Instagram |
| ⬜ | **Customer service** — reply agent trained on business context |
| ⬜ | **Email outreach** — cold outreach sequences via Resend |
| ⬜ | **Design briefs** — structured prompts for image/brand generation |
| ⬜ | **Financial modelling** — revenue projections, cost breakdowns |
| ⬜ | **Legal** — terms of service / privacy policy draft generation |

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
| Agent orchestration | OpenClaw / MyClaw | 🔧 Partial |
| Database | Supabase (Postgres + Realtime) | ⬜ Not set up |
| ORM | Prisma | ⬜ Not set up |
| Storage | Supabase Storage / Cloudflare R2 | ⬜ Not set up |
| Payments | Stripe | ⬜ Not set up |
| Email | Resend | ⬜ Not set up |
| Monitoring | Sentry | ⬜ Not set up |
| Analytics | PostHog | ⬜ Not set up |
| Notes | Notion API | ⬜ Not set up |
| Hosting | Vercel | ✅ Live |
| CI/CD | GitHub → Vercel auto-deploy | ✅ Live |
| Drag & drop | dnd-kit | ✅ Live |
| Charts | Recharts | ✅ Live |

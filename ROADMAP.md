# Nexus — Platform Roadmap

> Last updated: 2026-04-09
> Goal: A fully automated, cloud-native business management platform where AI agents build, market, and maintain business ideas 24/7 — managed through a single secure dashboard.

---

## Legend
- ✅ Done
- 🔧 In progress / partial
- ⬜ Not started
- 🔒 Security-sensitive — requires audit before production use

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
| ⬜ | Consulting agent asks about budget, team size, target market upfront |
| ⬜ | Save/resume sessions — persist conversations and milestones to Supabase |
| ⬜ | Multi-business support — create named projects, switch between them |
| ⬜ | Export finalised business plan as PDF |
| ⬜ | Token efficiency: summarise old messages before hitting context window |

---

## Phase 3 — Dashboard (Partial)

| Status | Item |
|--------|------|
| ✅ | KPI grid (revenue, cost, net profit, active agents, tokens, tasks) |
| ✅ | Revenue vs cost area chart (recharts) |
| ✅ | Agent performance table (status, tasks, tokens, cost, last active) |
| ⬜ | Connect to real data source (Supabase) — replace mock data |
| ⬜ | Stripe webhook → real revenue figures |
| ⬜ | Token cost tracking per agent from Anthropic/OpenAI API usage logs |
| ⬜ | Real-time agent status via Supabase Realtime subscriptions |
| ⬜ | Sentry integration — error rate per agent shown on dashboard |
| ⬜ | Mobile-optimised layout for monitoring while travelling |
| ⬜ | Date range filter (7d / 30d / 90d / custom) on charts |
| ⬜ | Email/Slack alerts when cost exceeds threshold or agent errors spike |

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

## Phase 8 — Token Efficiency & Agent Intelligence (Not Started)

| Status | Item |
|--------|------|
| ⬜ | Sliding window summarisation — compress old messages before context limit |
| ⬜ | Retrieval-Augmented Generation (RAG) — agents query knowledge base not full history |
| ⬜ | Model routing — use Claude Haiku for simple tasks, Opus for complex reasoning |
| ⬜ | Prompt caching — use Anthropic prompt caching for repeated system prompts |
| ⬜ | Token usage logged per agent/task to Dashboard |
| ⬜ | Cost alert when a single agent run exceeds configurable threshold |

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
7. **Add prompt caching** → cut token costs immediately

---

## Tech Stack Reference

| Layer | Tool | Status |
|-------|------|--------|
| Framework | Next.js 16 (App Router) | ✅ Live |
| UI | React 19 + Tailwind CSS 4 + lucide-react | ✅ Live |
| Auth | Clerk v7 (MFA capable) | ✅ Live |
| Secrets | Doppler | ✅ Integrated |
| AI (primary) | Anthropic Claude (Sonnet 4.6) | ✅ Wired up |
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

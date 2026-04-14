# Nexus

An all-in-one platform to manage and automate one or multiple businesses. AI agents build, market, and maintain your ideas 24/7 — you monitor and approve work from anywhere via a secure dashboard.

## What it does

| Page | Description |
|------|-------------|
| `/forge` | Describe a business idea. A Claude consulting agent refines it, extracts milestones, builds a Gantt chart, and dispatches the project to your agent swarm or OpenClaw |
| `/dashboard` | Live view of cost vs revenue, agent performance, token usage, and KPIs |
| `/board` | Kanban board — see what agents are working on, approve or reject completed work |
| `/swarm` | Launch a multi-agent swarm: Strategic Queen decomposes goal → 22 specialist agents execute in phases → Raft/BFT/Gossip consensus → synthesised output |
| `/tools/content` | Tribe v2 — generate neuro-optimised content using 12 cognitive engagement principles; score, revise, and A/B test across 8 formats × 5 tone profiles |
| `/tools/agents` | Run 10 specialist AI agents (research, SEO, financial model, legal, email outreach, social media, code spec, and more) |
| `/graph` | Live 3D relational knowledge graph — every business, project, agent, tool, and workflow as a node; WebGL scene with orbit/zoom/pan, Louvain clusters, PageRank sizing, search + filter, temporal replay, 4 layout modes; agent context API reduces token usage 50–70× |
| `/tools/n8n` | n8n workflow hub — 8 pre-built blueprints, AI-powered custom workflow generator, live activate/deactivate |
| `/tools/library` | Reusable building-block library — code snippets, agent templates, prompt templates, and skill definitions; agents query before generating anything new; token savings tracker shows estimated cost avoidance |
| `/tools/claw` | Configure your OpenClaw / MyClaw cloud agent and OAuth connections |
| `/tools` | Directory of every integrated platform with links and connection status |

## Tech stack

- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript
- **Styling**: Tailwind CSS 4
- **Auth**: Clerk v7 (MFA capable)
- **Secrets**: Doppler (zero .env files)
- **AI — strategic**: Claude Opus 4.6 (swarm planning, goal decomposition)
- **AI — execution**: Claude Sonnet 4.6 (default agent, content scoring)
- **AI — fast**: Claude Haiku 4.5 (revision loops, cheap tasks)
- **AI SDK**: Vercel AI SDK 6 + @ai-sdk/anthropic
- **Agent execution**: OpenClaw / MyClaw cloud instance (Claude Pro subscription)
- **Swarm orchestration**: Custom Ruflo-inspired multi-agent system (Queen hierarchy, Q-Learning router, Raft/BFT/Gossip consensus)
- **Content engine**: Tribe v2 — 12 neuro-engagement principles, 8 formats, 5 tone profiles, iterative scoring + A/B variants
- **Database**: Supabase (PostgreSQL + Realtime)
- **Storage**: Cloudflare R2 + Supabase Storage
- **Payments**: Stripe
- **Email**: Resend
- **Background jobs**: Inngest
- **Hosting**: Vercel (auto-deploy from `main`)
- **Code**: GitHub (`pinnacleadvisors/nexus`)

## Roadmap status

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Foundation (Next.js, Clerk, Doppler, Vercel) | ✅ Complete |
| 2 | Idea Forge (consulting chatbot, milestones, Gantt) | ✅ Complete |
| 3 | Operations Dashboard (KPIs, charts, agent table) | ✅ Complete |
| 4 | Kanban Board (dnd-kit, approve/reject flow) | ✅ Complete |
| 5 | OpenClaw integration + OAuth manager | ✅ Complete |
| 6 | Notion knowledge base | ✅ Complete |
| 7 | Supabase data layer (6 migrations, Realtime, RLS) | ✅ Complete |
| 8 | Token efficiency (sliding window, prompt caching, cost tracking) | ✅ Complete |
| 9 | Security hardening (MFA, AES-256, rate limiting, CSP, audit log) | ✅ Complete |
| 10 | 10 specialist agent capabilities | ✅ Complete |
| 11 | Multi-agent swarm orchestration (22 roles, Q-Learning, WASM) | ✅ Complete |
| 12 | Tribe v2 neuro-content engine (12 principles, scoring, A/B) | ✅ Complete |
| 13a | Consultant agent + tool research API (40+ tools, recommendation cards) | ✅ Complete |
| 13b | n8n workflow blueprint generator + 8 templates + webhook receiver | ✅ Complete |
| 13c | OpenClaw fallback bridge (API gap detection + hybrid routing) | ✅ Complete |
| 14 | 3D relational knowledge graph | ✅ Complete |
| 15 | Library layer + token efficiency (code, agents, prompts, skills; auto-extraction; token savings counter) | ✅ Complete |
| 16 | Organisation chart + agent hierarchy | ⬜ Planned |
| 17 | DeerFlow 2.0 integration (live web search, sandboxed code execution) | ⬜ Planned |
| 18 | Video generation pipeline (Kling, Runway, HeyGen, ElevenLabs) | ⬜ Planned |
| 19 | Self-development mode — Nexus builds Nexus via `/build` dev console + autonomous research loop | ⬜ Planned |
| 20 | Local-first memory engine — GitHub repo as free Notion replacement; optional Notion sync on revenue | ⬜ Planned |
| 21 | OSS-first stack — free alternatives for every paid tool; validated upgrades tied to revenue milestones | ⬜ Planned |
| 22 | Leiden community detection — replace Louvain in knowledge graph for stable, well-connected clusters | ⬜ Planned |

See [`ROADMAP.md`](./ROADMAP.md) for the full feature backlog, implementation status, and next steps.

## Design Principles

**Nexus builds Nexus** — Phase 19 turns the platform on itself. The `/build` dev console lets you describe a feature or paste an error; an agent plans it and dispatches to OpenClaw (Claude Code) which edits the actual repo. Start on MacBook 2019 locally; graduate to cloud when revenue justifies it.

**Own your stack until you can afford to delegate** — Phase 21 maps every paid tool to a free/OSS alternative. Clerk, Doppler, and n8n are already free-tier sufficient. Notion is replaced by a GitHub-backed memory repo (Phase 20). Video/voice tools swap to local OSS (Coqui TTS, SadTalker) until first revenue.

**Memory without subscriptions** — A private GitHub repo (`nexus-memory`) stores all agent outputs as Markdown files, versioned and searchable via the GitHub API. No Notion subscription required. Optional one-way sync to Notion when revenue validates the cost.

## Getting started locally

### Prerequisites
- Node.js 20+
- Doppler CLI (`brew install dopplerhq/cli/doppler`)
- Clerk account + app
- Anthropic API key (optional — OpenClaw takes priority)

### Setup

```bash
git clone https://github.com/pinnacleadvisors/nexus.git
cd nexus
npm install
```

Configure secrets in Doppler (or create a `.env.local` for local dev only):

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
ANTHROPIC_API_KEY=sk-ant-...          # optional fallback
```

Run the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploying

Push to `main` — Vercel auto-deploys. Ensure all environment variables are set in Vercel's dashboard (sourced from Doppler in production).

## Contributing / AI agents

See [`AGENTS.md`](./AGENTS.md) for code conventions, the client/server component boundary rules, and the pre-commit checklist that all contributors (human and AI) must follow.

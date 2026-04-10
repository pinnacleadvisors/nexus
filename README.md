# Nexus

An all-in-one platform to manage and automate one or multiple businesses. AI agents build, market, and maintain your ideas 24/7 — you monitor and approve work from anywhere via a secure dashboard.

## What it does

| Page | Description |
|------|-------------|
| `/forge` | Describe a business idea. A Claude consulting agent refines it, extracts milestones, builds a Gantt chart, and dispatches the project to your OpenClaw agent |
| `/dashboard` | Live view of cost vs revenue, agent performance, token usage, and KPIs |
| `/board` | Kanban board — see what agents are working on, approve or reject completed work |
| `/tools` | Directory of every integrated platform with links and connection status |
| `/tools/claw` | Configure your OpenClaw / MyClaw cloud agent and OAuth connections |

## Tech stack

- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript
- **Styling**: Tailwind CSS 4
- **Auth**: Clerk v7 (MFA capable)
- **AI**: Anthropic Claude Sonnet via Vercel AI SDK 6
- **Agent execution**: OpenClaw / MyClaw cloud instance
- **Secrets**: Doppler
- **Hosting**: Vercel (auto-deploy from `main`)
- **Code**: GitHub (`pinnacleadvisors/nexus`)

## Getting started locally

### Prerequisites
- Node.js 20+
- Doppler CLI (`brew install dopplerhq/cli/doppler`)
- Clerk account + app
- Anthropic API key

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
ANTHROPIC_API_KEY=sk-ant-...
```

Run the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploying

Push to `main` — Vercel auto-deploys. Ensure all environment variables are set in Vercel's dashboard (sourced from Doppler in production).

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md) for the full feature backlog, implementation status, and next steps.

## Contributing / AI agents

See [`AGENTS.md`](./AGENTS.md) for code conventions, the client/server component boundary rules, and the pre-commit checklist that all contributors (human and AI) must follow.

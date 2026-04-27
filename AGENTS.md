<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Nexus — Agent & Contributor Guidelines

## Project Overview
Nexus is an all-in-one business automation platform. AI agents (Claude, OpenClaw) build, market, and maintain business ideas autonomously. The owner monitors and approves work via a secure web dashboard.

See `ROADMAP.md` for the full feature backlog and implementation status.

## Stack Rules

### Next.js 16 (App Router)
- All pages live under `app/` using the App Router — no `pages/` directory
- Protected pages live under `app/(protected)/` — the route group is invisible in URLs
- Middleware is in `proxy.ts` (not `middleware.ts`) — do not rename it
- `'use client'` is required on any component that uses hooks, event handlers, or browser APIs
- `ssr: false` with `next/dynamic` is only valid inside Client Components (`'use client'`)

### Tailwind CSS 4
- Custom design tokens are declared in `app/globals.css` inside `@theme inline { }`
- No `tailwind.config.js` — Tailwind 4 is CSS-first
- Use `@import "tailwindcss"` as the first line of globals.css (already set)

### TypeScript
- All shared types live in `lib/types.ts` — add new interfaces there, not inline
- Run `npx tsc --noEmit` before every commit to catch type errors early

### Client / Server Component Boundary
- Any component with `onClick`, `onChange`, `onMouseEnter`, `useState`, `useEffect`, etc. needs `'use client'`
- Server Components cannot use `dynamic(..., { ssr: false })` — move to a Client Component
- recharts `ResponsiveContainer` uses `ResizeObserver` — always wrap in `dynamic(..., { ssr: false })` from within a Client Component

### AI SDK (Vercel AI SDK 6)
- `useChat` hook is in `@ai-sdk/react`, not `ai`
- `streamText`, `convertToModelMessages`, `DefaultChatTransport` are in `ai`
- API routes use: `streamText` → `result.toUIMessageStreamResponse()`
- Model: `anthropic('claude-sonnet-4-6')` via `@ai-sdk/anthropic`

### Icons (lucide-react)
- `Github` and `Trello` are removed in this version of lucide-react
- Use `GitBranch` instead of `Github`
- Use `Kanban` instead of `Trello`
- Always verify icon names with: `node -e "const l=require('./node_modules/lucide-react'); console.log('IconName' in l)"`

### Access Control — Adding Yourself as Owner

Nexus is a single-owner platform. Follow these steps the **first time** you access the live deployment:

**Step 1 — Create your Clerk account**
1. Open the deployed Vercel URL (e.g. `https://nexus-xxx.vercel.app`)
2. Sign up with your email (or Google/GitHub OAuth) on the sign-in page
3. Complete email verification if prompted

**Step 2 — Get your Clerk User ID**
1. Go to [clerk.com](https://clerk.com) → sign in → open your Nexus app
2. Navigate to **Users** in the left sidebar
3. Click your user → copy the **User ID** (format: `user_xxxxxxxxxxxxxxxxxxxxxxxx`)

**Step 2.5 — Verify bot protection is ON**
Clerk uses Cloudflare Turnstile for bot protection. The app's CSP (`next.config.ts`) already allows `challenges.cloudflare.com` so the CAPTCHA loads correctly. No action needed — keep bot protection enabled:
1. Clerk Dashboard → **Configure** → **Attack protection**
2. **Bot sign-up protection** should be **ON** (leave it enabled)

**Step 3 — Lock the platform to yourself**
1. In Doppler (or Vercel environment variables), add:
   ```
   ALLOWED_USER_IDS=user_xxxxxxxxxxxxxxxxxxxxxxxx
   ```
2. Also in Clerk Dashboard → **User & Authentication** → **Restrictions**:
   - Enable **"Block sign-ups"** — prevents anyone new from creating an account
   - (Optional) Add your email to the **Allowlist** for extra safety
3. Redeploy (Vercel auto-deploys on Doppler push, or trigger manually)

**How the guard works:** `proxy.ts` reads `ALLOWED_USER_IDS` (comma-separated for future team members). Any authenticated Clerk session whose user ID is not in the list is immediately redirected to the sign-in page. If `ALLOWED_USER_IDS` is unset, all authenticated users are allowed (useful pre-setup).

**To add a team member later:** append their Clerk user ID: `ALLOWED_USER_IDS=user_yours,user_theirs`

### Secrets
- All secrets managed via Doppler — never hardcode or commit `.env` files
- Required env vars: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- Access control: `ALLOWED_USER_IDS` — comma-separated Clerk user IDs; if set, only these users can access protected routes
- Optional env vars: `CLAUDE_CODE_GATEWAY_URL` + `CLAUDE_CODE_BEARER_TOKEN` (**primary** — self-hosted Claude Code on Hostinger+Coolify, drains the 20x Max plan; see `services/claude-gateway/`), `OPENCLAW_GATEWAY_URL` + `OPENCLAW_BEARER_TOKEN` (legacy fallback), `ANTHROPIC_API_KEY` (final fallback), `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (database), `SUPABASE_SERVICE_ROLE_KEY` (server writes), `STRIPE_WEBHOOK_SECRET` (revenue), `RESEND_API_KEY` (email alerts), `SENTRY_DSN` (error tracking)
- Phase 17 env vars: `TAVILY_API_KEY` (live web search — add first, works without DeerFlow), `DEERFLOW_BASE_URL` + `DEERFLOW_API_KEY` + `DEERFLOW_ENABLED` (DeerFlow 2.0 sidecar)
- Phase 18 env vars: `KLING_API_KEY` (cinematic video), `RUNWAY_API_KEY` (stylised video), `ELEVENLABS_API_KEY` (voiceover), `HEYGEN_API_KEY` (UGC/avatar), `DID_API_KEY` (talking-head fallback), `MUAPI_AI_KEY` (scene images), `SUNO_API_KEY` or `UDIO_API_KEY` (background music)
- Phase 20 env vars: `MEMORY_TOKEN` (PAT with repo scope), `MEMORY_REPO` (e.g. `pinnacleadvisors/nexus-memory`)
- n8n Strategist env vars: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` (set to `1` by `/api/claude-session/dispatch` when a step opts into swarm mode — required for Claude Code Agent Teams to spawn sub-agents)
- AI priority in `/api/chat`: Claude Code gateway (self-hosted on Hostinger+Coolify, plan-billed via 20x Max — see `services/claude-gateway/`) → OpenClaw (Claude Pro subscription, legacy fallback) → `ANTHROPIC_API_KEY` → helpful error message
- OpenClaw config stored in cookies via `/api/claw/config` — migrate to encrypted DB before production

## File Structure
```
app/
├── (protected)/          # All authenticated pages
│   ├── layout.tsx        # Sidebar shell
│   ├── forge/            # Idea curation chatbot
│   ├── dashboard/        # Operations dashboard
│   ├── board/            # Kanban board
│   └── tools/            # Tools directory + OpenClaw config
├── api/
│   ├── chat/             # Streaming Claude chat endpoint
│   ├── claw/             # OpenClaw proxy API
│   └── oauth/            # OAuth flow (provider, callback, disconnect, status)
├── layout.tsx            # Root layout (ClerkProvider)
├── page.tsx              # Sign-in page
└── globals.css           # Tailwind + design tokens

components/
├── layout/               # Sidebar
├── forge/                # ChatMessages, MilestoneTimeline, GanttChart, ForgeActionBar
├── dashboard/            # KpiGrid, RevenueChart, AgentTable
├── board/                # KanbanColumn, KanbanCard, ReviewModal
└── tools/                # ToolsGrid, ToolCard

lib/
├── types.ts              # All TypeScript interfaces
├── mock-data.ts          # Seed data (replace with Supabase queries)
├── oauth-providers.ts    # OAuth provider config
└── utils.ts              # cn() helper
```

## Platform Memory — Local Knowledge Base

Platform knowledge lives in `memory/` inside this repo — chunked by concern, dense summaries, no API calls needed.

```
memory/
├── INDEX.md          ← START HERE — topic→file map
├── GRAPH.md          ← file dependency edges
├── platform/
│   ├── STACK.md      ← ALL dev rules (Next.js 16, Tailwind 4, Clerk, AI SDK 6, icons)
│   ├── ARCHITECTURE.md ← file structure, API patterns, DB access
│   ├── SECRETS.md    ← every env var by phase
│   └── OVERVIEW.md   ← what Nexus is, all pages, design principles
└── roadmap/
    ├── SUMMARY.md    ← one-liner per phase (1–22) with ✅/⬜ status (~300 tokens)
    └── PENDING.md    ← all ⬜ not-started items grouped by phase
```

**Query flow:** Read `memory/INDEX.md` first → read only the 1–2 files it points to. Saves 10× tokens vs scanning source docs.

**Keeping it current:** After a feature ships, edit `memory/roadmap/SUMMARY.md` and `PENDING.md` directly — no scripts or API calls needed.

> Note: `pinnacleadvisors/nexus-memory` (the GitHub repo) is the **runtime agent memory** for storing business outputs (research, content, financials). It is separate from this local platform documentation. See `lib/memory/github.ts` and Phase 20 in `ROADMAP.md`.

## Claude Code Managed Agents

Specialist subagents in `.claude/agents/` — Claude Code auto-discovers and delegates to these:

| Agent | File | Use when |
|-------|------|----------|
| **Nexus Memory** | `.claude/agents/nexus-memory.md` | Looking up platform context, reading/writing nexus-memory |
| **Nexus Architect** | `.claude/agents/nexus-architect.md` | Designing new pages/APIs, enforcing stack rules |
| **Nexus Tester** | `.claude/agents/nexus-tester.md` | Pre-commit TypeScript checks, validating component boundaries |
| **Agent Generator** | `.claude/agents/agent-generator.md` | User says "create an agent that…"; emits spec + DB row + memory records |
| **Firecrawl** | `.claude/agents/firecrawl.md` | Any agent needs web scrape / crawl / search |
| **Supermemory** | `.claude/agents/supermemory.md` | Every agent calls this after a run to record changes + promote facts |
| **Workflow Optimizer** | `.claude/agents/workflow-optimizer.md` | Review-node feedback triggers a minimal diff to the producing agent |
| **n8n Strategist** | `.claude/agents/n8n-strategist.md` | Designing an n8n workflow for an idea card (build or maintain). Classifies each step — managed agent? swarm? asset-gated review? — and emits importable JSON. |
| **Doppler Broker** | `.claude/agents/doppler-broker.md` | Mid-session secret-gated action. Parent supplies a `secret` name + `command`; broker fetches via `/api/composio/doppler`, runs the command with the secret in env, returns scrubbed output. The secret value never enters the parent's context. See ADR 001. |

These agents are spawned automatically by Claude Code when tasks match their description. They share the Doppler-injected environment and have access to the tools listed in their frontmatter.

### n8n workflow generation

`POST /api/n8n/generate` uses the **n8n Strategist** rules. Per step it decides:

- **Managed agent vs plain capability** — specialist verbs ("design", "write", "research", "refactor") → session-dispatch node (`/api/claude-session/dispatch`). Simple data-shaping / provider calls stay on `/api/agent` or direct provider nodes.
- **Swarm mode** — when a step clearly decomposes into ≥3 independent sub-tasks ("build the full site", "launch a product across landing+video+ad+email") the dispatch carries `swarm: true`; `/api/claude-session/dispatch` then injects `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` into the session env so the lead agent can spawn a team with a shared task list.
- **Review nodes** — placed ONLY after asset-producing steps (website, image, video, app, ad, landing page, email, blog/content, product listing) plus a final launch/publish gate. The old "every 3 steps" cadence is gone.

`/api/claude-session/dispatch` auto-creates the `.claude/agents/<slug>.md` spec when `autoCreateAgent: true` (the default from the Strategist) and upserts it into `agent_library` so the agent survives across sessions.

### Agent generation protocol

When the user says "create an agent that…" (or any paraphrase), follow `docs/agents/GENERATION_PROTOCOL.md`:

1. Delegate to the `agent-generator` managed agent.
2. It emits a `.claude/agents/<slug>.md` spec, upserts an `agent_library` row via `POST /api/agents`, seeds molecular memory with an entity + atoms + MOC linkage, and updates `memory/platform/SECRETS.md` if new env vars are introduced.
3. Runs the transferability checklist so the agent is reusable outside Claude.

### Review-node feedback loop

The Board review modal (`components/board/ReviewModal.tsx`) has a "Quality feedback" disclosure that POSTs to `/api/workflow-feedback`. The `workflow-optimizer` agent reads `open` rows, proposes a minimal diff against the producing agent's spec, and logs the change to `workflow_changelog` after the edit lands.

### Pre-commit Checklist
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] All interactive components have `'use client'`
- [ ] No browser globals (`window`, `document`) in Server Components
- [ ] Icons verified to exist in lucide-react
- [ ] No secrets committed (check with `git diff --staged`)
- [ ] `ROADMAP.md` updated if a feature was completed or added


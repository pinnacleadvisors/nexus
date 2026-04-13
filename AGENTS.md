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

### Secrets
- All secrets managed via Doppler — never hardcode or commit `.env` files
- Required env vars: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- Optional env vars: `ANTHROPIC_API_KEY` (fallback AI), `OPENCLAW_GATEWAY_URL` + `OPENCLAW_BEARER_TOKEN` (primary AI via Claude Code CLI), `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (database), `SUPABASE_SERVICE_ROLE_KEY` (server writes), `STRIPE_WEBHOOK_SECRET` (revenue), `RESEND_API_KEY` (email alerts), `SENTRY_DSN` (error tracking)
- Phase 17 env vars: `TAVILY_API_KEY` (live web search — add first, works without DeerFlow), `DEERFLOW_BASE_URL` + `DEERFLOW_API_KEY` + `DEERFLOW_ENABLED` (DeerFlow 2.0 sidecar)
- Phase 18 env vars: `KLING_API_KEY` (cinematic video), `RUNWAY_API_KEY` (stylised video), `ELEVENLABS_API_KEY` (voiceover), `HEYGEN_API_KEY` (UGC/avatar), `DID_API_KEY` (talking-head fallback), `MUAPI_AI_KEY` (scene images), `SUNO_API_KEY` or `UDIO_API_KEY` (background music)
- AI priority in `/api/chat`: OpenClaw (Claude Pro subscription) → `ANTHROPIC_API_KEY` → helpful error message
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

## Pre-commit Checklist
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] All interactive components have `'use client'`
- [ ] No browser globals (`window`, `document`) in Server Components
- [ ] Icons verified to exist in lucide-react
- [ ] No secrets committed (check with `git diff --staged`)
- [ ] `ROADMAP.md` updated if a feature was completed or added


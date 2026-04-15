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

**Step 2.5 — Disable bot protection (do this BEFORE signing up)**
Clerk's bot-protection CAPTCHA (Cloudflare Turnstile) can block Google OAuth sign-up. Disable it for your app:
1. Clerk Dashboard → **Configure** → **Attack protection**
2. Under **Bot sign-up protection** → toggle **OFF**

> The CSP in `next.config.ts` already allows `challenges.cloudflare.com` as a fallback, but disabling bot protection is simpler and appropriate for a private single-owner app.

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
- Optional env vars: `ANTHROPIC_API_KEY` (fallback AI), `OPENCLAW_GATEWAY_URL` + `OPENCLAW_BEARER_TOKEN` (primary AI via Claude Code CLI), `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (database), `SUPABASE_SERVICE_ROLE_KEY` (server writes), `STRIPE_WEBHOOK_SECRET` (revenue), `RESEND_API_KEY` (email alerts), `SENTRY_DSN` (error tracking)
- Phase 17 env vars: `TAVILY_API_KEY` (live web search — add first, works without DeerFlow), `DEERFLOW_BASE_URL` + `DEERFLOW_API_KEY` + `DEERFLOW_ENABLED` (DeerFlow 2.0 sidecar)
- Phase 18 env vars: `KLING_API_KEY` (cinematic video), `RUNWAY_API_KEY` (stylised video), `ELEVENLABS_API_KEY` (voiceover), `HEYGEN_API_KEY` (UGC/avatar), `DID_API_KEY` (talking-head fallback), `MUAPI_AI_KEY` (scene images), `SUNO_API_KEY` or `UDIO_API_KEY` (background music)
- Phase 20 env vars: `GITHUB_MEMORY_TOKEN` (PAT with repo scope), `GITHUB_MEMORY_REPO` (e.g. `pinnacleadvisors/nexus-memory`)
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


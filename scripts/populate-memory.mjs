#!/usr/bin/env node
/**
 * scripts/populate-memory.mjs
 *
 * Populates pinnacleadvisors/nexus-memory with structured, query-optimised
 * knowledge — inspired by Graphify's 71x token reduction (chunked by concern,
 * precomputed relationships, dense summaries) and GitNexus's precomputed
 * relational intelligence (explicit edge map, single-call navigation).
 *
 * Usage:
 *   doppler run -- node scripts/populate-memory.mjs
 *
 * Requires: GITHUB_MEMORY_TOKEN, GITHUB_MEMORY_REPO
 */

import { readFile, readdir, unlink } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const REPO  = process.env.GITHUB_MEMORY_REPO
const TOKEN = process.env.GITHUB_MEMORY_TOKEN
const BASE  = 'https://api.github.com'

if (!REPO || !TOKEN) {
  console.error('❌  GITHUB_MEMORY_REPO and GITHUB_MEMORY_TOKEN must be set')
  console.error('    Run: doppler run -- node scripts/populate-memory.mjs')
  process.exit(1)
}

function ghHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'nexus-memory-populate/1.0',
  }
}

async function writePage(path, content, message) {
  const url = `${BASE}/repos/${REPO}/contents/${encodeURIComponent(path)}`
  let sha
  try {
    const r = await fetch(url, { headers: ghHeaders() })
    if (r.ok) sha = (await r.json()).sha
  } catch {}

  const body = { message: message ?? `populate: ${path}`, content: Buffer.from(content, 'utf-8').toString('base64') }
  if (sha) body.sha = sha

  const res = await fetch(url, { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`writePage(${path}) failed ${res.status}: ${err.slice(0, 200)}`)
  }
  return res.json()
}

async function readPageContent(path) {
  const url = `${BASE}/repos/${REPO}/contents/${encodeURIComponent(path)}`
  const r = await fetch(url, { headers: ghHeaders() })
  if (!r.ok) return null
  const data = await r.json()
  if (data.encoding === 'base64') {
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8')
  }
  return data.content
}

async function appendPage(path, text, message) {
  const existing = await readPageContent(path)
  const newContent = existing
    ? `${existing.trimEnd()}\n\n${text}`
    : text
  return writePage(path, newContent, message)
}

/** Parse YAML frontmatter from a markdown string. Returns { meta, body }. */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/m)
  if (!match) return { meta: {}, body: raw }
  const meta = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const val = line.slice(colonIdx + 1).trim()
    if (key) meta[key] = val
  }
  return { meta, body: match[2] }
}

/** Process all pending files in memory-queue/ */
async function processQueue() {
  const queueDir = join(ROOT, 'memory-queue')
  let entries
  try {
    entries = await readdir(queueDir)
  } catch {
    return { processed: 0, failed: 0 }
  }

  const files = entries.filter(f => f.endsWith('.md') && f !== 'README.md')
  if (files.length === 0) return { processed: 0, failed: 0 }

  console.log(`\n📬  Processing ${files.length} queued file(s)…\n`)
  let processed = 0
  let failed = 0

  for (const file of files) {
    const filePath = join(queueDir, file)
    process.stdout.write(`    ⏳  queue/${file} → `)
    try {
      const raw = await readFile(filePath, 'utf-8')
      const { meta, body } = parseFrontmatter(raw)

      const { memory_path, memory_mode } = meta
      if (!memory_path) throw new Error('missing memory_path in frontmatter')
      if (memory_mode !== 'write' && memory_mode !== 'append') {
        throw new Error(`invalid memory_mode "${memory_mode}" — must be "write" or "append"`)
      }

      process.stdout.write(`${memory_path} (${memory_mode}) … `)

      if (memory_mode === 'append') {
        await appendPage(memory_path, body.trim(), `queue: append to ${memory_path}`)
      } else {
        await writePage(memory_path, body.trim(), `queue: write ${memory_path}`)
      }

      // Delete file to mark as processed
      await unlink(filePath)
      console.log('✅')
      processed++
    } catch (err) {
      console.log('❌')
      console.error(`       Error: ${err.message}`)
      failed++
    }

    await new Promise(r => setTimeout(r, 300))
  }

  return { processed, failed }
}

// ── Content ───────────────────────────────────────────────────────────────────

const pages = []

// We'll load raw MD files from disk and add inline content below
const rawAgents   = await readFile(join(ROOT, 'AGENTS.md'),  'utf-8')
const rawReadme   = await readFile(join(ROOT, 'README.md'),  'utf-8')
const rawRoadmap  = await readFile(join(ROOT, 'ROADMAP.md'), 'utf-8')
const rawClaude   = await readFile(join(ROOT, 'CLAUDE.md'),  'utf-8')


// ── meta/INDEX.md ─────────────────────────────────────────────────────────────
pages.push(['meta/INDEX.md', `# Nexus Memory — Master Index

> Graphify-style: query this file first, then fetch only the 1–2 files you need.
> Each file is chunked by concern so a single read gives complete context on its topic.

## File Map

| File | Topics | Token est. |
|------|--------|-----------|
| platform/STACK.md | next.js 16, tailwind 4, clerk v7, ai sdk 6, typescript rules, lucide icons, client/server boundary | ~800 |
| platform/ARCHITECTURE.md | file structure, app router, api routes, component patterns, middleware, db access | ~600 |
| platform/SECRETS.md | env vars, doppler, api keys, all phases, required vs optional | ~700 |
| platform/OVERVIEW.md | what nexus is, pages, tech stack, design principles | ~500 |
| roadmap/SUMMARY.md | phase 1–22 status, one-liner per phase | ~400 |
| roadmap/PENDING.md | all not-started items, planned features, next work | ~600 |
| docs/agents-guide.md | AGENTS.md — code conventions, pre-commit checklist, icon rules | ~900 |
| docs/readme.md | README.md — full project overview, getting started | ~800 |
| docs/roadmap-full.md | ROADMAP.md — complete roadmap with all phase details | ~5000 |
| meta/GRAPH.md | precomputed relationship edges between all knowledge nodes | ~300 |

## Topic → File Quick-Lookup

\`\`\`
stack rules / dev conventions        → platform/STACK.md + docs/agents-guide.md
file structure / where to put things → platform/ARCHITECTURE.md
env vars / secrets / api keys        → platform/SECRETS.md
what phases are done / planned       → roadmap/SUMMARY.md
what needs building next             → roadmap/PENDING.md
video pipeline (phase 18)            → roadmap/PENDING.md + platform/SECRETS.md
memory engine (phase 20)             → platform/ARCHITECTURE.md + platform/SECRETS.md
agent capabilities / tools           → platform/OVERVIEW.md + docs/readme.md
migrations / supabase schema         → docs/roadmap-full.md (Phase 7 section)
graph API / MCP / token reduction    → docs/roadmap-full.md (Phase 14 section)
library layer / code snippets        → docs/roadmap-full.md (Phase 15 section)
\`\`\`

## Relationship Graph (summary)

See meta/GRAPH.md for full edge list.
Key edges:
- platform/STACK.md → platform/ARCHITECTURE.md [implements]
- docs/agents-guide.md → platform/STACK.md [enforces]
- platform/SECRETS.md → roadmap/SUMMARY.md [required-by-phase]
- roadmap/SUMMARY.md → roadmap/PENDING.md [expands-incomplete-phases]

_Last populated: ${new Date().toISOString()}_
`])

// ── meta/GRAPH.md ─────────────────────────────────────────────────────────────
pages.push(['meta/GRAPH.md', `# Nexus Memory — Relationship Graph

> Precomputed relational intelligence (GitNexus pattern).
> Each edge is: SOURCE → TARGET [relation] — description

## Knowledge Edges

\`\`\`
docs/agents-guide.md     → platform/STACK.md          [enforces]       AGENTS.md codifies all stack rules
platform/STACK.md        → platform/ARCHITECTURE.md   [implements]     stack rules determine file/folder conventions
platform/ARCHITECTURE.md → platform/SECRETS.md        [requires]       architecture depends on specific env vars
platform/SECRETS.md      → roadmap/SUMMARY.md         [unlocks-phases] each env var set unlocks specific phases
roadmap/SUMMARY.md       → roadmap/PENDING.md         [expands]        summary points to pending items per phase
platform/OVERVIEW.md     → roadmap/SUMMARY.md         [references]     overview links to phase completion status
platform/OVERVIEW.md     → platform/ARCHITECTURE.md   [describes]      overview explains what each route/page does
docs/readme.md           → platform/OVERVIEW.md       [duplicates]     readme is source; overview is compressed form
docs/roadmap-full.md     → roadmap/SUMMARY.md         [source-of]      full roadmap is source; summary is extracted
\`\`\`

## Node Types

| Node | Count | Description |
|------|-------|-------------|
| platform/* | 4 | Dev rules, architecture, secrets, overview |
| roadmap/* | 2 | Phase status + pending work |
| docs/* | 3 | Raw source documents |
| meta/* | 2 | Index + this graph |

## Query Paths

**"How do I add a new page?"**
→ platform/ARCHITECTURE.md (file structure) + platform/STACK.md (client/server rules)

**"What env vars do I need for feature X?"**
→ platform/SECRETS.md

**"What's left to build?"**
→ roadmap/PENDING.md

**"What are the TypeScript/import rules?"**
→ platform/STACK.md + docs/agents-guide.md

_Last populated: ${new Date().toISOString()}_
`])

// ── platform/STACK.md ─────────────────────────────────────────────────────────
pages.push(['platform/STACK.md', `# Nexus — Stack Rules (Critical for Claude)

> RELATED: platform/ARCHITECTURE.md, docs/agents-guide.md
> All rules below are enforced — violations break builds or deployments.

## Next.js 16 (App Router)

- All pages under \`app/\` — NO \`pages/\` directory
- Protected pages under \`app/(protected)/\` — route group invisible in URLs
- Middleware is \`proxy.ts\` — NOT \`middleware.ts\` — do NOT rename
- \`'use client'\` required on any component using hooks, event handlers, browser APIs
- \`ssr: false\` with \`next/dynamic\` ONLY valid inside Client Components

## Tailwind CSS 4

- Custom tokens in \`app/globals.css\` inside \`@theme inline { }\`
- NO \`tailwind.config.js\` — Tailwind 4 is CSS-first
- First line of globals.css: \`@import "tailwindcss"\`

## TypeScript

- All shared types in \`lib/types.ts\` — add interfaces there, NOT inline
- Run \`npx tsc --noEmit\` before every commit
- Pre-existing errors exist in the codebase (missing @types/node, react) — do NOT fix unless asked

## Client / Server Component Boundary

- \`onClick\`, \`onChange\`, \`onMouseEnter\`, \`useState\`, \`useEffect\` → needs \`'use client'\`
- Server Components CANNOT use \`dynamic(..., { ssr: false })\`
- recharts \`ResponsiveContainer\` → always wrap in \`dynamic(..., { ssr: false })\` from a Client Component

## AI SDK (Vercel AI SDK 6)

- \`useChat\` hook → \`@ai-sdk/react\` (NOT \`ai\`)
- \`streamText\`, \`convertToModelMessages\`, \`DefaultChatTransport\` → \`ai\`
- API routes: \`streamText\` → \`result.toUIMessageStreamResponse()\`
- Model: \`anthropic('claude-sonnet-4-6')\` via \`@ai-sdk/anthropic\`

## Clerk v7

- Catch-all routing required: \`app/sign-in/[[...sign-in]]/page.tsx\`
- Props on components: \`fallbackRedirectUrl="/dashboard"\` — NOT \`afterSignInUrl\`
- ClerkProvider props: \`signInUrl="/sign-in" signUpUrl="/sign-up"\`
- Middleware in \`proxy.ts\` reads \`ALLOWED_USER_IDS\` env var for access control

## Icons (lucide-react)

- \`Github\` REMOVED → use \`GitBranch\`
- \`Trello\` REMOVED → use \`Kanban\`
- Always verify: \`node -e "const l=require('./node_modules/lucide-react'); console.log('IconName' in l)"\`

## Content Security Policy

- Defined in \`next.config.ts\`
- Cloudflare Turnstile (Clerk CAPTCHA): \`challenges.cloudflare.com\` in script-src, frame-src, connect-src
- Supabase: \`*.supabase.co\` + \`wss://*.supabase.co\`

## Models in Use

- Claude Opus 4.6 (\`claude-opus-4-6\`) — swarm planning, goal decomposition
- Claude Sonnet 4.6 (\`claude-sonnet-4-6\`) — default agent, content scoring
- Claude Haiku 4.5 (\`claude-haiku-4-5-20251001\`) — revision loops, cheap tasks

_Last populated: ${new Date().toISOString()}_
`])

// ── platform/ARCHITECTURE.md ─────────────────────────────────────────────────
pages.push(['platform/ARCHITECTURE.md', `# Nexus — Architecture & File Structure

> RELATED: platform/STACK.md, platform/SECRETS.md

## Directory Map

\`\`\`
app/
├── (protected)/          # Authenticated pages (Clerk guard via proxy.ts)
│   ├── layout.tsx        # Sidebar shell
│   ├── dashboard/        # KPI grid, revenue chart, agent table
│   ├── dashboard/org/    # Organisation chart (agent hierarchy)
│   ├── forge/            # Idea Forge chatbot + milestones + Gantt
│   ├── board/            # Kanban board (dnd-kit)
│   ├── swarm/            # Multi-agent swarm launcher
│   ├── graph/            # 3D knowledge graph (react-three-fiber)
│   ├── build/            # Dev Console (Phase 19a)
│   └── tools/
│       ├── agents/       # 10 specialist agent capabilities
│       ├── content/      # Tribe v2 neuro-content engine
│       ├── library/      # Code/agent/prompt/skill library (Phase 15)
│       ├── memory/       # nexus-memory file browser (Phase 20)
│       ├── n8n/          # n8n workflow hub
│       └── claw/         # OpenClaw config
├── api/
│   ├── agent/            # POST — streaming agent run
│   ├── chat/             # POST — streaming Claude chat (Forge)
│   ├── content/          # generate / score / variants
│   ├── graph/            # full / node/:id / path / query / context / mcp
│   ├── library/          # CRUD for library items
│   ├── memory/           # read/write/search/list nexus-memory
│   ├── video/            # generate + [jobId] SSE polling
│   ├── build/            # dispatch + filetree
│   ├── swarm/            # swarm orchestration
│   ├── claw/             # OpenClaw proxy
│   ├── webhooks/         # stripe + claw
│   └── oauth/            # provider / callback / disconnect / status
├── sign-in/[[...sign-in]]/page.tsx   # Clerk catch-all (REQUIRED for OAuth)
├── sign-up/[[...sign-up]]/page.tsx
├── layout.tsx            # Root layout (ClerkProvider)
├── page.tsx              # Redirects: auth→/dashboard, anon→/sign-in
└── globals.css           # Tailwind + @theme design tokens

components/
├── layout/               # Sidebar
├── forge/                # ChatMessages, MilestoneTimeline, GanttChart, ForgeActionBar
├── dashboard/            # KpiGrid, RevenueChart, AgentTable
├── board/                # KanbanColumn, KanbanCard, ReviewModal
├── graph/                # GraphScene (Three.js)
└── tools/                # ToolsGrid, ToolCard

lib/
├── types.ts              # ALL shared TypeScript interfaces
├── mock-data.ts          # Seed data (replace with Supabase queries)
├── utils.ts              # cn() helper
├── database.types.ts     # Supabase table types (hand-maintained — update with new tables)
├── schema.sql            # Reference schema (not run by migrate.mjs)
├── graph/                # builder.ts, types.ts
├── memory/               # github.ts — nexus-memory client
├── audio/                # elevenlabs.ts (Phase 18b)
├── video/                # kling.ts, runway.ts (Phase 18a)
├── agent-capabilities.ts # All 10+ agent capability definitions
├── neuro-content/        # Tribe v2 — principles, templates, tones, types
└── oauth-providers.ts

proxy.ts                  # Clerk middleware (NOT middleware.ts)
next.config.ts            # CSP headers, Next.js config
\`\`\`

## Key Patterns

### API Route Pattern
\`\`\`ts
// app/api/example/route.ts
export const runtime = 'nodejs'
export async function POST(req: NextRequest) { ... }
\`\`\`

### Streaming Agent Response
\`\`\`ts
const result = streamText({ model: anthropic('claude-sonnet-4-6'), ... })
return result.toUIMessageStreamResponse()
\`\`\`

### Database Access
- Server: \`import { createClient } from '@supabase/supabase-js'\` with service role key
- Always use service role key server-side; anon key client-side only

### Adding a New Migration
1. Create \`supabase/migrations/NNN_description.sql\`
2. Update \`lib/database.types.ts\` with new table types (critical for TS build)
3. Add row to ROADMAP.md SQL Migrations table
4. Run \`npm run migrate\`

_Last populated: ${new Date().toISOString()}_
`])

// ── platform/SECRETS.md ───────────────────────────────────────────────────────
pages.push(['platform/SECRETS.md', `# Nexus — Environment Variables

> RELATED: platform/ARCHITECTURE.md, roadmap/SUMMARY.md
> All secrets managed via Doppler. Never commit .env files.

## Required (Core)

| Var | Description | Where to get |
|-----|-------------|--------------|
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | Clerk public key | Clerk Dashboard → API Keys |
| CLERK_SECRET_KEY | Clerk secret key | Clerk Dashboard → API Keys |
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL | Project Settings → API |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon key | Project Settings → API |
| SUPABASE_SERVICE_ROLE_KEY | Supabase service role (server writes) | Project Settings → API |
| SUPABASE_PROJECT_REF | For migrations CLI | Project Settings → General |
| SUPABASE_ACCESS_TOKEN | For migrations CLI | supabase.com/account/tokens |

## Access Control

| Var | Description |
|-----|-------------|
| ALLOWED_USER_IDS | Comma-separated Clerk user IDs; if set, only these users can access protected routes |

## AI / Agents (Optional)

| Var | Description | Phase |
|-----|-------------|-------|
| ANTHROPIC_API_KEY | Claude API fallback (OpenClaw takes priority) | 1 |
| OPENCLAW_GATEWAY_URL | MyClaw instance base URL | 5 |
| OPENCLAW_BEARER_TOKEN | Bearer token (overrides cookie config) | 5 |

## Research / Search

| Var | Description | Phase |
|-----|-------------|-------|
| TAVILY_API_KEY | Live web search — injected into research/SEO/swarm agents | 17c |
| DEERFLOW_BASE_URL | DeerFlow 2.0 sidecar URL | 17a |
| DEERFLOW_API_KEY | DeerFlow auth | 17a |
| DEERFLOW_ENABLED | "true" to route research through DeerFlow | 17a |

## Memory Engine

| Var | Description | Phase |
|-----|-------------|-------|
| GITHUB_MEMORY_TOKEN | PAT with repo scope for nexus-memory | 20 |
| GITHUB_MEMORY_REPO | e.g. pinnacleadvisors/nexus-memory | 20 |

## Video Pipeline

| Var | Description | Phase |
|-----|-------------|-------|
| KLING_API_KEY | Kling 2.0 — cinematic/realistic video | 18a |
| RUNWAY_API_KEY | Runway Gen-4 — stylised video | 18a |
| ELEVENLABS_API_KEY | Voiceover generation | 18b |
| HEYGEN_API_KEY | UGC avatar video | 18c |
| DID_API_KEY | Talking-head fallback | 18c |
| MUAPI_AI_KEY | Scene image generation | 18d |
| SUNO_API_KEY | AI background music | 18b |

## Infrastructure

| Var | Description | Phase |
|-----|-------------|-------|
| STRIPE_WEBHOOK_SECRET | Stripe webhook endpoint secret | 1 |
| RESEND_API_KEY | Email alerts | 1 |
| SENTRY_DSN | Error tracking | 9 |
| INNGEST_EVENT_KEY | Background jobs | 13b |
| INNGEST_SIGNING_KEY | Background jobs | 13b |
| NEXT_PUBLIC_APP_URL | Your Vercel deployment URL | 13b |
| R2_ACCOUNT_ID | Cloudflare R2 storage | 1 |
| R2_ACCESS_KEY_ID | Cloudflare R2 | 1 |
| R2_SECRET_ACCESS_KEY | Cloudflare R2 | 1 |
| R2_BUCKET_NAME | e.g. nexus-assets | 1 |
| ENCRYPTION_KEY | AES-256 for sensitive data | 9 |

_Last populated: ${new Date().toISOString()}_
`])

// ── platform/OVERVIEW.md ──────────────────────────────────────────────────────
pages.push(['platform/OVERVIEW.md', `# Nexus — Platform Overview

> RELATED: roadmap/SUMMARY.md, platform/ARCHITECTURE.md
> Compressed overview — read this for "what is Nexus" context.

## What It Is

Nexus is an all-in-one business automation platform. AI agents (Claude Opus/Sonnet, OpenClaw) build, market, and maintain business ideas autonomously. The owner monitors and approves work via a secure web dashboard.

**Core loop:** Describe idea in Forge → AI extracts milestones → Agents execute → Review in Kanban → Revenue tracked in Dashboard.

## Pages & Capabilities

| Route | What it does |
|-------|-------------|
| /forge | Consulting agent refines idea, extracts milestones, builds Gantt, dispatches to swarm |
| /dashboard | Live cost vs revenue, agent performance, token usage, KPIs |
| /dashboard/org | Agent hierarchy (L0 User → L1 Queens → L2 Tactical → L3 Specialists → L4 Workers) |
| /board | Kanban — agents post work here; owner approves/rejects |
| /swarm | Launch multi-agent swarm (22 roles, Raft/BFT/Gossip consensus) |
| /graph | Live 3D knowledge graph — every entity as a node; 50–70× token reduction via context API |
| /tools/content | Tribe v2 — neuro-optimised content (12 principles, 8 formats, 5 tones, A/B variants) |
| /tools/agents | 10 specialist agents: research, SEO, financial, legal, email, social, code spec, video brief |
| /tools/library | Reusable building blocks — code snippets, agent templates, prompts, skills |
| /tools/memory | nexus-memory browser — file tree, markdown viewer, search, inline editor |
| /tools/n8n | 8 workflow blueprints + AI custom generator |
| /build | Dev Console — describe feature/bug → Claude Opus plans → OpenClaw executes on branch |

## Design Principles

1. **Nexus builds Nexus** — /build turns platform on itself for self-development
2. **Own your stack** — free/OSS alternatives for every paid tool until revenue justifies cost
3. **Memory without subscriptions** — nexus-memory GitHub repo replaces Notion (free, versioned)
4. **Token efficiency** — library layer prevents duplicate generation; graph API gives context in 1 call

## Agent Priority in /api/chat

OpenClaw (Claude Pro) → ANTHROPIC_API_KEY → helpful error message

_Last populated: ${new Date().toISOString()}_
`])

// ── roadmap/SUMMARY.md ────────────────────────────────────────────────────────
pages.push(['roadmap/SUMMARY.md', `# Nexus — Roadmap Summary

> RELATED: roadmap/PENDING.md (for ⬜ details), docs/roadmap-full.md (for full specs)
> One line per phase. ✅ = complete, ⬜ = not started, 🔧 = in progress.

| Phase | Name | Status | Key output |
|-------|------|--------|-----------|
| 1 | Foundation | ✅ | Next.js 16 + Clerk v7 + Tailwind 4 + Vercel deploy |
| 2 | Idea Forge | ✅ | Consulting chatbot, milestone extractor, Gantt chart |
| 3 | Dashboard | ✅ | KPI grid, revenue chart, agent table |
| 4 | Kanban Board | ✅ | dnd-kit drag & drop, approve/reject flow |
| 5 | OpenClaw Integration | ✅ | OAuth manager, MyClaw proxy, skill permissions |
| 6 | Knowledge Base | ✅ | Notion integration (replaced by Phase 20) |
| 7 | Backend / Data Layer | ✅ | Supabase + 9 migrations + Realtime + RLS |
| 8 | Token Efficiency | ✅ | Sliding window, prompt caching, cost tracking |
| 9 | Security Hardening | ✅ | MFA, AES-256, rate limiting, CSP, audit log |
| 10 | Agent Capabilities | ✅ | 10 specialist agents in lib/agent-capabilities.ts |
| 11 | Multi-Agent Swarm | ✅ | 22 roles, Q-Learning router, Raft/BFT/Gossip consensus |
| 12 | Tribe v2 Content Engine | ✅ | 12 neuro principles, 8 formats, 5 tones, scoring, A/B |
| 13a | Consultant Agent | ✅ | Tool research API, 40+ tools, recommendation cards |
| 13b | n8n Workflow Gen | ✅ | AI workflow generator, 8 blueprints, webhook receiver |
| 13c | OpenClaw Fallback Bridge | ✅ | API gap detection + hybrid routing |
| 14 | 3D Knowledge Graph | ✅ | react-three-fiber, Louvain clusters, PageRank, MCP tools |
| 15 | Library Layer | ✅ | Code/agent/prompt/skill store; auto-extraction; token savings counter |
| 16 | Org Chart / Hierarchy | ✅ | Tree + swimlane views, drill-down, live stats, 15s refresh |
| 17a | DeerFlow Deployment | ⬜ | Sandboxed code execution sidecar |
| 17b | DeerFlow Integration | ⬜ | Multi-hop research routing |
| 17c | Tavily Live Search | ✅ | Injected into research/SEO/consultant/swarm agents |
| 18a | Script-to-Video (Cinematic) | 🔧 | Kling 2.0 + Runway Gen-4 clients + API routes + video-brief agent |
| 18b | Voiceover & Audio | ⬜ | ElevenLabs + Suno background music |
| 18c | UGC / Talking Head | ⬜ | HeyGen + D-ID |
| 18d | Asset Management | ⬜ | R2 storage + Board card approval |
| 19a | Dev Console | ✅ | /build page, Claude Opus planner, OpenClaw dispatch |
| 19b | Research Loop | ✅ | Weekly Inngest cron, Tavily digest, suggestion cards |
| 20 | Memory Engine | ✅ | nexus-memory GitHub repo, lib/memory/github.ts, viewer UI |
| 21 | OSS Stack Audit | ⬜ | Free alternatives for every paid tool |
| 22 | Leiden Graph Upgrade | ⬜ | Replace Louvain with Leiden community detection |

_Last populated: ${new Date().toISOString()}_
`])

// ── roadmap/PENDING.md ────────────────────────────────────────────────────────
pages.push(['roadmap/PENDING.md', `# Nexus — Pending Work (All ⬜ Items)

> RELATED: roadmap/SUMMARY.md, platform/SECRETS.md
> Everything not yet started, grouped by phase. Start here for "what to build next."

## Phase 17a — DeerFlow Deployment
- Deploy DeerFlow 2.0 sidecar container (sandboxed Python execution)
- Needs: DEERFLOW_BASE_URL, DEERFLOW_API_KEY, DEERFLOW_ENABLED in Doppler

## Phase 17b — DeerFlow Integration
- lib/deerflow.ts: route multi-hop research queries through DeerFlow
- Fallback to Tavily if DeerFlow unavailable

## Phase 18a — Script-to-Video (partial, 🔧)
- ✅ lib/video/kling.ts — Kling 2.0 client
- ✅ lib/video/runway.ts — Runway Gen-4 client
- ✅ app/api/video/generate + [jobId] — job submission + SSE polling
- ✅ video-brief agent capability (lib/agent-capabilities.ts)
- ✅ Export to Video button on /tools/content (vsl-script format only)
- ⬜ Scene assembly — n8n workflow stitches clips via FFmpeg node

## Phase 18b — Voiceover & Audio
- lib/audio/elevenlabs.ts: generateVoiceover(script, voiceId) → MP3
- voice_profiles Supabase table
- lib/audio/suno.ts or udio.ts: generateTrack(mood, duration) → MP3
- n8n FFmpeg node: duck music -18dB under speech → mixed MP4
- Needs: ELEVENLABS_API_KEY, SUNO_API_KEY or UDIO_API_KEY

## Phase 18c — UGC / Talking Head
- lib/video/heygen.ts: generateUGC(script, avatarId) → video
- lib/video/did.ts: talkingHead(script, imageUrl) → video (fallback)
- Needs: HEYGEN_API_KEY, DID_API_KEY

## Phase 18d — Asset Management
- Upload final videos to Cloudflare R2
- Create Board card automatically on completion (links to video URL)
- Approval flow in Kanban → published to social/landing page
- Needs: MUAPI_AI_KEY (scene images)

## Phase 20 — Memory Engine (partial, 🔧)
- ✅ All core items complete
- ⬜ Notion sync (optional): when NOTION_TOKEN set, push to Notion after GitHub write

## Phase 21 — OSS Stack Audit
- Map every paid tool to free/OSS alternative
- Validated upgrade triggers tied to revenue milestones
- Key swaps: Clerk→Keycloak, Doppler→env files, n8n→open-source n8n self-host

## Phase 22 — Leiden Graph Upgrade
- Replace graphology-communities-louvain with Leiden algorithm
- Better stability and well-connected clusters
- Update lib/graph/builder.ts assignClusters()

## Global Pending Items
- Embed graph minimap in Forge sidebar (Phase 14b)
- ENCRYPTION_KEY security hardening (Phase 9)
- Sentry error tracking setup (Phase 9)
- Inngest background jobs setup (Phase 13b)
- OAuth apps registration (Google, GitHub, Slack, Notion)

_Last populated: ${new Date().toISOString()}_
`])

// ── docs/* — raw source files ─────────────────────────────────────────────────
pages.push(['docs/agents-guide.md',  rawAgents])
pages.push(['docs/readme.md',        rawReadme])
pages.push(['docs/roadmap-full.md',  rawRoadmap])
pages.push(['docs/claude-md.md',     rawClaude])

// ── Runner ────────────────────────────────────────────────────────────────────
async function main() {
  // ── Step 1: Process memory-queue/ pending files ──────────────────────────
  const { processed: qProcessed, failed: qFailed } = await processQueue()
  if (qProcessed > 0 || qFailed > 0) {
    console.log(`\n    Queue summary: ${qProcessed} written, ${qFailed} failed.\n`)
  }

  // ── Step 2: Write structured knowledge pages ─────────────────────────────
  console.log(`\n📚  Nexus Memory Populate`)
  console.log(`    Repo: ${REPO}`)
  console.log(`    Files: ${pages.length}\n`)

  let ok = 0
  let failed = 0

  for (const [path, content] of pages) {
    process.stdout.write(`    ⏳  ${path} … `)
    try {
      await writePage(path, content, `populate: ${path} [${new Date().toISOString().slice(0,10)}]`)
      console.log('✅')
      ok++
    } catch (err) {
      console.log('❌')
      console.error(`       ${err.message}`)
      failed++
    }

    // Rate-limit: GitHub Contents API is generous but let's be polite
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`\n✅  ${ok} written, ${failed} failed.\n`)
  if (failed > 0 || qFailed > 0) process.exit(1)
}

main().catch(err => {
  console.error('\n❌  Unexpected error:', err.message)
  process.exit(1)
})

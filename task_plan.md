# Agent Generation System

Goal: Stand up an end-to-end "generate, persist, remember, and self-improve" agent subsystem for Nexus.
Success criteria:
- When the user says "create an agent that does X" in Claude Code, Claude follows a documented protocol that emits a `.claude/agents/<slug>.md`, registers it in Supabase, and seeds molecular memory.
- Four new Claude managed agents exist and are discoverable: `firecrawl`, `supermemory`, `workflow-optimizer`, `agent-generator`.
- A Supabase migration adds `agent_library`, `workflow_feedback`, `workflow_changelog` tables with RLS.
- Board review modal exposes a feedback textarea that writes to `/api/workflow-feedback`, which hands off to the workflow-optimizer agent and records the change in `workflow_changelog`.
- Molecular memory has entity + atom notes for every new agent so they are reusable across projects.
- `npx tsc --noEmit` passes.

Hard constraints:
- Follow all Nexus stack rules in `AGENTS.md` / `memory/platform/STACK.md` (Next.js 16 App Router, `'use client'` boundary, Tailwind 4, types go in `lib/types.ts`, etc).
- No secrets committed. Any new env var lives only in Doppler and is documented in `memory/platform/SECRETS.md`.
- Branch: `claude/agent-generation-system-JA9xQ`.
- Claude managed agents must stay portable — the markdown file is the source of truth, any Claude-specific frontmatter is additive and falls back cleanly when consumed by another runtime.

## Phase 1 — Explore (findings)

- `.claude/agents/` currently has `nexus-architect`, `nexus-memory`, `nexus-tester`. Format = YAML frontmatter + body.
- `.claude/skills/molecularmemory_local/cli.mjs` provides `atom`, `entity`, `moc`, `graph`, `reindex`, `query` commands.
- `memory/molecular/` exists and is empty (just INDEX.md) — safe to seed.
- `lib/supabase.ts` exposes `supabase` + `createServerClient` with graceful null fallback.
- Existing migrations run through `010_ideas_and_automations.sql`. Next file = `011`.
- Existing RLS pattern = `user_id = request.jwt.claims->>'sub'`.
- `components/board/ReviewModal.tsx` is a client component with an existing revision textarea. Hook new `FeedbackBox` in beside the revision flow without regressing reject/approve.
- `lib/agent-capabilities.ts` already defines 10 runtime capabilities — the new `agent_library` table is for *managed agents* (Claude Code subagents), not a replacement.

## Phase 2 — Plan

### Task 1 — Agent generation protocol doc
- File: `docs/agents/GENERATION_PROTOCOL.md` (new)
- Change: describe trigger phrase, output artifacts (markdown + Supabase row + molecular entity + molecular atom), transferability rules.
- Verify: doc renders in plain markdown, cross-linked from `AGENTS.md`.
- Parallel: no (other tasks link to it).

### Task 2 — Claude managed agent: firecrawl
- File: `.claude/agents/firecrawl.md` (new)
- Change: wrap `lib/tools/firecrawl` + Firecrawl MCP guidance so subagent can scrape/map/crawl/search.
- Verify: frontmatter parses, agent name unique, tools listed.
- Parallel: yes.

### Task 3 — Claude managed agent: supermemory
- File: `.claude/agents/supermemory.md` (new)
- Change: agent wraps `/molecularmemory_local` CLI + writes runbook records to `memory/molecular/atoms/`.
- Verify: describes when other agents should hand off to it.
- Parallel: yes.

### Task 4 — Claude managed agent: workflow-optimizer
- File: `.claude/agents/workflow-optimizer.md` (new)
- Change: consumes feedback text, proposes workflow diffs, logs to `workflow_changelog`.
- Verify: lists inputs, outputs, acceptance criteria.
- Parallel: yes.

### Task 5 — Claude managed agent: agent-generator
- File: `.claude/agents/agent-generator.md` (new)
- Change: meta-agent that emits steps 1–4 of the generation protocol (markdown → DB → memory).
- Verify: references the protocol doc.
- Parallel: yes.

### Task 6 — Supabase migration 011
- File: `supabase/migrations/011_agent_library_and_feedback.sql` (new)
- Change: add `agent_library`, `workflow_feedback`, `workflow_changelog` tables + RLS.
- Verify: follows idempotent `create table if not exists` + `do $$` policy pattern.
- Parallel: yes.

### Task 7 — Types
- File: `lib/types.ts`
- Change: add `AgentDefinition`, `WorkflowFeedback`, `WorkflowChange`.
- Verify: `npx tsc --noEmit`.
- Parallel: no (used by Tasks 8–11).

### Task 8 — Agent registry helper
- File: `lib/agent-registry.ts` (new)
- Change: pure functions to read local markdown agents, parse frontmatter, diff against Supabase.
- Verify: compiles.
- Parallel: depends on Task 7.

### Task 9 — API route: /api/agents
- File: `app/api/agents/route.ts` (new)
- Change: GET list + POST register (upserts an AgentDefinition into `agent_library`).
- Verify: auth guard + returns JSON.
- Parallel: depends on Task 7 + 8.

### Task 10 — API route: /api/workflow-feedback
- File: `app/api/workflow-feedback/route.ts` (new)
- Change: POST accepts `{ cardId, feedback, agentId? }`, inserts into `workflow_feedback`, returns `{ok:true, changeId}`.
- Verify: auth + rate-limited.
- Parallel: depends on Task 7.

### Task 11 — FeedbackBox component
- File: `components/board/FeedbackBox.tsx` (new)
- Change: `'use client'` textarea + submit; posts to `/api/workflow-feedback`.
- Verify: no TypeScript errors, uses design tokens.
- Parallel: depends on Task 7.

### Task 12 — Wire FeedbackBox into ReviewModal
- File: `components/board/ReviewModal.tsx`
- Change: below "Reject" button add a "Quality feedback" disclosure that renders `<FeedbackBox/>`. Does not replace reject flow.
- Verify: manual path-through in dev.
- Parallel: depends on Task 11.

### Task 13 — Seed molecular memory
- File: `memory/molecular/entities/*.md`, `memory/molecular/atoms/*.md`, `memory/molecular/mocs/agent-library.md`
- Change: run `cli.mjs entity` + `atom` + `moc` for the 4 new agents so they're discoverable cross-project.
- Verify: `cli.mjs graph` reports nodes > 0, orphans small.
- Parallel: no (needs other files in place).

### Task 14 — Update SECRETS + AGENTS docs
- File: `memory/platform/SECRETS.md`, `AGENTS.md`
- Change: add `FIRECRAWL_API_KEY` note under new agents; add "Agent Generation Protocol" link.
- Verify: diff renders.
- Parallel: yes.

### Task 15 — Commit + push
- Verify: `npx tsc --noEmit` clean, then commit to `claude/agent-generation-system-JA9xQ` and push with `-u`.

## Phase 3 — Implement

Task order: 1 → (2,3,4,5,6,14 parallel groups where possible) → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 15.

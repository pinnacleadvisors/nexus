Goal: Restructure Nexus navigation + idea flow so users can capture an idea (remodel or from-description), review agent-generated analysis, and execute it into an n8n workflow.
Success criteria:
- Sidebar matches the new spec exactly: Idea, Idea Library, Automation Library, Dashboard, Manage Platform, Subfunctions dropdown (Board, Org Chart, Graph, Swarm, Consultant, Content), Reusable Library dropdown (Agents, Skills, Tools, Reusable code functions).
- `/forge` is renamed to `/idea`; `/build` is renamed to `/manage-platform`; old URLs redirect.
- `/idea` presents two mode options (Remodel idea / Idea from description) each with its own form.
- Submitting a form triggers an agent call that returns profitability, automation steps, approx revenue/cost, and an idea card saved into the Idea Library.
- Idea card shows fields per spec; "Execute" opens execute-input prompt and POSTs to `/api/n8n/generate`.
- Reusable Library entries point to existing tools/library for agents/skills/code + existing /tools page; tools directory unchanged.
- `npx tsc --noEmit` passes.
Hard constraints:
- Do not break existing Forge chat/session flow; move its page under `/idea` rather than deleting ForgeSession.
- Follow Next.js 16 + Tailwind 4 + Client/Server boundary rules from AGENTS.md.
- Icons limited to lucide-react exports (no `Github`, no `Trello`).
- All shared types go in `lib/types.ts`.

## Phase 1 — Explore (DONE)
- Sidebar = components/layout/Sidebar.tsx (flat list, no dropdowns yet).
- Forge page = app/(protected)/forge/page.tsx (ProjectSelectorBar + ForgeSession; localStorage-backed).
- Build page = app/(protected)/build/page.tsx ("Dev Console" — Phase 19a).
- n8n generate endpoint exists: /api/n8n/generate (POST {description, businessContext, templateId?, projectId?}).
- Library types + page exist: app/(protected)/tools/library/ — has tabs for code/agent/prompt/skill.

## Phase 2 — Plan (atomic tasks)

### Task 1 — Add Idea-related types to lib/types.ts
- File: lib/types.ts
- Change: add IdeaMode, IdeaStep, IdeaCard interfaces (revenue, cost, automation %, tools list).
- Verify: tsc compiles.
- Parallel: no

### Task 2 — Create /idea route that wraps existing Forge UI
- Files: app/(protected)/idea/page.tsx (new), app/(protected)/idea/_mode/*.tsx (new mode-picker + forms).
- Change: /idea shows the mode picker + forms; on submit calls a new `/api/idea/analyse` endpoint, then saves idea card into localStorage and routes to /idea-library. The old Forge chat is still reachable via query param (?chat=1).
- Verify: navigate to /idea, pick a mode, submit form, see loading → redirect to library.
- Parallel: no

### Task 3 — Create /api/idea/analyse endpoint
- File: app/api/idea/analyse/route.ts (new)
- Change: accepts {mode, description?, inspirationUrl?, twist?, setupBudget?} → uses anthropic('claude-sonnet-4-6') to return IdeaCard fields.
- Verify: POST from form produces card JSON.
- Parallel: yes

### Task 4 — Idea Library page + IdeaCard component
- Files: app/(protected)/idea-library/page.tsx (new), components/idea/IdeaCard.tsx (new).
- Change: reads ideas from localStorage, renders cards per spec. Execute button opens a prompt modal → POST /api/n8n/generate with description + execute-input.
- Verify: cards persist and execute opens a modal.
- Parallel: yes

### Task 5 — Automation Library page
- File: app/(protected)/automation-library/page.tsx (new)
- Change: lists generated n8n workflows stored in localStorage (key `nexus:automations`).
- Verify: after execute, saved workflow appears on this page with download JSON button.
- Parallel: yes

### Task 6 — Rename /build → /manage-platform
- File: app/(protected)/manage-platform/page.tsx (new, re-exports build/page.tsx content); app/(protected)/build/page.tsx → redirect.
- Change: move page content; keep old path functional via `redirect('/manage-platform')`.
- Parallel: no

### Task 7 — Update Sidebar
- File: components/layout/Sidebar.tsx
- Change: replace flat array with nested structure. Add expandable group support (Subfunctions, Reusable Library).
- Verify: all links resolve to existing routes; active state still works.
- Parallel: no

### Task 8 — Reusable Library: add /tools/code alias
- Files: app/(protected)/tools/code/page.tsx (new — re-exports library/page.tsx filtered to code).
- Change: sidebar link for "Reusable code functions" targets /tools/code.
- Parallel: yes

### Task 9 — Old /forge redirect
- File: app/(protected)/forge/page.tsx replaced with redirect('/idea').

### Task 10 — Tests + commit
- `npx tsc --noEmit`; fix any type errors; commit; push.

## Phase 3 — Implement (in order)
Tasks 1 → 2/3/4/5 (parallel-safe within their file boundaries) → 6 → 7 → 8 → 9 → 10.

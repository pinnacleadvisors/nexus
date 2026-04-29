# Memory Architecture — Global Access + Multi-Tool Writers

Goal: Make `~/.claude/CLAUDE.md` the single source of cross-repo protocols, lift the molecular knowledge graph to a central GitHub repo (with optional Supabase read cache), and expose one universal write surface so OpenClaw, Claude managed agents, n8n, and external webhooks can all contribute facts without per-tool boilerplate.

Success criteria:
- A new Claude Code session in *any* repo loads the long-horizon protocol, skill routing, and memory protocol from `~/.claude/CLAUDE.md` automatically. Per-repo `CLAUDE.md` shrinks to project-specific stack rules + file structure.
- `cli.mjs --backend=github` reads/writes atoms, entities, MOCs, sources, and synthesis directly to a dedicated GitHub repo (`pinnacleadvisors/memory-hq` — private, multi-AI-model hub) with no local clone required. Local mode stays as an offline cache.
- `POST /api/memory/event` accepts `{type, source, scope, payload, locators?, trace_id}` from any caller authed with `MEMORY_HQ_TOKEN` (a fresh narrow-scope PAT, separate from the Phase 20 `MEMORY_TOKEN`). Behind it: GitHub write → optional Supabase mirror → audit log. OpenClaw + n8n + managed agents all use this same endpoint.
- **Cross-scope addressing**: every atom/entity carries a structured `scope: {repo?, business_slug?, namespace?}` so the same title (e.g. "Onboarding checklist") can exist independently across repos/businesses. Files live at `<kind>/<scope-id>/<slug>.md`. Every fact also carries `locators: [{kind, ...}]` — an array of structured asset pointers (kinds: `github`, `r2`, `s3`, `url`, `youtube`, `vercel-blob`, `local`) so an agent can fetch the underlying image, video, PDF, or source file from wherever it actually lives. Resolved by `lib/memory/locator.ts`.
- Generated files (`INDEX.md`, `.graph.json`) are owned only by `POST /api/cron/rebuild-graph`; no client process touches them. `log.md` is replaced by `log/<iso>-<slug>.md` (file-per-event).
- Optional Supabase mirror (atoms/entities/mocs/sources/synthesis tables + pgvector) is updated by a GitHub webhook → `/api/cron/sync-memory`. All read/query traffic shifts to Supabase; GitHub is touched only on writes.
- Optional `mcp-memory` server exposes `memory_atom`, `memory_entity`, `memory_query`, `memory_search` to any Claude Code session in any repo.
- Write Size Discipline hook (`.claude/hooks/check-write-size.sh`) is in place — every implementation task below fits one Write/Edit call under 300 lines.

Hard constraints:
- Markdown stays the source of truth. Supabase is a derived read cache — if it ever drifts, replay from GitHub.
- One file per atom/entity/MOC. Never coalesce. Two writers on different items must never collide.
- Every write stamps `frontmatter.author: <source>` (e.g. `claude-agent:nexus-architect`, `openclaw:research`, `n8n:idea-builder`). Provenance is non-negotiable.
- Every write also stamps `frontmatter.scope` (at minimum `{repo: <owner>/<name>}` for repo-derived facts; `{business_slug, namespace}` for business-scoped facts). Atoms/entities without a scope are rejected by `/api/memory/event`.
- Asset references go in `frontmatter.locators[]` with a discriminated `kind` field — never inline binary data. Locators are resolved by `lib/memory/locator.ts`, which carries the per-kind credentials (R2 keys, S3 IAM, etc.) from Doppler.
- `MEMORY_HQ_TOKEN` (narrow PAT scoped to `pinnacleadvisors/memory-hq` only) lives in Doppler, never committed. Endpoint enforces `auth()` + rate-limit + per-source daily write cap.
- No PII or secrets in atoms. The memory repo can be private, but treat its contents as if it were public.
- `npx tsc --noEmit` passes. New routes have a basic happy-path test.
- Branch: `claude/global-config-access-tzmUa`. No auto-merge to main; human gate on the PR.

---

## Phase 1 — Explore (findings)

### What already exists

- `.claude/skills/molecularmemory_local/cli.mjs` — pure-Node CLI. All operations write directly to `memory/molecular/<kind>/<slug>.md`. No backend abstraction; `fs` is the storage layer.
- `lib/memory/github.ts` — already implements GitHub-as-storage for the Phase 20 runtime agent memory (`pinnacleadvisors/nexus-memory`). Pattern is proven: PAT in Doppler (`MEMORY_TOKEN`), Contents API for read/write/SHA-based concurrency.
- `.claude/hooks/check-write-size.sh` — write-size enforcement (added this session).
- `.claude/hooks/skill-router.sh`, `.claude/hooks/session-start-secrets.sh` — existing hook infrastructure.
- `~/.claude/CLAUDE.md` — Claude Code auto-loads this in every session on top of any repo-local `CLAUDE.md`. Currently empty for this user.
- Supabase is already integrated; `pgvector` is already used in `lib/swarm/`. Adding 5 tables + a webhook is well-trodden.
- `POST /api/cron/rebuild-graph` already exists for nightly graph rebuild.

### Gaps to close

- `cli.mjs` has no `--backend` flag — fs is hardcoded.
- No `/api/memory/event` endpoint yet. OpenClaw/n8n/managed agents have no canonical write surface.
- `INDEX.md` and `.graph.json` are regenerated by clients — high merge-conflict surface.
- `log.md` is append-only single file — also conflict-prone.
- No `mcp-memory` server (deferred until API stabilizes).
- `~/.claude/CLAUDE.md` is empty — no global protocols yet.
- No cross-scope addressing — `frontmatter.source` is a free-text URL/path, not a structured `scope + locators[]` schema. Cannot disambiguate same-title facts across businesses; cannot point an agent at the actual asset (R2 video, YouTube link, S3 PDF) — only at a string that may or may not be fetchable.

### Risks

- GitHub Contents API rate limit (5000/h authenticated). Mitigations: tree API for batch writes; GitHub App installation tokens at scale; Supabase mirror serves all reads.
- Concurrent writes to the same file → 409 from Contents API. Mitigation: SHA-based optimistic concurrency in CLI with retry.
- Stale Supabase mirror if webhook drops. Mitigation: nightly reconcile job re-syncs from GitHub.
- New writers (OpenClaw, n8n) bypassing the API and writing direct to GitHub → loses provenance + auditing. Mitigation: `MEMORY_TOKEN` only routes through `/api/memory/event`; GitHub PAT for direct access is *not* given to those workers.

---

## Phase 2 — Plan (atomic tasks)

Each task is sized to fit one Write/Edit call under the 300-line hook limit. Tasks marked `Parallel: yes` can run concurrently because they touch disjoint files.

### Step 1 — Write Size Discipline (DONE in this PR)

- [x] **T1a** `.claude/hooks/check-write-size.sh` — exit-2 block on Write/Edit/Bash over threshold.
- [x] **T1b** `.claude/settings.json` — wire as PreToolUse hook for Write|Edit|Bash.
- [x] **T1c** `AGENTS.md` — Write Size Discipline section above Pre-commit Checklist.
- [x] **T1d** `task_plan-memory-architecture.md` (this file).

### Step 2 — CLI `--backend=github` mode

- **T2a** Add `lib/molecular/github-backend.mjs` (~180 lines) wrapping Contents API: `getAtom(scope, slug)`, `putAtom(scope, slug, body, sha?)`, `deleteAtom(scope, slug, sha)`, `listAtoms(scope?)`, plus the same shape for entities/mocs/sources/synthesis. Path layout: `<kind>/<scope-id>/<slug>.md` where `scope-id = sha1(JSON.stringify(canonicalScope)).slice(0,8) + '-' + (business_slug || repo-name)`. Honors `MEMORY_HQ_REPO` (default `pinnacleadvisors/memory-hq`) and `MEMORY_HQ_TOKEN`. SHA-based optimistic concurrency with 3 retries on 409. Parallel: yes.
- **T2b** Refactor `cli.mjs` to read `--backend=github|local` (default `local`) and `--scope=<json>` flag; abstract the fs layer into a `Backend` interface so `atom`, `entity`, `moc`, `source`, `synthesis`, `query`, `lint` route through it. CLI auto-fills `scope.repo` from `git remote get-url origin` when omitted. Skip `graph` and `reindex` in github mode (server-cron-only — see Step 4). Parallel: no (depends on T2a).
- **T2c** `.claude/skills/molecularmemory_local/SKILL.md` — document `--backend` + `--scope` flags, the new `MEMORY_HQ_REPO` / `MEMORY_HQ_TOKEN` env vars, and locator examples. Parallel: yes.
- **T2d** Bootstrap `pinnacleadvisors/memory-hq` repo (private) with `atoms/`, `entities/`, `mocs/`, `sources/`, `synthesis/`, `log/`, `digest/` directories + a `README.md` documenting the scope layout, locator schema, and contributing AI models. Done via `mcp__github__create_repository` + `mcp__github__push_files` (one batched commit). Parallel: yes.
- **T2e** `memory/platform/SECRETS.md` — add `MEMORY_HQ_REPO`, `MEMORY_HQ_TOKEN`, plus the per-locator-kind creds Doppler will need: `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_ACCOUNT_ID`, `YOUTUBE_API_KEY`, etc. Parallel: yes.
- **T2f** Add `lib/memory/locator.ts` (~120 lines) with `resolveLocator(locator) → {url, content?, mediaType, size?}` dispatching on `locator.kind`. Initial kinds: `github` (uses `mcp__github__` or PAT), `r2` (Cloudflare S3-compatible), `s3`, `url` (plain HTTP fetch), `youtube` (returns embed/watch URLs + transcript via API), `vercel-blob`, `local` (fs read; only when running outside Vercel). Each resolver returns a uniform shape; missing creds → returns `{url, content: null}` with a warning. Parallel: yes.
- **T2g** Add `lib/memory/scope.ts` — `canonicalScope(input)` normalises `{repo, business_slug, namespace}`, computes the deterministic `scope-id`, validates required fields. Used by T2a + T3a + cli.mjs. Parallel: yes.

Verify Step 2: `node cli.mjs --backend=github --scope='{"repo":"pinnacleadvisors/nexus"}' atom "Test fact" --fact="..." --source=test --locator=url:https://example.com` creates a file at `atoms/<scope-id>/test-fact.md` in `memory-hq`; `cli.mjs --backend=github query "Test"` finds it; `resolveLocator()` returns the URL.

### Step 3 — `/api/memory/event` universal write surface

- **T3a** `app/api/memory/event/route.ts` — POST handler. Body: `{type, source, payload, trace_id?}`. Auth: `MEMORY_TOKEN` bearer. Rate-limit: 100 writes/min per source. Translates payload into a Backend call. Stamps `frontmatter.author = source`, `trace_id`, `importance` (default `normal`), `kind` (default `fact`). Returns `{slug, url, sha}`. Parallel: no (depends on T2a).
- **T3b** `lib/memory/event-client.ts` — typed client for in-process callers (managed agents). Parallel: yes.
- **T3c** `app/api/memory/event/route.test.ts` — happy-path: write atom, read it back via `cli.mjs --backend=github query`. Parallel: yes.
- **T3d** Update `.claude/agents/supermemory.md` to call `/api/memory/event` instead of writing files directly. Parallel: yes.
- **T3e** n8n: add a reusable "Write to Memory" subworkflow JSON in `lib/n8n/templates/`. Parallel: yes.

Verify Step 3: managed agent + n8n + raw curl all write atoms with correct provenance frontmatter.

### Step 4 — Generated files cron-only + log-per-event

- **T4a** Modify `cli.mjs` so `graph` and `reindex` are no-ops when `--backend=github` (run server-side via cron only). Parallel: yes.
- **T4b** Replace `log.md` writes with `log/YYYY-MM-DDTHH-MM-SS-<slug>.md` file-per-event in both backends. Parallel: yes.
- **T4c** `app/api/cron/rebuild-graph/route.ts` — extend to (1) regenerate `INDEX.md` and `.graph.json` in the central repo via tree API (single batched commit), (2) fold log entries into `digest/YYYY-MM-DD.md`, (3) emit metric samples. Parallel: no (depends on T2a, T4a, T4b).
- **T4d** Cron schedule: every 6h via `vercel.json`. Parallel: yes.

Verify Step 4: writes from clients no longer touch INDEX.md / .graph.json. Manual cron run regenerates them. No git conflicts after parallel agent writes.

### Step 5 — Supabase mirror + webhook (read scaling)

- **T5a** `supabase/migrations/021_molecular_mirror.sql` — tables `mol_atoms`, `mol_entities`, `mol_mocs`, `mol_sources`, `mol_synthesis` with columns `slug`, `title`, `body_md`, `frontmatter jsonb`, `sha`, `updated_at`, `embedding vector(1536)`. Indexes on `slug`, `frontmatter ->> 'author'`, full-text on `body_md`, ivfflat on `embedding`. Parallel: yes.
- **T5b** `app/api/cron/sync-memory/route.ts` — webhook receiver. Verifies GitHub HMAC signature, diffs changed paths, upserts/deletes corresponding rows. Parallel: no (depends on T5a).
- **T5c** GitHub repo webhook config (push event → cron URL) — done via `mcp__github__` tool, documented in repo README. Parallel: yes.
- **T5d** `lib/memory/supabase-reader.ts` — read API: `searchAtoms(query, k)`, `getBySlug`, `byAuthor`, vector search. Parallel: yes.
- **T5e** `cli.mjs query` — when `SUPABASE_URL` is set, route reads to Supabase first, fall back to GitHub on miss. Parallel: no (depends on T5d).
- **T5f** Nightly reconcile job: walk GitHub tree, diff against Supabase, fix drift. Parallel: yes.

Verify Step 5: write atom via API → within seconds appears in Supabase → `cli.mjs query` returns from Supabase, not GitHub.

### Step 6 — `mcp-memory` server

- **T6a** New package `services/mcp-memory/` — Node MCP server exposing `memory_atom`, `memory_entity`, `memory_moc`, `memory_query`, `memory_search`. All tools call `/api/memory/event` (write) or `lib/memory/supabase-reader.ts` (read). Parallel: yes.
- **T6b** `~/.claude/settings.json` user-level — register the MCP server so any Claude Code session in any repo can enable it. Parallel: yes.
- **T6c** Smoke test: open a new session in a different repo, enable `mcp-memory`, create an atom, confirm it appears in central repo. Parallel: no.

### Step 7 — Global `~/.claude/CLAUDE.md`

- **T7a** `~/.claude/CLAUDE.md` — lift these sections from per-repo CLAUDE.md: 3-layer Memory Architecture (rules only, not Nexus-specific paths), Long-Horizon Task Protocol, Write Size Discipline, Skill Routing rubric, Knowledge Graph CLI cheatsheet (point to `--backend=github` as the default in any repo). Parallel: yes.
- **T7b** Slim `/home/user/nexus/CLAUDE.md` — remove the lifted sections, leave only Nexus-specific things (this repo's stack, file structure, ALLOWED_USER_IDS, etc.). Parallel: yes (after T7a written).
- **T7c** Test with a new session in a sibling repo: confirm protocols load without per-repo duplication. Parallel: no.

### Step 8 (defer) — Branch-per-agent + GitHub App installations

Only triggered if Step 5 mirror still hits rate limits or 409 retries become frequent. No tasks until then.

---

## Phase 3 — Implement

Awaiting user review of Phase 2 plan before starting Step 2. Step 1 (Write Size Discipline) is implemented in this PR.

When implementation begins, follow CLAUDE.md PDCA gates:
- After each step, verify against success criteria above.
- Commit per atomic task. Stream error → at most one task lost.
- Update `## Progress` below after each task lands.

---

## Progress (as of 2026-04-29)

### Completed
- [x] **Step 1 — Write Size Discipline** — hook + settings wiring + AGENTS.md policy + this plan file. Commit `b834d02`.
- [x] **Step 2 — CLI `--backend=github` mode + scope + locators** (T2a, T2b, T2c, T2e, T2f, T2g). Commit `895e7ed`. T2d (memory-hq repo bootstrap) is owner-action.
- [x] **Step 3 — `/api/memory/event` universal write surface** (T3a, T3b, T3c-substitute, T3d, T3e). Commit `41ca0ca`.
- [x] **Step 4 — Cron-only generated files + log-per-event** (T4a-T4d). Commit `2305185`.
- [x] **Step 5 — Supabase mirror + webhook + reader** (T5a, T5b, T5d, T5f). Commit `519b34e`. T5c is owner action (configure GitHub webhook). T5e deferred (cli.mjs reads stay local-only — full-text reads route through `lib/memory/supabase-reader.ts` from inside Next.js).
- [x] **Step 6 — `mcp-memory` server + `/api/memory/query`** (T6a). Commit `3165376`. T6b/T6c are owner actions.
- [x] **Step 7 — Global protocols doc + per-repo pointer** (T7a, T7b-soft). `docs/global-claude-protocols.md` written; `CLAUDE.md` carries a pointer note. T7b-hard (full removal of duplicated sections) deferred until owner confirms `~/.claude/CLAUDE.md` works from a sibling repo. T7c is owner action.

### Remaining
- [ ] Step 8 — Branch-per-agent + GitHub App (deferred until rate limits actually bite).

### Owner actions to make Steps 2–7 live
1. **Create `pinnacleadvisors/memory-hq`** — private, empty, default branch `main`. Bootstrap directory layout per Step 2 (CLI `init` will populate on first write).
2. **Mint `MEMORY_HQ_TOKEN`** — fresh PAT, contents r/w, scoped only to `memory-hq`. Add to Doppler.
3. **Configure GitHub webhook** on `memory-hq` per `memory/platform/SECRETS.md` Step 5 instructions.
4. **Register `mcp-memory`** in `~/.claude/settings.json` per `services/mcp-memory/README.md` (after `npm install && npm run build`).
5. **Copy `docs/global-claude-protocols.md`** to `~/.claude/CLAUDE.md`. Test from a sibling repo — if protocols load correctly, raise a follow-up PR to trim the duplicated sections from `pinnacleadvisors/nexus/CLAUDE.md`.

### Open before Step 3 (resolved)
- Per-source rate-limit defaults: **100 writes/min** (`MEMORY_EVENT_RATE_PER_MIN` override).
- Locator credentials: documented in `memory/platform/SECRETS.md`. Optional — missing creds simply mean `lib/memory/locator.ts` returns `{url, content: null}` and callers fall back to next locator.

### Decisions locked (2026-04-29)
1. **Memory repo name** → `pinnacleadvisors/memory-hq` (private). Naming reflects multi-AI-model future — not Claude-specific.
2. **Token** → mint a fresh narrow-scope PAT `MEMORY_HQ_TOKEN` (only `pinnacleadvisors/memory-hq` repo, contents r/w). The Phase 20 `MEMORY_TOKEN` stays scoped to `pinnacleadvisors/nexus-memory`. Blast-radius isolation.
3. **Visibility** → private. Default closed; can flip to public per-folder later if specific knowledge becomes shareable.
4. **`mcp-memory` path** → bundle in monorepo at `services/mcp-memory/`. Extract to standalone npm only when a second consumer asks for it.
5. **Per-repo `memory/` directories** → confirmed: only `memory/molecular/` lifts to `memory-hq`. `memory/platform/` and `memory/roadmap/` stay per-repo (project-specific). Step 7 will codify this in `~/.claude/CLAUDE.md`.

### New capability locked: cross-scope addressing + locators
- `frontmatter.scope: {repo?, business_slug?, namespace?}` disambiguates same-named atoms across projects/businesses. Storage layout: `<kind>/<scope-id>/<slug>.md` where `scope-id` is a deterministic 8-char SHA prefix + human-readable suffix.
- `frontmatter.locators: [{kind, ...}]` — structured asset pointers. Initial kinds: `github`, `r2`, `s3`, `url`, `youtube`, `vercel-blob`, `local`. Resolved by `lib/memory/locator.ts` so any agent can fetch the actual image/video/PDF/source from wherever it lives. Multi-locator atoms self-heal (try next on 404).

### Open before Step 3
- **Per-source rate-limit defaults** for `/api/memory/event`. Proposed: 100 writes/min/source, 1000/day/source. Owner override via env.
- **Locator credentials** — Doppler keys for R2/S3/YouTube need to be added before T2f resolver tests pass. Non-blocking for T2a–T2e.

# Platform Copilot Expansion — Doppler/Supabase + Paperclip Primitives

## North Star

**Goal:** Give platform-copilot first-class access to Doppler (secrets) and Supabase (database), and absorb the four remaining Paperclip primitives — org chart, goal-aware execution, append-only tool-call audit, and a platform-wide issues page accessible from the sidebar.

**Success criteria**
- [ ] `/settings/accounts → Admin scope` lists Doppler + Supabase alongside the existing 26 providers; both connect via api-key paste, validated on save.
- [ ] platform-copilot can read secrets metadata + run read-only Supabase queries via MCP without any approval; writes (rotate a secret, run a mutating SQL) gate through `approval-request` blocks.
- [ ] `/org` page renders an interactive org chart (CEO → CTO → engineer → ...) with named agent slugs assigned to each role and reporting lines visible.
- [ ] Every agent dispatch carries `goal_ancestry` (the full chain via `get_issue_ancestry(p_issue_id)`) injected into the agent's system prompt — confirmed by reading any new `run_events` row's `metadata.goal_ancestry`.
- [ ] Every MCP tool invocation (composio-admin, doppler-admin, supabase-admin, coolify, codex-delegate, permission-broker) writes one row to a new `tool_call_audit` append-only table; viewable at `/audit` (owner-only).
- [ ] `/issues` page in the sidebar (between Inbox and Businesses) lists cross-business issues with business / assignee / status filters; mirrors the per-business UI.

**Hard constraints**
- No secret values ever logged. Doppler `get-secret` returns the value to the agent's context, NEVER to `tool_call_audit.args` or to any log line.
- No `5xx` from new API routes — return `200 + {ok:false,error}` for transient failures (retry-storm rule).
- Supabase MCP defaults to read-only. Writes ONLY when the agent emits an `approval-request` block and the operator approves the specific SQL.
- Doppler `set-secret` / `delete-secret` / project mutations are operator-only, gated by `approval-request`.
- Don't modify `business-operator.md` or `codex-operator.md` (clone/extend per AGENTS.md).
- Write-size discipline: every Edit/Write under 300 lines; skeleton-then-fill for new long files.
- Provider-agnostic: nothing in skill/agent specs may pin a Claude/Codex model version in prose.

---

## Phase 1 — Explore (done)

See completed exploration:
- `lib/oauth/providers.ts` — 26 providers, `apiKeySetup` shape works for API-key only (Doppler+Supabase fit).
- `services/mcp-composio-admin/src/index.ts` — pattern to mirror for `mcp-doppler-admin` + `mcp-supabase-admin`.
- `services/claude-gateway/entrypoint.sh` — where MCP servers get registered.
- `components/settings/AccountList.tsx` — scope-based filter (admin/per-business/shared) auto-renders new providers.
- `supabase/migrations/047_goals.sql` + `048_issues.sql` + `049_run_events_ancestry.sql` + `052_goal_ancestry_fn.sql` — goals/issues/ancestry already shipped (Paperclip absorption).
- `lib/goals/ancestry.ts` — caller for `get_issue_ancestry`; just needs to be invoked at every dispatch.
- `supabase/migrations/005_audit_log` — action-level audit (not tool-call grained). Need a new `tool_call_audit` table.
- `components/layout/Sidebar.tsx` — `BASE_NAV` array; insert `/issues` + `/org`.
- `app/(protected)/businesses/[slug]/issues/page.tsx` — pattern to mirror for `/issues`.

## Phase 2 — Plan (atomic tasks)

### Task A — Connectors: Doppler + Supabase

#### A1 — Add Doppler + Supabase to `lib/oauth/providers.ts`
- File: `lib/oauth/providers.ts`
- Change: Append two entries to `OAUTH_PROVIDERS` — both `scopePolicy: 'admin-only'`, both `apiKeySetup` with `envVar: 'DOPPLER_TOKEN'` / `'SUPABASE_SERVICE_ROLE_KEY'`. Add `'devops'` to `OAuthCategory` union if needed (Doppler) — or use `'developer'`.
- Verify: `/settings/accounts` in admin scope renders both with paste-key forms.
- Parallel: yes

#### A2 — Validation on api-key save (existing route)
- File: `app/api/connected-accounts/api-key/route.ts`
- Change: Branch on provider id — Doppler key validated by `GET https://api.doppler.com/v3/me`; Supabase key validated by `GET <url>/rest/v1/?apikey=<key>`. Reject with `{ok:false,error}` 200 if invalid.
- Verify: Pasting a bogus key returns the inline error in the UI; pasting a real key persists.
- Parallel: no (depends on A1 + we need the existing route shape)

### Task B — MCP wrappers (services/mcp-doppler-admin + mcp-supabase-admin)

#### B1 — `services/mcp-doppler-admin/` scaffold
- File: `services/mcp-doppler-admin/package.json`, `src/index.ts`, `Dockerfile`, `tsconfig.json`
- Change: Mirror `mcp-composio-admin`. Three tools: `doppler_list_projects`, `doppler_list_secrets_metadata(project, config)`, `doppler_get_secret(project, config, name)` (read-only, audited). Plus three gated tools: `doppler_set_secret`, `doppler_delete_secret`, `doppler_rotate_token` — each returns a `requires_approval: true` payload the agent must escalate via `approval-request`.
- Verify: `node dist/index.js` boots; `tools/list` returns 6 entries.
- Parallel: yes (with B2)

#### B2 — `services/mcp-supabase-admin/` scaffold
- File: `services/mcp-supabase-admin/package.json`, `src/index.ts`, `Dockerfile`, `tsconfig.json`
- Change: Mirror pattern. Tools: `supabase_list_tables()`, `supabase_describe_table(name)`, `supabase_select(sql)` (RO — enforces `SELECT` only via regex), `supabase_execute(sql)` (gated, runs through service role, returns `requires_approval: true` unless `confirmed: true` passed via approval-request flow), `supabase_recent_log_events(limit)` (convenience query against `log_events`).
- Verify: `tools/list` returns 5 entries; `supabase_select('SELECT 1')` returns `[{?column?: 1}]`; `supabase_select('UPDATE x SET y=z')` rejects with "Only SELECT allowed; use supabase_execute for writes (gated)".
- Parallel: yes (with B1)

#### B3 — Register both in `services/claude-gateway/entrypoint.sh`
- File: `services/claude-gateway/entrypoint.sh`
- Change: Add `doppler-admin` + `supabase-admin` to the `mcpServers` block in the generated settings.json (next to `composio-admin`). Allow-list their tool prefixes in `permissions.allow` (read-only tools auto-allowed; write tools route through permission-broker).
- Verify: Gateway boots; MCP probe shows both servers with tool counts.
- Parallel: no (depends on B1 + B2 having builds)

#### B4 — Update `platform-copilot.md` spec with the new tools
- File: `.claude/agents/platform-copilot.md`
- Change: Add a "Doppler MCP" + "Supabase MCP" subsection mirroring the existing "Coolify MCP" section. Document read-only tools (fire freely) vs write tools (require approval-request block first).
- Verify: `npm run check:agent-spec-freshness` passes; bump `topology_last_verified` to today.
- Parallel: no (depends on B1/B2 contract being finalized)

### Task C — Org chart

#### C1 — Migration `057_agent_roles.sql`
- File: `supabase/migrations/057_agent_roles.sql`
- Change: `agent_roles` table — `id, business_slug (nullable for platform-level), role_title text, parent_role_id uuid (self-FK), assigned_agent_slug text (FK to agent_library.slug, nullable), responsibilities text, created_at, updated_at`. RLS service-role-only. Idempotent.
- Verify: `npm run db:migrate:dry-run` shows the migration; `supabase db push` applies cleanly.
- Parallel: yes (with C2-C3)

#### C2 — `lib/org/roles.ts` data layer
- File: `lib/org/roles.ts`
- Change: `listRoles({businessSlug?})`, `getRoleTree({businessSlug?})` (returns a `{role, children[]}` tree), `assignAgent(roleId, agentSlug)`, `upsertRole({...})`. Graceful-degrade on missing migration (mirrors `lib/issues/insert.ts`).
- Verify: TS clean; functions return `[]`/`null` when migration missing.
- Parallel: yes (with C3)

#### C3 — `/app/(protected)/org/page.tsx` + `components/org/OrgChart.tsx`
- File: `app/(protected)/org/page.tsx` (server component, loads tree), `components/org/OrgChart.tsx` (client, renders hierarchy with assign buttons)
- Change: Server-fetch tree, render with vertical hierarchy (Mermaid-free — pure CSS/SVG). Empty state CTA: "Seed default roles (CEO/CTO/Engineer/Designer)".
- Verify: `/org` renders empty state; seeding inserts 4 rows; assignments persist after refresh.
- Parallel: no (depends on C1+C2)

#### C4 — Sidebar entry for `/org`
- File: `components/layout/Sidebar.tsx`
- Change: Insert `{ type: 'link', href: '/org', label: 'Org Chart', icon: Network }` after `/businesses`. Update `isActive` map.
- Verify: Sidebar shows "Org Chart" with Network icon; route highlights correctly.
- Parallel: yes (after C3 page exists)

### Task D — Goal-aware execution

#### D1 — `lib/dispatch/inject-ancestry.ts` helper
- File: `lib/dispatch/inject-ancestry.ts`
- Change: `injectGoalAncestry(brief: string, opts: {issueId?, goalId?, businessSlug}): Promise<string>` — calls `get_issue_ancestry(issueId)` (or builds the chain from `goalId` only when no issue exists), formats as a markdown "## Why this matters" block, prepends to the brief.
- Verify: TS clean; with a real issue id, returned brief starts with markdown ancestry block followed by the original brief.
- Parallel: yes

#### D2 — Wire into `app/api/adapters/dispatch/route.ts` + `app/api/claude-session/dispatch/route.ts`
- File: both
- Change: Before sending the brief to claude-gateway / codex-gateway, call `injectGoalAncestry(brief, {...})`. Persist the ancestry summary in `run_events.metadata.goal_ancestry`.
- Verify: A dispatch with `{issueId: '...', goalId: '...'}` results in a `run_events` row whose metadata includes the ancestry chain; the agent transcript shows the "Why this matters" preamble.
- Parallel: no (depends on D1)

### Task E — Append-only tool-call audit

#### E1 — Migration `058_tool_call_audit.sql`
- File: `supabase/migrations/058_tool_call_audit.sql`
- Change: `tool_call_audit` table — `id, ts, agent_slug, mcp_server, tool_name, args_redacted jsonb, result_status text, result_excerpt text, business_slug nullable, run_id nullable, issue_id nullable, goal_id nullable`. Append-only (no UPDATE policy). RLS service-role-only for writes, owner-only for reads.
- Verify: `db:migrate:dry-run` shows it; `INSERT` works, `UPDATE` rejects.
- Parallel: yes

#### E2 — `lib/audit/tool-call.ts` helper
- File: `lib/audit/tool-call.ts`
- Change: `recordToolCall({agent_slug, mcp_server, tool_name, args, result, ...ancestry})` — strips known-secret keys from args (any matching `/token|key|secret|password/i`), truncates `result_excerpt` to 2KB, writes one row. Graceful-degrade if table missing.
- Verify: TS clean; secret-laden args come back redacted in the persisted row.
- Parallel: yes

#### E3 — Wire into all admin MCP wrappers
- File: `services/mcp-composio-admin/src/index.ts`, `services/mcp-coolify/src/index.ts`, `services/mcp-codex-delegate/src/index.ts`, `services/mcp-permission-broker/src/index.ts`, NEW `services/mcp-doppler-admin/src/index.ts`, NEW `services/mcp-supabase-admin/src/index.ts`
- Change: Each tool handler ends with `await recordToolCall({...})` before returning. Failure to audit is logged but not fatal (don't break the tool call).
- Verify: Each MCP exercise (smoke-test the gateway) leaves a fresh `tool_call_audit` row.
- Parallel: no (depends on E1+E2; depends on B1+B2 for the two new servers)

#### E4 — `/app/(protected)/audit/page.tsx` viewer
- File: `app/(protected)/audit/page.tsx`
- Change: Owner-only (`isPlatformOwner()`). Lists last 200 tool calls, filterable by agent/mcp/tool/business. Each row expandable to see args/result. Pulls from `tool_call_audit`.
- Verify: Page renders rows after any platform-copilot turn; non-owner gets 403.
- Parallel: yes (after E1+E2)

### Task F — Platform-wide issues page

#### F1 — `/app/(protected)/issues/page.tsx`
- File: `app/(protected)/issues/page.tsx`
- Change: Mirror of `app/(protected)/businesses/[slug]/issues/page.tsx` BUT cross-business — no `.eq('business_slug', slug)`. Add a business filter dropdown (URL `?business=<slug>`) + assignee filter + status filter.
- Verify: Page renders all issues across businesses; filters update via shallow nav.
- Parallel: yes

#### F2 — Sidebar entry for `/issues`
- File: `components/layout/Sidebar.tsx`
- Change: Insert `{ type: 'link', href: '/issues', label: 'Issues', icon: ListTodo }` after `/inbox`. Update `isActive`.
- Verify: Sidebar shows "Issues"; route highlights.
- Parallel: yes (after F1)

## Phase 3 — Implement

Order chosen for fastest operator value + smallest risk:
1. **A1 + A2** — Connectors visible immediately (UI-only change, no MCP plumbing yet).
2. **C1 + C4** — Org chart migration + sidebar entry (page renders empty state).
3. **F1 + F2** — Platform-wide issues page + sidebar (mirror of existing).
4. **D1 + D2** — Goal ancestry injection (pure backend wiring).
5. **C2 + C3** — Org chart data layer + page (depends on C1).
6. **E1 + E2 + E4** — Audit log table + helper + viewer (independent).
7. **B1 + B2 + B3 + B4** — MCP wrappers (heaviest, needs gateway redeploy).
8. **E3** — Wire audit into ALL MCP wrappers including new ones (closes the loop).

Each step:
- Run `npx tsc --noEmit` after every edit.
- Commit per atomic task (`feat(<area>): <one-line>`).
- Update `task_plan-platform-expansion.md` `## Progress` after each task.

## PDCA gates

| Gate | Question |
|---|---|
| After A1+A2 | Doppler + Supabase appear in /settings/accounts? Bogus keys rejected? |
| After C+F (sidebar entries) | All new nav items visible at 1280px + 375px? |
| After D2 | One real dispatch has goal_ancestry in run_events.metadata? |
| After E3 | One MCP call leaves a row in tool_call_audit? |
| After B3 | Gateway boots with all 6 MCPs (composio/doppler/supabase/coolify/codex-delegate/permission-broker)? |
| Before PR | tsc clean? Retry-storm + topology + provider-agnostic checks green? Mobile screenshots taken? |

## Progress

### Completed (2026-05-25)
- [x] Phase 1 — surface exploration (connectors, MCP wrappers, sidebar, issues/goals/audit_log tables, ancestry function)
- [x] Phase 2 — plan written
- [x] **A1** — Doppler + Supabase added to `lib/oauth/providers.ts` (admin-only, apiKeySetup)
- [x] **A2** — `lib/oauth/validate-api-key.ts` + wired into `app/api/connected-accounts/api-key/route.ts`
- [x] **B1** — `services/mcp-doppler-admin/` scaffolded (7 tools — 4 read, 3 gated)
- [x] **B2** — `services/mcp-supabase-admin/` scaffolded (5 tools — 4 read, 1 gated)
- [x] **B3** — Both registered in `services/claude-gateway/entrypoint.sh` (build + register + allow-list)
- [x] **B4** — `platform-copilot.md` updated with both MCP usage sections; `topology_last_verified` bumped to 2026-05-25
- [x] **C1** — Migration `057_agent_roles.sql`
- [x] **C2** — `lib/org/roles.ts` data layer + tree builder + DEFAULT_ROLES seed
- [x] **C3** — `app/(protected)/org/page.tsx` + `components/org/OrgChart.tsx` + API routes (`/api/org/seed`, `/api/org/roles`, `/api/org/roles/[id]`)
- [x] **C4** — Sidebar entry for `/org`
- [x] **D1** — Ancestry helper already existed at `lib/goals/ancestry.ts` (Paperclip absorption Task 4d)
- [x] **D2** — Auto-compute ancestry wired into `app/api/adapters/dispatch/route.ts` AND `app/api/claude-session/dispatch/route.ts`
- [x] **E1** — Migration `058_tool_call_audit.sql` (append-only, RLS service-role)
- [x] **E2** — `lib/audit/tool-call.ts` helper + `withToolCallAudit` wrapper + secret redaction
- [x] **E4** — `/audit` page + sidebar entry
- [x] **E** — `app/api/audit/tool-call/route.ts` sink endpoint (shared-secret auth for gateway-side MCPs)
- [x] **F1** — `/issues` platform-wide page with business + status filters
- [x] **F2** — Sidebar entry for `/issues`

### Verification (2026-05-25)
- [x] `npx tsc --noEmit` — clean
- [x] `npm run check:retry-storm` — clean
- [x] `npm run check:topology` — clean
- [x] `npm run check:provider-agnostic` — clean
- [x] `npm run check:agent-spec-freshness` — all 20 specs fresh

### Remaining (follow-up PRs)
- [ ] **E3 partial** — wire `recordAudit` into the four PRE-EXISTING MCP wrappers (composio-admin, coolify, codex-delegate, permission-broker) so they ALSO emit `tool_call_audit` rows. The two NEW wrappers (doppler-admin, supabase-admin) already audit every call. Editing the existing wrappers is mechanical (~30 LoC each); deferred to its own PR for reviewability.
- [ ] **A2 follow-up** — apply migrations 057 + 058 in production (`scripts/migrate.mjs` or Supabase dashboard) before the UI is usable.
- [ ] **B3 follow-up** — set `NEXUS_AUDIT_TOKEN` in Doppler so the MCP-side audit POSTs are accepted by `/api/audit/tool-call`. Without it, the audit endpoint silently drops rows (logged once).
- [ ] **B3 follow-up** — register `pg_exec(p_sql text, p_params jsonb)` stored function in Supabase to enable `supabase_select` / `supabase_execute` (the MCP returns a clear error directing the operator to create it if missing).

### Blockers / Open questions
- None at this layer. The follow-ups above are operator-driven, not blockers on the code merge.

### Memory-hq atom
Per AGENTS.md "Post-incident memory protocol", I should write one atom summarising the org-chart + audit-trail + Doppler/Supabase MCP additions when the PR merges, linked to `[[mocs/platform-topology]]` and a new `[[mocs/agent-orchestration]]` MOC.

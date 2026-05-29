# task_plan — Bloomberg-terminal /audit redesign

> Operator brain-dump 2026-05-27. **STATUS: PLANNED, ready to implement.**

## North Star

```
Goal:             Redesign /audit from a single chronological table into
                  a Bloomberg-terminal-style multi-tab dense overview
                  where the operator can see ALL platform activity
                  streaming in — agent runs, cron heartbeats, skill
                  invocations, tool calls, MCP calls, gateway turns,
                  approvals — and rapidly spot anomalies.
Success criteria: - Operator opens /audit and sees a multi-tab layout
                    similar to a trading terminal (positions / orders /
                    history / news panes).
                  - Each tab has its own dropdown filters + sort + freeze
                    controls.
                  - Tabs the operator can add: Agent activity, Cron
                    activity, Skill invocations, Tool calls, MCP calls,
                    Gateway turns, Approvals, Heartbeats, Errors.
                  - Streaming via SSE — new rows appear at the top as
                    they happen.
                  - Filter pills cross-cut: by business, by agent, by
                    outcome (ok/error), by time-window.
                  - Operator can save custom tab layouts ("My morning
                    triage"), share them via URL.
                  - Mobile: tabs collapse into a dropdown selector; one
                    pane visible at a time.
Hard constraints: - Reuse existing tables — run_events, gateway_turns,
                    audit_events, simulation_runs, approvals,
                    metric_samples. No new infra.
                  - Streaming via Supabase Realtime (already wired for
                    /dashboard agents-realtime channel) — no new long-
                    polling endpoints.
                  - Sentry-traces budget unaffected — SSE is server-side
                    Supabase fan-out, not new traces.
```

## Why this exists

Today's `/audit` is a single filtered table of `audit_events` rows. Good
for narrow lookups ("did X happen?") but bad for the broad-scan use case:
"5 businesses each with multiple agents, 30+ skills, 8 crons — what's
actually happening right now, where are the hotspots, anything looking
weird?"

Bloomberg terminals + TradingView solve this for trading data: dense
panes, multiple simultaneously visible streams, custom layouts.
Application to platform observability is direct.

## Phase 1 — explore

| Data source | Path | Stream method |
|---|---|---|
| Agent activity | `run_events` (event_type=agent.*) | Supabase Realtime channel |
| Cron heartbeats | `audit_events` (resource=cron) + `/cron-health` poll | Realtime + poll fallback |
| Skill invocations | `audit_events` (resource=skill) | Realtime |
| Tool calls | `audit_events` (action=tool.*) + `gateway_turns` | Realtime |
| MCP calls | `audit_events` (resource=mcp) | Realtime |
| Gateway turns | `gateway_turns` (raw — every claude/codex dispatch) | Realtime |
| Approvals | `approvals` (status transitions) | Realtime |
| Errors | run_events.outcome='error' + audit_events.metadata.error | Realtime |
| Heartbeats | `/api/health/deep` poll | 60s poll |

Existing realtime infra: `app/(protected)/dashboard/page.tsx` already
subscribes to `agents` table changes via `supabase.channel(...).on(...)`.
Reuse that pattern per stream.

## Phase 2 — atomic tasks

### Group A — page scaffold (~2 hours)

```
### Task A1 — /audit page conversion to tabbed layout
- File:     app/(protected)/audit/page.tsx → server shell rendering AuditTerminal
- Change:   replace single table with <AuditTerminal /> client component.
            Server fetches initial rows for default tabs (last 100).
- Parallel: no (blocks rest).

### Task A2 — components/audit/AuditTerminal.tsx
- Change:   tab-list state + active-tab content area. Operator clicks "+ New tab"
            to add a tab. Tabs persist in localStorage (`nexus:audit:tabs`).
            Default tabs: Agents / Crons / Errors.
- Parallel: yes (after A1).
```

### Group B — stream sources (~3-4 hours, parallel)

```
### Task B1 — lib/audit/streams.ts
- Change:   one StreamSource per source (Agents / Crons / Skills / Tools /
            MCPs / GatewayTurns / Approvals / Errors / Heartbeats). Each
            exposes: subscribe(onRow), unsubscribe(), initialFetch(filters).
- Parallel: yes.

### Task B2 — Per-source tab component
- File:     components/audit/AgentsTab.tsx etc.
- Change:   one component per source. Filter dropdowns at top, dense table
            below (5-6px row height), auto-scroll to top on new row.
            Freeze/unfreeze button for visual stability when reviewing.
- Parallel: yes (after B1).
```

### Group C — saved layouts + sharing (~2 hours)

```
### Task C1 — Save/load custom layout
- Change:   "Save layout as…" button serialises tab config to
            ?layout=<base64-encoded-json> URL param. Operator shares URL.
- Parallel: yes (after Group B).
```

## Mobile considerations

At 375 px:
- Tab list → dropdown selector (one tab visible at a time)
- Filter pills wrap to multiple rows
- Row height bumps slightly (tap targets)

## Cost / risk

- No new infra, no new gateway, no new third-party.
- Supabase Realtime quota: ~200 concurrent channels free. We use 9 max
  per operator session. Safe.
- SSR perf: server-side initial fetch is 9 parallel queries × 100 rows.
  Cached for 1 s — affordable.

## Progress (as of 2026-05-29)

### Completed
- [x] **Group A — page scaffold** (PR: `claude/bloomberg-scaffold`). Shipped a
  config-driven terminal: `lib/audit/types.ts` + `format.ts` + `sources.ts`
  (9-source registry), owner-gated service-role Server Action
  `app/(protected)/audit/actions.ts`, generic `AuditStreamTable` (dense table,
  per-pane filter pills, freeze, refresh), `AuditTerminal` (localStorage tabs,
  `+ Add pane`, mobile `<select>` swap). Verified authenticated at 1280px +
  375px via minted bot session — 0 console errors, responsive swap confirmed.

### Completed (cont.)
- [x] **Group B — live Realtime streams** (PR: `claude/bloomberg-streams`,
  stacked on A). Migration 093 adds `audit_log`/`approvals`/`tool_call_audit`
  to `supabase_realtime` (idempotent; `run_events`/`gateway_turns` omitted —
  not anon-readable). `lib/audit/streams.ts` (`subscribeToSource` via browser
  anon `postgres_changes` + `matchesRead` scope guard). Wired the subscription
  slot in `AuditStreamTable` (buffer-while-frozen + flush-on-resume + live
  badge); heartbeats/crons auto-poll via `usePollWithBackoff` (60s); added
  `/api/health/deep` (+ pre-existing `/api/dev/fixtures/active`) to
  `lib/sentry/sampler.ts` SKIP_PATTERNS. Verified: Supabase Realtime WS
  connects, Heartbeats pane polls 4 live providers, 0 console errors on /audit.

### Remaining
- [ ] **Group C — saved layouts** (`claude/bloomberg-layouts`):
  `lib/audit/layout.ts` (base64 encode/decode) + `?layout=` hydrate/share in
  `AuditTerminal`.

### Key decisions (real schema ≠ the plan's Phase-1 assumptions)
- **`run_events` / `gateway_turns` are NOT anon-readable** (run_events RLS is
  JWT-sub scoped; gateway_turns is service_role-only), so they cannot stream to
  the browser anon client. `audit_log` (no RLS), `approvals` + `tool_call_audit`
  (`using(true)`) ARE anon-readable → they carry live Realtime deltas. NO RLS
  was loosened — initial/refresh/RLS-locked reads go through the owner-gated
  service-role Server Action (on-demand RPC, not polling).
- **`audit_events` doesn't exist** — the real table is `audit_log`, and its
  resources are `agent`/`chat`/`business`/… (NOT `cron`/`skill`/`mcp`). Final
  source→backing map lives in `lib/audit/sources.ts` header. Crons + Heartbeats
  poll existing owner endpoints (`/api/cron-health/status`, `/api/health/deep`)
  — no new routes. Gateway is refresh-only (RLS).
- **One generic `AuditStreamTable` + a source registry**, not 9 per-source
  components (plan's B2) — DRYer; a new pane is one registry entry.
- **Streaming = Supabase Realtime** (success-criterion "SSE" reconciled to the
  hard constraint). Layouts persist to localStorage v1 (DB sync deferred).

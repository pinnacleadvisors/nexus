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

## Progress

### Awaiting operator approval
- [ ] Group A — page scaffold
- [ ] Group B — 9 stream sources
- [ ] Group C — saved layouts

### Blockers / Open questions
- **Which 9 sources to ship in v1?** Recommend default to Agents + Crons +
  Errors (most-watched). Operator can add Tools / MCPs / Gateway later.
- **Persist layouts in DB or localStorage?** localStorage v1 (no migration).
  DB v2 when operator wants cross-device sync.

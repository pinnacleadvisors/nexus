# task_plan-chat-views.md — Chat Views dropdown extensions

Roadmap for the four follow-up panels behind the Views dropdown shipped in #174 (Tasks / Approvals / Calendar). Plus a small set of polish items left as "baked-in suggestions" — most are already done, two are gaps to close.

## North Star

```
Goal:             Make the chat Views panel the operator's "second brain"
                  for whatever scope they're in — surface every signal that
                  helps them collaborate with that scope's copilot without
                  context-switching to other pages.
Success criteria: - One dropdown → 7 first-class panels (Tasks / Approvals
                    / Calendar shipped, + Notes / Memory / Connected
                    accounts / Live activity).
                  - Every panel is scope-aware ('admin' or 'business:<slug>').
                  - Every panel renders inside the existing slide-in
                    ViewsPanel — no separate route, no full-page modal.
                  - Each panel state survives reload (where applicable).
                  - Total LOC across all 4 new panels under ~1200 — must
                    not turn into 4 mini-apps with bespoke chrome.
Hard constraints: - No new database tables unless a panel genuinely needs
                    durable state (Notes does; Memory + Live + Accounts
                    are pure reads).
                  - Each panel ≤ 250 LOC for the React component.
                  - Each panel API route ≤ 150 LOC; favour reusing
                    existing endpoints.
```

## Status of baked-in suggestions (from #174)

| Suggestion | State | Follow-up |
|---|---|---|
| AI/operator source tagging on Tasks | ✅ Shipped | None |
| Optimistic UI on toggle | ✅ Shipped | None |
| Calendar pulls 3 sources (tasks + runs + crons) | ✅ Shipped | None |
| Approval queue scans for `APPROVAL [<id>]:` resolution | ✅ Shipped | None |
| Badges on dropdown items showing counts | ✅ Shipped (Tasks + Approvals) | Could badge Calendar with "due today" count |
| Esc closes the panel | ⚠️ Half-done — Esc closes the dropdown popover but NOT the open side panel | **Trivial fix.** Add Esc listener to ViewsPanel that calls onClose. ~10 LOC. Include in V1 panel work below. |
| Server-side scope override on agent-emitted tasks | ✅ Shipped | None |

## Phase status — new panels

| Phase | Panel | Status | Notes |
|---|---|---|---|
| **V1** | Esc-close fix + Notes panel | ⏳ Up next | Smallest + most-asked feature |
| **V2** | Connected accounts panel | ⏳ Planned | Pure read, dead simple |
| **V3** | Live activity panel | ⏳ Planned | First real-time-ish view; introduces polling pattern for views |
| **V4** | Memory panel | ⏳ Planned | Most novel; needs memory-hq HTTP wiring |

Sequenced by complexity (V1 trivial, V4 needs memory-hq integration). Each phase ships as one PR.

---

## V1 — Esc-close fix + Notes panel

### Esc-close fix (10 LOC)

`components/chat-views/ViewsPanel.tsx` — add:

```tsx
useEffect(() => {
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
  document.addEventListener('keydown', onKey)
  return () => document.removeEventListener('keydown', onKey)
}, [onClose])
```

Matches Claude Code's reflex. Trivial. Ships with the Notes panel PR.

### Notes panel — per-scope markdown scratchpad

**Why**: Operators frequently want to jot context that the agent doesn't need (decisions, links, todos that aren't blocking enough to be Tasks). Today this lives in random text files or Slack drafts. A panel that's one click away — and scope-aware — captures it where it belongs.

**Scope model**: one notes blob per `(user_id, scope)`. Not per-session. Same scope can be opened in multiple chat tabs; they share one set of notes. Concurrent edits use last-write-wins with a soft conflict warning (a row's `updated_at` mismatch on save triggers a "your version is stale, reload?" banner — no merge UI, just discard or overwrite).

**Schema** (migration `038_operator_notes.sql`):

```sql
create table public.operator_notes (
  id          uuid primary key default uuid_generate_v4(),
  user_id     text not null,
  scope       text not null,           -- 'admin' | 'business:<slug>'
  body        text not null default '',
  updated_at  timestamptz not null default now(),
  constraint operator_notes_scope_unique unique (user_id, scope),
  constraint operator_notes_scope_check  check (scope = 'admin' or scope like 'business:%')
);
alter table public.operator_notes enable row level security;
create policy operator_notes_service_role on public.operator_notes
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
```

**API**:

- `GET  /api/views/notes?scope=...`       → `{ ok: true, note: { body, updated_at } | null }`
- `PUT  /api/views/notes` (body: `{ scope, body, expected_updated_at? }`) → upsert with conflict detection

**Component** — `components/chat-views/NotesView.tsx` (~200 LOC):

- Single `<textarea>` styled with monospace font + markdown-friendly spacing
- Debounced save 800ms after last keystroke (no save button)
- Status line at the bottom: "Saved 12s ago" / "Saving…" / "Conflict — reload?"
- Optional preview toggle: split-view markdown render (use the existing `RenderedMarkdown` from PlatformChat)
- Cmd-S / Ctrl-S forces immediate save

**Wire-in**: add `'notes'` to the `ViewName` union, add a `FileText` icon entry to the dropdown, render the panel in both chat surfaces with scope-aware storage keys.

**Estimated diff**: 1 migration + 2 API routes + 1 component + 2 wire-ins ≈ 350 LOC.

---

## V2 — Connected accounts panel

**Why**: Today the operator opens `/settings/accounts` in a separate tab to remember which platforms a business has wired up. The agent will already have referenced specific platforms in its replies ("I can post to Twitter but not Beehiiv — connect it first") — surfacing the live connection list right next to the chat removes the tab-switch.

**No new tables.** Reads from existing `connected_accounts`. Scope mapping:
- `admin` → `WHERE business_slug = '_admin'`
- `business:<slug>` → `WHERE business_slug = <slug> OR business_slug IS NULL` (per-business + Shared)

**API**:

- `GET /api/views/connections?scope=...` → list of `{ platform, status, last_used_at, source: 'admin' | 'business' | 'shared' }`

**Component** — `components/chat-views/ConnectionsView.tsx` (~180 LOC):

- Grouped sections: "Per-business" / "Shared (fallback)" — collapsible
- Each row: platform icon, name, last_used_at, status pill, "Manage" link → `/settings/accounts`
- Empty state with a CTA: "Connect platforms at /settings/accounts → Pick {scope}"
- Optional: a "Suggest a connection" inline button that copies a draft message into the chat input, e.g. `"Help me figure out which platforms this business should connect — based on what we discussed."`

**Estimated diff**: 1 API route + 1 component + 2 wire-ins ≈ 280 LOC.

---

## V3 — Live activity panel

**Why**: When the operator is in a chat session troubleshooting "why is X broken", a tail of recent `run_events` for the scope is gold. Today they go to `/dashboard/experiments` or grep Supabase. A live tail right in the panel keeps the eye on the chat.

**No new tables.** Reads from existing `run_events`.

**Polling model**: similar to `usePollWithBackoff` already in use by Sidebar's health badge. Default 5s when the panel is open and the tab is focused; backs off when:
- Tab loses focus (15s)
- Last poll returned no new rows (10s, capped at 60s)
- HTTP error (exponential up to 120s, then visible "paused — click to retry")

**API**:

- `GET /api/views/activity?scope=...&since=<iso8601>` → rows after `since`, max 50

Cursor-based — client passes the latest `created_at` it has, server returns only newer rows. Avoids re-fetching the full window every tick.

**Component** — `components/chat-views/ActivityView.tsx` (~250 LOC):

- Reverse-chronological list (newest first)
- Each row: timestamp, phase, status pill (running / done / error), one-line message
- Click a row → expands inline to show the full event JSON
- Live indicator at top: "Live — last update 3s ago" / "Paused (tab hidden)"
- Filter pills at top: All / Errors / Warnings (toggle subset of statuses)
- Optional: a small sparkline at the very top showing events/minute for the last hour

**Important**: this panel is the first "polling" view. Adheres to the retry-storm rules in AGENTS.md — uses `usePollWithBackoff`, not a bare `setInterval`. The route is GETable + Clerk-authed.

**Estimated diff**: 1 API route + 1 component + 2 wire-ins ≈ 350 LOC.

---

## V4 — Memory panel

**Why**: The agent already writes durable learnings to memory-hq via the `memory_atom` MCP tool. Operator can search memory-hq externally, but can't see "what does the memory graph know about this business RIGHT NOW" without leaving the chat. Inline access closes that loop.

**No new tables.** Reads from the existing `mol_*` Supabase mirror (already populated by the memory-hq webhook on every push).

**Two surfaces in one panel**:
1. **Quick search** — input at top, query the `mol_atoms` table FTS index (`title + body`) filtered to scope-relevant rows. Show up to 20 results with title + snippet + locator link.
2. **Suggested atoms** — when search is empty, surface the 10 most recent atoms with `scope.business_slug = <slug>` (or `scope.repo = 'pinnacleadvisors/nexus'` for admin scope).

**API**:

- `GET /api/views/memory?scope=...&q=<query>` → `{ atoms: [{ slug, title, body, locators, updated_at, importance, links }], total }`

Server-side maps the panel scope to a memory-hq scope ID:
- `admin` → `scope.repo = 'pinnacleadvisors/nexus'`
- `business:<slug>` → `scope.business_slug = <slug>`

**Component** — `components/chat-views/MemoryView.tsx` (~280 LOC):

- Search input with 300ms debounce
- Each result: title, importance pill, body snippet (first 240 chars), MOC link if `links` includes one, locator chips (clickable opens the source)
- Empty state with a CTA: "Ask the copilot to write an atom about <topic> — `memory_atom({ title: '...', ... })`"
- Click-through: each atom links to `https://github.com/pinnacleadvisors/memory-hq/blob/main/atoms/.../<slug>.md` (operator can read the full atom + edit it)
- Optional: a "Promote to critical" button on each atom that PATCHes the importance — only owner-scoped, requires confirmation

**Estimated diff**: 1 API route + 1 component + 2 wire-ins ≈ 380 LOC. Adds 1 supabase view if the existing `mol_atoms` schema doesn't have a good FTS index — verify in V4 PR.

---

## Cross-cutting refactor — `useViewData` hook (optional V5)

After V1–V4 ship, four panels do the same thing: fetch from a scoped endpoint, manage loading / error state, refresh on demand. Could extract:

```ts
const { data, loading, error, refresh } = useViewData<TasksResp>(
  `/api/views/tasks?scope=${scope}`,
  { pollMs: 0 }     // 0 = no polling, or a number for poll-with-backoff
)
```

Saves ~50 LOC across the panels. Worth doing if all 4 panels ship and we want to add a 5th. Skip if the next addition uses a different fetch shape (e.g. streaming).

---

## Estimated totals

| Phase | LOC | Migration? | New API routes |
|---|---|---|---|
| V1 (Esc + Notes) | ~360 | 1 (`038_operator_notes`) | 2 |
| V2 (Connected accounts) | ~280 | 0 | 1 |
| V3 (Live activity) | ~350 | 0 | 1 |
| V4 (Memory) | ~380 | 0 (maybe 1 FTS index migration) | 1 |
| **Total** | **~1370 LOC** | 1–2 migrations | 5 routes |

Within the North Star LOC budget (~1200) with a tiny overshoot — acceptable.

## Sequencing

Each phase is one PR, sized to be reviewable in ≤ 30 min.

```
V1 (Notes + Esc-close fix)            ← smallest + most user-asked-for
  ↓
V2 (Connected accounts)               ← pure read, dead simple
  ↓
V3 (Live activity)                    ← introduces polling pattern
  ↓
V4 (Memory)                           ← most novel
  ↓
V5 (useViewData refactor)             ← only if a V5+ panel is also coming
```

No external dependencies between phases — could re-sequence if priorities shift.

## When this plan is done

The Views dropdown has 7 panels (Tasks / Approvals / Calendar / Notes / Connections / Activity / Memory). The chat surface becomes a true "operator console" — the operator can run a full investigation, decision, and follow-up without leaving the chat tab. Pair with the resizable layout (#176) and the broader redesign (ADR 005) and the operator UX is feature-complete for the platform's current scope.

## Risks

- **Polling cost** (V3) — capping at 5s focused / 60s unfocused, with circuit-breaker after errors, keeps reads cheap. Use `lib/sentry/sampler.ts` skip-pattern to avoid drowning Sentry in spans.
- **Notes conflicts** (V1) — last-write-wins is fine for single-operator. If we ever go multi-user, replace with a CRDT (yjs) or pessimistic locking.
- **Memory panel relevance** (V4) — fall-back to "recent atoms" when no search query is decent. Don't try to "predict relevant atoms based on chat context" in V1 — that's a swarm-grade feature.
- **Panel-count creep** — at 7 panels the dropdown gets crowded. Mitigate by category-grouping the menu items once we cross 5.

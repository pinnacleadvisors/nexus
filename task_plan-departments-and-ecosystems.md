# task_plan-departments-and-ecosystems.md

Goal: Turn every "team" plan in the repo into an instance of a single abstraction — a **department** bound to a **ecosystem set**. Both axes are pluggable: any business can spin up "the same department" against a different ecosystem (Higgsfield → Veo, Open-Code → Codex, memory-hq → GBrain) by swapping one config value. Establish the starter department template, the ecosystem adapter contract, and a future plan for custom org-chart arrangements.

This file is the architectural overlay for the five concrete team plans:
- [task_plan-content-team-higgsfield.md](task_plan-content-team-higgsfield.md)
- [task_plan-design-team-open-design.md](task_plan-design-team-open-design.md)
- [task_plan-dev-team-open-code.md](task_plan-dev-team-open-code.md)
- [task_plan-gbrain-integration.md](task_plan-gbrain-integration.md)
- [task_plan-hmem-architecture.md](task_plan-hmem-architecture.md)

Success criteria:
- A new abstraction `lib/teams/` + `lib/ecosystems/` ships in v1 — the five plans above each become a small adapter + agent-roster on top of it.
- A business owner can switch its Content department from Higgsfield to Runway with one DB-row update — no agent spec edits, no PR.
- A business owner can disable a department for one business without disabling it globally.
- Adding a NEW ecosystem (e.g. "Veo for video") is a single new adapter file + a registry entry — no department or agent rewiring needed.
- The starter template defines 7 departments any business can spawn out-of-the-box; the future plan describes how custom org-chart arrangement plugs in.

Hard constraints:
- The adapter contract is interface-only — no concrete vendor leaks into department code. Mirrors `lib/llm/provider.ts`'s `getLlm()` pattern but per ecosystem class (video, design, code, voice, image, memory, search, music, …).
- Ecosystem env vars all follow `<ECOSYSTEM>_BASE_URL` + `<ECOSYSTEM>_API_KEY` so a self-hosted swap is one Doppler change.
- Every adapter no-ops when its config is unset — never crash the platform if an optional ecosystem isn't wired.
- Departments inherit the [Operator-gated loop pattern](AGENTS.md#operator-gated-loop-pattern-ralph-loop) and `checkKillSwitch()` rules.

---

## Part 1 — Departments (starter template)

A **department** is a named bundle of:
- A purpose (one sentence).
- A roster of **roles** (each role is one agent spec slot).
- A bound **ecosystem set** (which concrete adapters its roles call).
- An optional **lead** agent that orchestrates the roster.
- Approval gates (which actions need operator sign-off).

A **team** is a department instance for one business. `business_id × department_id → team`.

### The 7 starter departments

| Slug | Purpose | Default roles | Primary ecosystem(s) |
|---|---|---|---|
| `executive` | Set direction, pivot, own KPIs | strategist, decision-maker, board-secretary | LLM |
| `engineering` | Build the product/service | architect, builder, reviewer, tester, deployer | Code, LLM, Memory |
| `design` | Visual identity, UI/UX, brand | brand-strategist, system-builder, layout-architect, visual-renderer, critic, publisher | Design, Image, LLM |
| `content` | Create + distribute content | trend-scout, concept-writer, script-writer, asset-builder, edit-publisher, perf-analyst | Video, Image, Voice, Music, LLM |
| `sales-cs` | Pipeline + retention + support | lead-scorer, outreach-writer, scheduler, account-manager, support | Email, Voice-Agent, LLM |
| `operations` | Finance, compliance, infra | accountant, compliance-checker, infra-monitor, secret-rotator | Workflow, LLM |
| `research` | Competitive intel + customer research | scout, analyst, summariser | Search, LLM, Memory |

Minimum viable business = `executive + content + operations` (3 depts).
Full business = all 7.

Each department has a **canonical spec file** at `.claude/agents/departments/<slug>/_department.md` defining its roles, default ecosystem set, approval gates, and KPI hooks. Concrete agents live at `.claude/agents/departments/<slug>/<role>.md`. Both the lead and the role specs are **ecosystem-agnostic** — they read their bound ecosystem at runtime via the adapter registry.

### Department lifecycle

1. **Spawn** — operator clicks "Add `<dept>` to `<business>`" in `/teams`. Server picks the default ecosystem set for the business's `niche` + `money_model`, inserts a `teams` row + `team_members` rows, mounts the agent specs to the per-business container.
2. **Rebind** — operator swaps an ecosystem ("switch content video provider Higgsfield → Veo"). One DB update; the next dispatch reads the new binding.
3. **Pause / disable** — `teams.status = 'paused'`. Roster stays in DB; no dispatches fire until resumed.
4. **Archive** — `teams.status = 'archived'`. Read-only — preserves the historical configuration for audit.

### Department-level approval gates

Each dept declares its own gates in its spec. Examples:
- `content` → `content_concept`, `content_publish`, `content_creative_brief_change`.
- `engineering` → `merge_to_main`, `deploy_to_prod`, `add_dependency`.
- `design` → `design_brand_direction`, `design_publish`.
- `sales-cs` → `outbound_campaign_start`, `refund_above_threshold`.
- `operations` → `secret_rotation`, `infra_resize`.
- `executive` → `pivot`, `pricing_change` (already exists), `niche_pick` (already exists).
- `research` → (none — purely informational).

---

## Part 2 — Ecosystems (the adapter layer)

An **ecosystem** is a class of capability (video generation, code execution, memory storage, voice synthesis, …). An **adapter** is a concrete implementation of that capability against a specific vendor (Higgsfield video adapter, ElevenLabs voice adapter, …).

### Adapter contract

```ts
// lib/ecosystems/types.ts
export type EcosystemKind =
  | 'llm'         // text generation
  | 'code'        // code authoring / execution
  | 'design'      // UI/UX generation
  | 'video'       // video generation
  | 'image'       // image generation
  | 'voice'       // text-to-speech
  | 'music'       // music generation
  | 'avatar'      // talking-head / UGC
  | 'speech'      // speech-to-text
  | 'memory'      // long-term memory store
  | 'search'      // web search
  | 'browser'     // headless browser / computer use
  | 'workflow'    // visual workflow runner (n8n et al)
  | 'voice-agent' // live phone / WebRTC agent
  | 'doc-parse'   // PDF / OCR / structured extraction

export interface EcosystemAdapter {
  kind:         EcosystemKind
  name:         string                 // "higgsfield", "open-design", "gbrain", …
  available:    () => boolean          // returns false when env vars unset
  capabilities: readonly string[]      // free-form ["render-clip", "render-talking-head"]
  invoke:       (verb: string, payload: unknown) => Promise<unknown>
}
```

Each role spec declares the verbs it intends to call, not the adapter. The router resolves `(team.id, ecosystem.kind) → adapter` and dispatches `adapter.invoke(verb, payload)`. If the bound adapter doesn't implement the verb, the dispatch returns a typed `capability_missing` error and the operator gets a manual-task in the inbox suggesting an ecosystem swap.

### Ecosystem suggestions (starter catalog)

The user asked for other ecosystems to seed. Sorted by category — each row is a candidate adapter we can ship later. Open-source variants flagged `[open]`.

| Kind | Anchor candidates |
|---|---|
| `llm` | Claude (current), GPT, Gemini, Mistral, **Qwen [open]**, **Llama [open]**, **DeepSeek [open]** |
| `code` | Claude Code (current), Codex, Cursor, **Aider [open]**, **Continue [open]**, **OpenHands [open]**, Devin |
| `design` | open-design.ai, Figma AI, Vercel v0, Lovable, Bolt.new, Galileo |
| `video` | Higgsfield (current), Runway, Kling, Pika, Luma, Veo, Sora, Hailuo, **Wan [open]** |
| `image` | Midjourney, **FLUX [open]**, **Stable Diffusion [open]**, DALL-E, Ideogram, Recraft, Imagen, MuAPI |
| `voice` | ElevenLabs (current), OpenAI TTS, Cartesia, **Bark [open]**, Hume, Replica |
| `music` | Suno, Udio, **AudioCraft [open]**, Stable Audio |
| `avatar` | HeyGen (current), Synthesia, D-ID, **SadTalker [open]**, Aragon |
| `speech` | **Whisper [open]**, AssemblyAI, Deepgram |
| `memory` | memory-hq (current), GBrain, H-Mem (planned), **mem0 [open]**, Zep, Letta, LangMem |
| `search` | Tavily (current), Perplexity, Exa, Serper, **SearXNG [open]**, Brave Search, Kagi |
| `browser` | Claude Computer Use, OpenAI Operator, Browserbase, **OpenAdapt [open]**, **Playwright [open]** |
| `workflow` | n8n (current, [open]), Zapier, Make.com, Pipedream, **Activepieces [open]** |
| `voice-agent` | Vapi, Retell, Bland AI, **Pipecat [open]**, Hume EVI |
| `doc-parse` | Unstructured, LlamaParse, **Docling [open]**, Mistral OCR |

We ship v1 adapters only for the highest-leverage cells (the ones the five existing team plans depend on). The rest are "candidates" — adding any one is a single PR.

### Default bindings (by `niche`)

A business's `niche` chooses a default ecosystem-set when a department is first spawned. Stored in `lib/teams/default-bindings.ts`. Operator can rebind any time.

| Niche | Default video | Default design | Default code | Default memory |
|---|---|---|---|---|
| `creator` | higgsfield | open-design | claude-code | memory-hq |
| `ad-agency` | higgsfield | open-design | claude-code | memory-hq |
| `info-product` | higgsfield | open-design | claude-code | memory-hq |
| `saas` | runway | vercel-v0 | claude-code | memory-hq |
| `ecommerce` | higgsfield | open-design | claude-code | memory-hq |
| `personal-brand` | higgsfield | open-design | claude-code | memory-hq |

(All defaults will evolve as the cheaper-or-better-or-faster open adapters land.)

---

## Part 3 — v1 scope (ships this PR)

What's REAL v1 vs aspirational:

| Piece | v1 | post-v1 |
|---|---|---|
| `lib/ecosystems/types.ts` | ✅ full interface | — |
| `lib/ecosystems/registry.ts` | ✅ resolver | — |
| Adapters: higgsfield, open-design, open-code, memory-hq, gbrain | ✅ stub-shaped (no-op when env unset) | flesh out per-verb |
| `lib/teams/` (departments, roles, template, store) | ✅ 7 depts defined, 3 with real role rosters (content, design, engineering) | flesh out remaining 4 |
| Migrations 060 (teams) + 061 (H-Mem stub tables) | ✅ | — |
| `/api/teams` + `/api/teams/spawn` | ✅ basic CRUD | rebind / pause / archive |
| `/teams` admin UI | ✅ list + spawn | rebind ecosystem inline |
| 3 department-lead specs (content, design, engineering) | ✅ | other 4 leads |
| GBrain stub + `memory_walk` MCP returning [] | ✅ | real consolidation crons |
| AGENTS.md + SECRETS.md updates | ✅ | — |

The point of v1 is the **shape** — proves the abstraction holds, proves operator-facing spawn works, and ships enough scaffolding that filling in the rest is mechanical.

---

## Part 4 — Future plan: custom org-chart arrangement

Out of scope for v1; this is the design hand-off for the next initiative.

Owner wants the freedom to rearrange the org chart per business. Required capabilities, ordered by likely demand:

1. **Custom departments** — operator creates `dept:legal` for the consulting business; sets purpose, picks default ecosystem set, defines roles. Stored in `departments` table (not yet created; today the registry lives in code).
2. **Cross-department role borrowing** — the engineering dept's `reviewer` role gets borrowed by the content dept to fact-check articles. Concrete shape: `team_members` row carries an optional `borrowed_from_team_id`.
3. **Inter-department reporting** — content reports to executive, sales reports to executive, etc. Adds `parent_team_id` to `teams`. Drives a `/org-chart` view.
4. **Merged / split departments** — operator merges `sales` + `cs` into `revenue` for a small biz; later splits them back when scaling. Background job re-assigns members, preserves history.
5. **Per-role ecosystem override** — most of the design dept uses open-design, but the brand-strategist uses Vercel v0 because it's better for color systems. `team_members.ecosystem_overrides jsonb` (sparse — defaults to dept binding).
6. **Tool budget per role** — operator forces `content/video-builder` to only use `tools: ['higgsfield']`, overriding the ≥2-tool rule. Tracked as a deliberate budget exception in `team_members.tool_budget_override`.
7. **Org-chart templates** — save a custom arrangement as a template ("the SaaS-startup template"), spin up identical orgs for new businesses with one click.
8. **Time-bounded teams** — `teams.expires_at` — spin up a short-lived "launch week" team that auto-archives after Sunday.

Migration sketch (post-v1):

```sql
alter table teams
  add column parent_team_id   uuid references teams(id) on delete set null,
  add column expires_at       timestamptz,
  add column template_id      uuid references org_templates(id) on delete set null;

alter table team_members
  add column borrowed_from_team_id   uuid references teams(id),
  add column ecosystem_overrides     jsonb default '{}'::jsonb,
  add column tool_budget_override    text[];

create table departments_custom (
  id          uuid primary key default uuid_generate_v4(),
  business_slug text not null,
  slug        text not null,
  purpose     text not null,
  ...
);

create table org_templates (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  niche       text,
  blueprint   jsonb not null,
  created_at  timestamptz not null default now()
);
```

UI for arrangement: a Figma-like canvas at `/teams/org-chart` with drag-drop dept boxes, role rebinding via right-click → "borrow", inline ecosystem swap, save-as-template.

This work fits naturally on top of the v1 abstraction — `teams` + `team_members` are the durable spine. The future plan never needs to touch the adapter registry.

---

## Open questions

- Should `executive` be a department or sit OUTSIDE the dept system as the orchestrator? Current bias: treat it as a department for uniformity (everything's queryable through `teams`), but its scope is "the whole business", not just one functional area.
- How does the existing `business-operator` + `solopreneur-loop` autonomous-cycle pattern map to departments? Hypothesis: each iteration picks the next-best-leverage dept and dispatches into its lead. Validate during content-team smoke test.
- Do roles get versioned? When a role spec ships v2, do existing teams auto-upgrade or stay on v1? Lean toward "stay on v1 until operator approves an upgrade" — protects mid-flight work from breakages.

---

## Phase 3 — Implement (covered by the v1 scope table above)

After v1 ships:
- Backfill any in-flight businesses with default dept memberships (one-shot script).
- Add a memory-hq atom describing the abstraction so future agents querying "how do I add a new ecosystem" land on this plan instantly.
- Write a runbook `docs/runbooks/teams-and-ecosystems.md` covering: spawn, rebind, pause, custom dept (future).

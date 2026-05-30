# task_plan — 2026-05-30 operator brain-dump (consolidated)

> **Provenance:** distilled by a 15-agent absorption workflow (explore→synthesize→master) from the operator brain-dump captured 2026-05-30. Every sub-plan EXTENDS a named shipped surface — none forks. Sibling to `task_plan-2026-05-27-brain-dump.md`.
> Status legend: 🚀 ready to ship · 📋 scoped/deferred · 🔬 research-only.

## North Star (whole initiative)

Goal: Absorb the operator brain-dump into the platform by extending existing plans/surfaces — a unified model-resolution chain, memory observability, durable chat, a learning curriculum, and gamified life-OS seeds — without forking any shipped system.
Success criteria: (1) every idea maps to a named existing surface it extends; (2) Wave-1 foundations ship green on `npm run check:all` + Playwright (desktop+mobile); (3) the operator's feedback questions are answered in code, not prose. 
Hard constraints: provider-agnostic (no model-version pins in spec prose); fail-soft on every dispatch path; retry-storm rule on all touched routes (200+`{ok:false}`); memory-hq stays canonical, `mol_*` derived; one resolver seam (`lib/ai/dispatch.ts`), never a parallel one.

---

## Direct answers to operator feedback questions

_Each answer was traced to the actual code by an explore agent; file:line references are verbatim from that trace._

### Memory / Akashic Record

**Q: Does H-Mem use Postgres, and what is built vs stubbed?**

YES — Postgres (Supabase). mol_temporal_node + mol_edge are live (migrations 061/062/064/065, confirmed by reading 061 + 065). Both consolidation crons (hmem-consolidate, hmem-extract-edges), /api/memory/walk BFS, the memory_walk MCP tool, the pending-edges approval UI, and the 50-question eval suite all shipped. STUBBED: lib/ecosystems/adapters/memory-hq.ts returns {path:[],hint:'stub'} for walk/timeline and {stub:true} for atom_write/search/query over endpoints that already work; memory_timeline has no endpoint/tool; supersession chain is unpopulated. The 'stub_tables' filename in 061 is now a misnomer — live crons fill the tables.

**Q: Is gbrain-integration the Graphify dual-store the operator described?**

NO. gbrain (task_plan-gbrain-integration.md, lib/ecosystems/adapters/gbrain.ts) is a candidate THIRD-PARTY backend (Y Combinator's self-wiring layer) being A/B-benchmarked against memory-hq by app/api/cron/gbrain-bench/route.ts. The strings graphify/obsidian/dual-store appear in none of the three memory plans. GBrain != Graphify — but the gbrain-bench harness is exactly the rig to evaluate ANY 'should we add store X' question (including Graphify) with zero new infra.

**Q: How would memory_* calls be surfaced on /audit?**

Two small additive changes, no new infra. (1) Wrap each handler in services/mcp-memory/src/index.ts with withToolCallAudit({mcp_server:'memory-hq', tool_name, agent_slug}) from lib/audit/tool-call.ts — confirmed signature withToolCallAudit(meta, fn). This is the ONLY admin MCP server not already wrapped; once wrapped, memory calls flow into tool_call_audit and appear instantly in the existing tools/mcp/errors panes. (2) Add ONE declarative source to lib/audit/sources.ts filtered to mcp_server='memory-hq' for a dedicated Memory pane — the file's docstring confirms 'Adding a pane = one entry here, not a new component.'

**Q: Is the ecosystem structure already modelled as a graph?**

PARTIALLY — node TYPES exist (lib/graph/types.ts: agent/tool/skill/workflow) but lib/graph/builder.ts buildMockGraph() (lines 143-308) HARDCODES agent-1/tool-1/biz-1 mock data; only memory-builder.ts reads real data. Real registries exist but are siloed (agent_library, sub_harnesses migration 097, lib/ecosystems/registry.ts, .claude/skills/*/SKILL.md) with no indexer cross-linking them. CRITICAL: mol_edge CHECK (061 line 51-52) limits src/dst_kind to atom|entity|temporal, so H-Mem cannot hold agent->tool edges today. This is the headline genuine build.

**Q: Does a Graphify+Obsidian dual-store add anything not already covered?**

NO — DECLINE. Nexus already runs the exact best-of-both architecture: Obsidian-style markdown = pinnacleadvisors/memory-hq (canonical, git-versioned, [[wikilinks]]); graph-DB = the Supabase mol_* mirror (pgvector + FTS + mol_edge + mol_temporal_node, traversed by /api/memory/walk). Kept consistent ONE-WAY (markdown->DB) by app/api/cron/sync-memory/route.ts with a reconcile replay — strictly SAFER than a true dual-WRITE store because there's exactly one source of truth, so the two cannot silently diverge. Auto-wiring (Graphify's selling point) already exists as hmem-extract-edges + the pending-edges gate. Adding a dual-store duplicates memory-hq+mol_* and reintroduces the divergence risk the one-way mirror was designed to avoid. Spend effort on the two real gaps instead; if the operator still wants to A/B a graph-native store, point it at gbrain-bench, don't integrate blind.

### AI providers · model routing · qa-runner

**Q: (1) Does the per-agent model assigned in /settings/agents (Agentdex) OVERRIDE the ACTIVE LLM PROVIDER in the AI Providers tab? Trace the actual resolution order in lib/llm/provider.ts.**

No — and the two axes never meet at runtime, confirmed by reading both files. lib/llm/provider.ts resolveProvider() (lines 48-75) resolves only a PROVIDER FAMILY (claude|openrouter|mimo|ollama|nim) in order: opts.provider arg > ai_provider_active DB row (getActiveProviderSync, source:'db') > LLM_PROVIDER env > hard 'claude'. It is reached ONLY by AI-SDK callers via getLlm() (line 85). The Agentdex per-agent model (agent_library.model) is a different axis — a model id — and is NOT an input to provider.ts at all. Worse: agent_library.model is never read by any dispatch path. Confirmed grep — the only runtime reader is lib/claw/plan-window.ts:51 (weightForModel for cost accounting) and lib/agents/registry.ts:92 (parsing the spec). app/api/claude-session/dispatch/route.ts reads inject_platform_brief (line 491) but never .model; the gateway --model (services/claude-gateway/src/spawn.ts:124 `cliArgs.push('--model', args.model)`) comes from body.model set by the chat composer (lib/chat/models.ts) or hardcoded 'claude-sonnet-4-6' by the n8n strategist (route line 226 in persistAgentToLibrary). So today the Agentdex per-agent model overrides NOTHING at dispatch — it is a display + cost-weighting value. The operator's mental model ('the model I set per agent should win') is false in code; closing that is Task PR1+PR2 below.

**Q: (2) Is the operator-desired chain (agent/skill model → Claude gateway → Codex gateway → API key → error) already implemented? If not, what is the current order and what must change?**

Not as one chain — it is split across two resolvers and the agent/skill-model tier is entirely missing. Current reality from reading the code: callClaude() (lib/claw/llm.ts:71-170) does kill-switch > Claude-gateway (when configured AND isGatewayHealthy) > Anthropic-API-key (unless CLAUDE_MAX_ONLY=1) > error — no agent-model awareness, no Codex tier. Codex is reached only in app/api/claude-session/dispatch/route.ts:517 via shouldRouteToCodex(body.model) (lib/claw/codex-gateway.ts:32 — true only when model startsWith gpt|codex), a SEPARATE branch, not a fallback. The closest thing to the desired multi-gateway chain is app/api/qa/dispatch-fix/route.ts (claude-gateway > codex-gateway > AI-SDK), but it reads provider from body.provider/LLM_PROVIDER, not from a per-agent model. To get the exact order: (i) add a NEW top tier — resolveEffectiveModel(agentSlug, skillSlug, bodyModel) that reads agent_library.model / skill_overrides (lib/skills/overrides.ts ALREADY exists) and maps id→family via getModelById(id).provider; (ii) make callClaude + the dispatch route consult that effective model+provider FIRST, then Claude gateway, then Codex gateway, then API key, then error; (iii) wire agent_library.model into the dispatch route so an absent body.model falls back to the agent's stored model before spawn.ts. Real gap, ~2 focused PRs, lands on the lib/ai/dispatch.ts seam from task_plan-model-agnostic-chat.md Task M2 — NOT as a third resolver.

**Q: (3) Is qa-runner an AGENT (would it appear in Agentdex) or just the docker that runs the platform-dev-loop agent?**

qa-runner is a Docker HARNESS, not an agent. services/qa-runner/src/index.ts is a Hono HTTP server that on a signed POST /run mints a Clerk bot ticket, spawns `npx playwright test` (runSpec.ts), and on failure POSTs a fix-attempt brief to /api/qa/dispatch-fix targeting the nexus-tester / workflow-optimizer AGENTS (dispatch.ts default agentSlug 'workflow-optimizer'). There is no .claude/agents/qa-runner.md, no agent_library row, no model field — so it would NOT appear in Agentdex and has no per-agent model of its own. In the h2–h5 harness taxonomy it is an h5 verification primitive (the grader); the model used for the FIX is whatever the targeted agent + /api/qa/dispatch-fix resolves. This is why it inherits the operator's chain for FREE once the unified resolver lands (Task PR1) — qa-runner needs zero changes. The operator-visibility gap ('what model does qa-runner fix on?') is closed by surfacing the resolved chain in /api/gateway-status (Task PR6).

**Q: (4) Are NVIDIA NIM, Gemini 2.5, and Ollama already provider cards? (NIM was scoped in the brain-dump — check status.)**

Mixed, confirmed by reading lib/ai/providers.ts, lib/llm/provider.ts, lib/models/catalog.ts and lib/llm/providers/nim.ts. (a) NIM: NOT an AI_PROVIDERS card and has NO MODEL_CATALOG rows, BUT it is a first-class LLM_PROVIDER family — nim.ts is LIVE (real createOpenAI wrapper at integrate.api.nvidia.com, not a stub), 'nim' is in the LlmProvider union (provider.ts:26), the resolveProvider whitelist (lines 64-71), and the ActiveProviderSwitch OPTIONS (ActiveProviderSwitch.tsx, ready:true). So NIM is selectable as the active AI-SDK provider but invisible to Agentdex/recommender. The brain-dump marks it 'ready to ship' but the adapter already shipped — only the card + catalog rows remain (Task PR3+PR4). (b) Gemini 2.5: YES as a card (lib/ai/providers.ts 'google', api mode, GOOGLE_API_KEY) AND in MODEL_CATALOG (gemini-2.5-pro, gemini-2.5-flash). But 'google' is NOT a getLlm() runtime family — catalog/recommender-visible, not yet a runtime AI-SDK target except via OpenRouter slugs (Task PR4 adds the runtime family). (c) Ollama: an LLM_PROVIDER family (ollama.ts adapter) and in ActiveProviderSwitch OPTIONS (ready:false stub), but NOT an AI_PROVIDERS card and NO catalog rows (Task PR3+PR4).

**Q: (5) Is the ACTIVE LLM PROVIDER switch still needed, or could a default model set in Agentdex replace it (esp. for what qa-runner uses)?**

They solve different problems; KEEP the switch but demote+relabel it — do not delete. The switch picks the GLOBAL AI-SDK provider family for callers with NO per-agent context (chat fallback, qa-runner fix-attempts via dispatch-fix, skill-trainer) — it is the ONLY lever for 'route ALL context-free fallback traffic through NIM/OpenRouter to save money', which a per-agent model cannot express (its own help text at ActiveProviderSwitch.tsx confirms this scope). qa-runner specifically does NOT use the switch via a model — dispatch-fix reads LLM_PROVIDER/body.provider, and the FIX model is the targeted agent's concern. Recommended consolidation (a synergy, not a delete): once agent/skill-model-first resolution lands (Q2), the per-agent/per-skill model becomes the PRIMARY selector; the Active switch demotes to 'Global default provider for context-free AI-SDK calls' (relabel — Task PR7). Deleting it would remove the only zero-redeploy way to flip the whole platform to a $0-marginal provider (the NIM background-task use case). Verdict: stays, relabelled, scoped as the fallback-only default.

**Q: (6) Why does the per-agent model dropdown only show Claude models, and where is the catalog/list it reads from?**

Root cause is the provider-detection filter, not the catalog — confirmed in components/settings/AgentList.tsx. The dropdown options = MODEL_CATALOG.filter(m => providers.includes(m.provider)) (AgentList.tsx:77-80). MODEL_CATALOG (lib/models/catalog.ts) ALREADY contains gpt-5.5, gemini-2.5-pro/flash, grok-4, deepseek-v3.5, etc. The 'providers' array (AgentList.tsx:51-67) is built from /api/gateway-status (which only ever adds 'anthropic' — it returns codexConfigured/openrouterConfigured booleans that AgentList IGNORES) PLUS /api/connected-accounts (adds 'google','openai',... ONLY when an ACTIVE connected_accounts api-key row exists). In lean-mode the operator has the Claude gateway but no connected_accounts API-key rows, so providers=['anthropic'] and the filter collapses to the 3 Claude models. Single highest-leverage UI fix (Task PR5): make AgentList consume gateway-status.codexConfigured → add 'openai', openrouterConfigured → treat the openrouter-reachable models as available, AND env-key providers (GOOGLE_API_KEY etc.) + the active LLM_PROVIDER family. This unlocks the whole multi-provider Agentdex the recommender was built for.

---

## Consolidated Index — operator brain-dump absorption (2026-05-30)

Status legend: 🚀 ready to ship · 📋 scoped/deferred · 🔬 research-only. Every sub-plan EXTENDS named shipped surfaces — none forks. Anchors below are GitHub-style slugs for the per-sub-plan sections in the companion sub-plan files.

1. 🚀 **Providers-Routing-QA** — [#providers-routing-qa](#providers-routing-qa)
   One ordered dispatch-time resolver (agent/skill model → Claude gateway → Codex gateway → API key → error) on the `lib/ai/dispatch.ts` seam; wires the already-stored `agent_library.model` + `skill_overrides` (`lib/skills/overrides.ts`) into `spawn.ts --model` (supported at `services/claude-gateway/src/spawn.ts:124-125`, never fed today); adds NIM/Gemini-runtime/Ollama catalog rows + cards; fixes the lean-mode `AgentList.tsx:54-56` Claude-only collapse; ships smart-routing as opt-in recommender-at-dispatch (h4). **Foundational — most other sub-plans wait on its resolver + available-providers endpoint.**

2. 🚀 **Akashic Record** — [#akashic-record](#akashic-record)
   Extends the SHIPPED H-Mem (`mol_temporal_node`/`mol_edge`, migration 061) with a structural-ecosystem graph (agents/skills/harnesses/tools/mcp/benchmarks as `mol_edge` nodes): widens the `mol_edge_kind_check` CHECK (`061_hmem_stub_tables.sql:51-52`), replaces the mock block in `lib/graph/builder.ts:143-308`. Surfaces `memory_*` MCP calls on `/audit` by adding one `lib/audit/sources.ts` entry + wrapping `services/mcp-memory/src/index.ts` handlers in `withToolCallAudit` (`lib/audit/tool-call.ts`). Thread C = a VERDICT declining the Graphify+Obsidian dual-store (memory-hq already is it). Finishes the stubbed `lib/ecosystems/adapters/memory-hq.ts` facade.

3. 🚀 **Durable Chat + Persistent Notifications** — [#durable-chat-persistent-notifications](#durable-chat-persistent-notifications)
   Detaches the MAIN chat turn so it survives tab/app close: persist `jobId` at enqueue, a `BOT_API_TOKEN`-authed reconciler (new `kind='chat-turn-drain'` row on the SHIPPED `background_tasks` table, migration 053) drains in-flight gateway jobs (`getGatewayJob`) to `chat_messages` independent of any browser via `persistCompletedTurn` (`lib/chat/persist-completed-turn.ts:192`) + fires `notifyOperator` (`lib/notifications/dispatch.ts:107`). Errors land in a DB-backed notification center in `/inbox`. Pure assembly — closes `task_plan-sse-streaming.md` pitfall #5 ("gateway job continues server-side after client closes").

4. 🔬→🚀 **Learning Interleaving** — [#learning-interleaving](#learning-interleaving)
   Appends **Phase 24** to the SHIPPED `task_plan-learning-system.md` (no new plan file): a `concept` CardKind teaching how LLMs/harness h2-h5/skills work (widens the `kind` CHECK at `023_learning_system.sql:15` + `CardKind` at `lib/types.ts:457`), a difficulty-aware upgrade to the round-robin `interleave()` at `app/api/learn/session/route.ts:68-88`, and a research treatment of self-distilled reinforcement that CITES `skill-trainer` + sub-harness synthesize-mode (does not re-invent).

5. 📋 **Gamify-LifeOS** — [#gamify-lifeos](#gamify-lifeos)
   Accomplishments page (🚀 ready-ish): pure-read consumer that widens the `fleet/route.ts` `payloadUsd()` + `experiment_metrics` kind=revenue/cash_spend 24h aggregate to all-time, tiered achievements + level-gated live-event hook; reuses `DailyStreak` (`lib/types.ts:537`) + `StreakBadge`/`CalendarHeatmap` (NO second XP engine), `CoachingCard`, Sidebar `BASE_NAV:157-169`. Health as the first LifeOS `life_domain` (📋 vision): extends `lib/teams/departments.ts` + `task_plan-departments-and-ecosystems.md` with a non-revenue domain entity.

6. 📋 **Settings UX parity** — [#settings-ux-parity](#settings-ux-parity)
   Brings Settings → Skills to full Agentdex parity (manual model dropdown + Recommend-all, mirroring the shipped `AgentList.tsx`/`AgentListHeader.tsx`), adds Connectors-style Create cards (reusing the `describe→classify→route` primitive from `task_plan-connector-intent.md`) to both tabs, and makes both model dropdowns dynamic from `detectAvailableProviders` (`lib/models/providers.ts:27`). **Hard-blocked** on sub-plan 1's canonical available-providers endpoint. Land as "Phase 18" of `task_plan-redesign-ai-providers.md` or sibling `task_plan-settings-ux-parity.md`.

7. 📋 **Local-First Hosting** — [#local-first-hosting](#local-first-hosting)
   Mac Mini runs the lean-mode bundle locally as observation + high-autonomy-sandbox host beside KVM4. Extends `task_plan-desktop-app.md` (Phase 7 full-bundle Mac compose on the shipped `docker-compose.local.yaml`/`LOCAL_MODE`/`apps/desktop`; Phase 8 high-autonomy lane) + `task_plan-lean-mode.md` (reuses `services/lean-deploy/`, `services/nexus-sandbox/`, `scripts/migrate-to-lean-kvm.mjs`). New ADR overturns ADR 002's laptop rejection (`docs/adr/002-codex-gateway-sandbox.md:31`) for an always-on Mini. Topology paragraph + `[[mocs/platform-topology]]` infra-change atom updated in the SAME PR that flips any host role. Net-new high-autonomy lane is the risky part → deferred.

---

## Dependency-Sequenced Roadmap — Waves

The hard ordering constraint is the `lib/ai/dispatch.ts` resolver seam (sub-plan 1): it does NOT exist yet (confirmed — it's Task M2 of `task_plan-model-agnostic-chat.md`), and three other sub-plans either consume its output (Settings dropdown) or share its substrate (model-agnostic-chat). Akashic's audit thread + Durable Chat are independent and can run in parallel from day one. Ship in four waves.

### Wave 1 — Foundations (parallelizable, no inter-Wave-1 blockers)
- **🚀 Providers-Routing-QA (sub-plan 1)** — BUILD/extend `lib/ai/dispatch.ts` as the ordered resolver AND expose the canonical `GET available-providers` endpoint. This is the critical-path blocker: it gates Settings UX (Wave 3) and shares the seam with `task_plan-model-agnostic-chat.md` M2. Start here. Internal order: (a) resolver reads `agent_library.model` + `skill_overrides` → `spawn.ts --model`; (b) catalog rows + provider cards for NIM/Gemini/Ollama; (c) fix `AgentList.tsx:54-56` Claude-only collapse; (d) opt-in smart-routing (recommender-at-dispatch, h4) LAST.
- **🚀 Akashic Record — Thread B only (audit observability)** — wrapping `services/mcp-memory/src/index.ts` in `withToolCallAudit` + one `lib/audit/sources.ts` entry depends ONLY on shipped `tool_call_audit` (migration 058) + the shipped `/audit` route. Zero dependency on Wave 1's resolver. Run concurrently.
- **🚀 Durable Chat + Persistent Notifications (sub-plan 3)** — substrate (`background_tasks` 053, `persist-completed-turn.ts`, `getGatewayJob`, `notifyOperator`, `authBotToken`) is ALL shipped. Independent of every other sub-plan. Coordinate only loosely with `task_plan-sse-streaming.md` (shared `persist-completed-turn.ts` seam — SSE = live-while-attached, this = persist-while-detached; non-conflicting). Run concurrently.

### Wave 2 — Graph + Learning (depend on Wave 1 partially / on shipped surfaces)
- **🚀 Akashic Record — Threads A + C** — Thread A (widen `mol_edge_kind_check` `061:51-52`, replace `lib/graph/builder.ts:143-308` mock, finish `lib/ecosystems/adapters/memory-hq.ts`). SOFT-depends on Wave 1: the structural-ecosystem graph nodes (agents/skills/tools) are most useful once the resolver makes agent/skill→model a live edge, but Thread A can land on shipped H-Mem independently if Wave 1 slips. Thread C (Graphify/Obsidian VERDICT) is a doc decision — land anytime, no code dep.
- **🔬→🚀 Learning Interleaving (sub-plan 4)** — appends Phase 24 to shipped `task_plan-learning-system.md`. The concept-curriculum CardKind teaches harness h2-h5 + how LLMs/skills work; its curriculum SOURCE is richest after Wave 1 lands the provider/routing concepts and after Akashic Thread A exposes the ecosystem graph (concepts can cite live `mol_edge` nodes). Difficulty-aware `interleave()` upgrade has no external dep → can ship the moment Phase 24 opens. Self-distill axis is research-only (cites `skill-trainer` + sub-harness synthesize), no ship dependency.

### Wave 3 — UX parity (HARD-blocked on Wave 1)
- **📋 Settings UX parity (sub-plan 6)** — the dynamic model dropdown on BOTH Agents + Skills tabs requires sub-plan 1's canonical `detectAvailableProviders`-backed available-providers endpoint (Group C of sub-plan 1). **Do NOT start the dropdown work before Wave 1 ships that endpoint** — otherwise it re-hardcodes the Claude-only set it's meant to delete (`AgentList.tsx:54-56`). The Skills-mirrors-Agents parity + Create cards (reusing `connector-intent` describe→route) CAN be scaffolded against the shipped `AgentList`/`skill_overrides`, but final wiring waits on Wave 1. Deferred (📋) regardless of Wave 1 timing — it is polish, not unblocking.

### Wave 4 — Infra (independent, deferred on risk not dependency)
- **📋 Local-First Hosting (sub-plan 7)** — purely additive to KVM4; reuses shipped `LOCAL_MODE`/`docker-compose.local.yaml`/`services/lean-deploy`/`services/nexus-sandbox`. No code dependency on Waves 1-3. Deferred because (a) the high-autonomy whole-machine lane is net-new and risky, and (b) it needs an ADR overturning ADR 002's laptop rejection (`docs/adr/002:31`). Week-1 slice (full-bundle Mac compose + local sandbox + desktop window) is shippable any time; the gated autonomy lane + Ollama activation is the month-1 ADR-gated tail. Ollama activation here also closes the loop with Wave 1's Ollama catalog card — sequence Ollama-on-Mini AFTER sub-plan 1 adds the Ollama provider so the card has a live target.

### Blocker summary (explicit)
- **dispatch.ts resolver (sub-plan 1) BLOCKS:** the dynamic provider dropdown in Settings UX (sub-plan 6, Wave 3); shares its seam with `task_plan-model-agnostic-chat.md` M2 (coordinate, don't fork).
- **Shipped H-Mem (migration 061) is a PREREQ already met** for Akashic Thread A — no wait.
- **Shipped audit substrate (migration 058 + `/audit`) is a PREREQ already met** for Akashic Thread B — no wait.
- **Durable Chat + Akashic-Thread-B block NOTHING** — they are leaf consumers; ship them first to bank wins while Wave 1 lands.
- **Ollama provider (sub-plan 1) SOFT-BLOCKS** Local-First Ollama activation (sub-plan 7) — order Ollama-on-Mini after the card exists.

---

## Cross-cutting concerns (shared seams multiple sub-plans touch)

1. lib/ai/dispatch.ts — THE shared seam. Built fresh by Providers-Routing (sub-plan 1) AND is Task M2 of task_plan-model-agnostic-chat.md. Settings UX (6) consumes its available-providers output. One team must own this file or the two plans collide. Confirmed missing today (grep returned nothing) — it is the highest-leverage single file in the whole absorption.

2. Provider/model catalog surface — lib/models/catalog.ts + lib/models/providers.ts (detectAvailableProviders:27) + lib/models/recommender.ts (recommendModelForAgent:158) are touched by Providers-Routing (rows+cards+smart-routing), Settings UX (dynamic dropdown + Recommend-all), and indirectly by Akashic (benchmarks as mol_edge nodes). Single registry — extend rows, never fork the catalog.

3. agent_library.model + skill_overrides (lib/skills/overrides.ts) — the per-agent/per-skill model pick is STORED but never read at dispatch (spawn.ts:124-125 supports --model but nothing feeds it). Providers-Routing wires the read path; Settings UX writes via the same PATCH/DELETE /api/skills/[slug]. Shared write+read contract.

4. lib/chat/persist-completed-turn.ts (:192) — the canonical turn-persistence seam shared by task_plan-sse-streaming.md (live-while-attached) and Durable Chat (persist-while-detached). Both must converge on this ONE function; do not add a parallel persistence path.

5. background_tasks table (migration 053) + lib/background-tasks/dispatch.ts + BOT_API_TOKEN dispatch route — reused as the reconciler substrate by Durable Chat (new kind='chat-turn-drain' row, NOT a new job runner). The same lifecycle backs collaborative-chat Phase 4.

6. notifyOperator() (lib/notifications/dispatch.ts:107) + webpush (lib/notifications/webpush.ts) + wake() — one notification entry point reused by Durable Chat (error/turn-done category) and Gamify-LifeOS (achievement category). Each new feature adds ONE NotificationCategory, never a parallel channel.

7. tool_call_audit table (migration 058) + lib/audit/sources.ts + lib/audit/tool-call.ts withToolCallAudit + the /audit route — the observability spine. Akashic Thread B adds memory_* MCP visibility; any future agent-call surface lands as one sources.ts entry, not a new component.

8. Gamification primitives — DailyStreak (lib/types.ts:537) + StreakBadge + CalendarHeatmap + learn/stats render pattern. Gamify-LifeOS Accomplishments MUST reuse these; building a second XP/streak engine is the failure mode the brain-dump explicitly warns against.

9. experiment_metrics / revenue_events aggregation — fleet/route.ts payloadUsd() + kind=revenue/cash_spend sum is the single revenue-truth extractor. Gamify Accomplishments is a pure-read consumer widening the 24h window to all-time; partitioned by business_slug like every other table. Do not re-derive revenue.

10. Harness h2-h5 taxonomy as a CURRICULUM + a placement axis — Learning Interleaving teaches h2-h5 as concept cards; Providers smart-routing is declared h4 (trajectory regulation); sub-harness synthesize-mode is h5. The taxonomy (AGENTS.md + memory/molecular/mocs/agent-framework-survey.md) is both the learning content source AND the layer-placement contract every new hook/skill must self-declare against.

11. Topology / memory-hq provenance discipline — Local-First (host-role flip) and any infra touch require updating the AGENTS.md Topology paragraph + a [[mocs/platform-topology]] infra-change atom in the SAME PR (per Post-infrastructure-change protocol). Akashic's structural graph and Learning's curriculum both read from memory-hq as canonical; mol_* Supabase is the fast-read mirror only.

12. describe→classify→route primitive (app/api/connected-accounts/describe/route.ts + AccountList DescribeConnectionCard from task_plan-connector-intent.md) — reused by Settings UX Create cards on BOTH Agents and Skills tabs. One intent primitive, three call sites; do not fork per-tab.

13. Provider-agnostic invariant (npm run check:provider-agnostic) — Providers-Routing adds 3 new providers, Learning adds concept cards naming models, Local-First activates Ollama. None may hard-pin a model version in prose; the agent-frontmatter model: field is the only allowed pin. The check gates every one of these PRs.

---

# Sub-plans (full)

## 🚀 Akashic Record — ecosystem H-Mem structural index + audit observability

**Status:** 🚀 ready (Threads A+B), 🔬 verdict (Thread C). Extends `task_plan-hmem-architecture.md` — builds ON the shipped `mol_temporal_node`/`mol_edge`/`memory_walk`, never re-specs them.

> **North Star**
> **Goal:** Make the whole ecosystem (agents · skills · sub-harnesses · tools · MCP servers · benchmarks) a queryable structural graph layered on the already-shipped H-Mem, and let the operator watch every memory call on `/audit` — without adding a new store.
> **Success criteria:**
> - `mol_edge` can hold `agent→uses→tool`, `skill→extends→harness`, `harness→tests→benchmark` edges; `memory_walk` traverses them with zero endpoint changes.
> - `/graph` renders REAL agents/skills/harnesses/tools/benchmarks (mock block in `lib/graph/builder.ts` gone).
> - Every `memory_atom`/`memory_search`/`memory_walk` MCP call lands in `tool_call_audit` and shows on `/audit`.
> - A written verdict on Graphify+Obsidian dual-store (recommend/decline) grounded in what `memory-hq` already is.
> **Hard constraints:** memory-hq GitHub repo stays canonical; `mol_*` stays derived. Structural-edge extraction gates on `checkKillSwitch()` + the migration-065 pending_approval gate (no unbounded self-mutation). Provider-agnostic (no model pins in prose). All migrations idempotent. No regression to `memory_search`/`memory_query`.

### Why
The "Akashic Record" is ~70% built across three live systems. The operator's asks map onto **two real gaps + one decision**, not a rebuild: (a) H-Mem models only `atom|entity|temporal` — it cannot hold the ecosystem's own structure; (b) `mcp-memory` is the only admin MCP server not wired to `tool_call_audit`, so memory flow is invisible; (c) the pasted Graphify+Obsidian dual-store already exists as `memory-hq` (markdown) + `mol_*` (graph-DB), so adding it duplicates infra.

### Absorbs into (exact paths)
- `task_plan-hmem-architecture.md` — parent; this is its structural + observability extension.
- `supabase/migrations/061_hmem_stub_tables.sql` (CHECK lines 51-52) · `lib/graph/builder.ts` (mock lines 143-308) · `lib/graph/types.ts` · `lib/audit/sources.ts` · `services/mcp-memory/src/index.ts` · `lib/audit/tool-call.ts` · `lib/ecosystems/adapters/memory-hq.ts` · `app/api/memory/walk/route.ts`.
- Decision rig already exists: `app/api/cron/gbrain-bench/route.ts` + `scripts/eval-memory.mjs`.

### Scope
IN: widen `mol_edge` kind constraint; a registry indexer cron; real graph builder; one audit pane + mcp-memory audit wrap; finish the memory-hq adapter facade; the ADR verdict. OUT (defer): `memory_timeline` endpoint, supersession matcher, memory-pack auto-injection (named in parent plan, not this one); any Graphify integration.

---

### Thread A — structural ecosystem index (extends H-Mem)

**Task A1 — widen mol_edge kind constraint**
- File: `supabase/migrations/098_mol_edge_structural_kind.sql` (new)
- Change: `drop`/`add` `mol_edge_kind_check` to allow `src_kind`/`dst_kind` in `('atom','entity','temporal','structural')` and `source_check` to add `'indexer'`; idempotent.
- Verify: re-run twice clean; insert an `agent→tool` row with `src_kind='structural'` succeeds.

**Task A2 — structural-node id convention doc**
- File: `lib/graph/structural-id.ts` (new)
- Change: export `structuralId(kind,slug)` → `"struct:<kind>:<slug>"` (e.g. `struct:agent:loop-runner`) so structural nodes never collide with `<scope>:<slug>` atom ids.
- Verify: `npx tsc --noEmit`; unit asserts round-trip parse.

**Task A3 — registry reader: agents + harnesses**
- File: `lib/graph/ecosystem-index.ts` (new, ≤120 lines)
- Change: read `agent_library` (via `lib/agent-registry.ts`) + `sub_harnesses` (migration 097, `lib/harness/manifest.ts`) into `{nodes,edges}` with `agent→extends→harness` edges.
- Verify: `npx tsc --noEmit`; node logs N agent + M harness nodes against a seeded DB.

**Task A4 — registry reader: tools/MCP + skills + benchmarks**
- File: `lib/graph/ecosystem-index.ts` (extend)
- Change: add `lib/ecosystems/registry.ts` adapters (tool/mcp nodes), `.claude/skills/*/SKILL.md` (skill nodes), `simulation_benchmarks` + `tests/memory` (benchmark nodes); edges `agent→uses→tool`, `skill→extends→harness`, `harness→benchmarked_by→benchmark`.
- Verify: `npx tsc --noEmit`; counts > 0 for each kind.

**Task A5 — indexer cron writes structural mol_edge**
- File: `app/api/cron/ecosystem-index/route.ts` (new)
- Change: call `ecosystem-index.ts`, UPSERT structural nodes/edges into `mol_edge` with `source='indexer'` (bypasses pending gate — deterministic, not LLM); returns 200 + `{ok}` always (cron-check rule).
- Verify: `npm run check:cron-route`; after run, `/api/memory/walk?start_id=struct:agent:loop-runner` returns a path.

**Task A6 — register the cron**
- File: `scripts/sync-crons-hmem.mjs` (extend)
- Change: add `ecosystem-index` daily (~04:45, after extract-edges).
- Verify: dry-run prints the new job in the sync set.

**Task A7 — real graph builder (kill the mock)**
- File: `lib/graph/builder.ts`
- Change: in `buildGraph()`, after the memory-builder branch, merge `ecosystem-index.ts` reads (agents/skills/harnesses/tools/benchmarks as real nodes); delete `buildMockGraph()` (lines 143-308) and its fallbacks.
- Verify: `/api/graph` returns real agent slugs (e.g. `loop-runner`), no `agent-1`/`Acme SaaS`.

**Task A8 — graph node types for harness/benchmark**
- File: `lib/graph/types.ts`
- Change: add `'sub_harness'` + `'benchmark'` to `NodeType`, `'benchmarked_by'`+`'binds'` to `EdgeRelation`, colours/labels.
- Verify: `npx tsc --noEmit`.

### Thread B — audit observability (memory flow on /audit)

**Task B1 — wrap mcp-memory handlers in audit**
- File: `services/mcp-memory/src/index.ts`
- Change: wrap each tool branch in `CallToolRequestSchema` with `withToolCallAudit({mcp_server:'memory-hq', tool_name:name, agent_slug:process.env.MEMORY_AUTHOR}, () => …)` from `lib/audit/tool-call.ts` (signature confirmed: `(meta, fn)`).
- Verify: a `memory_search` call inserts a `tool_call_audit` row with `mcp_server='memory-hq'`.

**Task B2 — Memory pane on /audit**
- File: `lib/audit/sources.ts`
- Change: append one `AuditSource` `{id:'memory', kind:'realtime-table', table:'tool_call_audit', read:{eq:{field:'mcp_server',value:'memory-hq'}}, columns:[ts, tool_name, agent_slug, result_status, latency_ms]}` (mirror the `tools` pane shape, lines 94-113).
- Verify: `/audit` shows a Memory tab streaming memory calls; `npx tsc --noEmit`.

**Task B3 — pending-edges pane (watch new LLM/structural edges)**
- File: `lib/audit/sources.ts`
- Change: add a second source `realtime-table` on `mol_edge` filtered `pending_approval=true` so the operator watches edges arrive before approving via `/memory/pending-edges`.
- Verify: pane lists pending rows after `hmem-extract-edges` runs.

### Thread C — finish facade + Graphify verdict

**Task C1 — un-stub the memory-hq adapter**
- File: `lib/ecosystems/adapters/memory-hq.ts`
- Change: route `memory_walk`/`memory_search`/`memory_query`/`atom_write` to the live `/api/memory/walk` + `/api/memory/*` endpoints (delete the `hmem_stub`/`stub` early-returns, lines 40-59); keep `memory_timeline` returning a typed "not-yet" until its endpoint lands.
- Verify: `ecosystem_invoke kind=memory verb=memory_walk` returns a real path, not `{path:[]}`.

**Task C2 — Graphify+Obsidian decision ADR**
- File: `docs/adr/010-graphify-obsidian-dual-store.md` (new, ≤80 lines)
- Change: record DECLINE — `memory-hq` (markdown) + `mol_*` (graph-DB) already IS the dual-store, kept one-way-consistent by `app/api/cron/sync-memory/route.ts` (safer than dual-write: one source of truth, no silent divergence); auto-wiring already exists as `hmem-extract-edges` + pending-edges gate. If re-raised, A/B via `gbrain-bench`, not blind integration. Index in `docs/adr/INDEX.md`.
- Verify: ADR renders; INDEX one-liner added.

**Task C3 — memory atom on the structural index**
- File: memory-hq via `memory_atom` MCP
- Change: write one atom "Ecosystem structural index — agents/skills/harnesses/tools/benchmarks as mol_edge structural nodes (migration 098)" linked to `[[mocs/platform-topology]]`.
- Verify: `memory_search "structural index"` returns it.

### Open questions
- Should structural edges live ALSO in `memory-hq` markdown, or Supabase-only? Lean Supabase-only (matches the parent plan's settled answer: repo stores facts, edges are derived state).
- Does `/graph`'s force layout stay performant at ~30 agents + 30 skills + tools? If node count > ~200, gate structural nodes behind a `?include=structural` flag — defer until measured.
- Re-key the `mol_edge` `src_id`/`dst_id` (currently `text`, per migration 062) for structural ids — confirmed `text` already, so no schema change beyond the CHECK.

---

## 🔌 Providers-Routing-QA — unified resolver + provider cards + smart-routing verdict

**Status:** 🚀 ready (resolver + cards + AgentList fix) · 📋 scoped-deferred (smart-routing, ship-as-opt-in) · 🔬 none.

This is an ABSORPTION plan. It forks NOTHING. The unified "resolve effective model+provider" helper lands on the `lib/ai/dispatch.ts` seam already committed in `task_plan-model-agnostic-chat.md` (Task M2) and is owned by `task_plan-model-agnostic-platform.md`. It reuses `lib/models/catalog.ts`, extends `lib/llm/provider.ts`, edits `lib/claw/llm.ts`, and lights up the shipped Agentdex / AiProvider cards from `task_plan-redesign-ai-providers.md`.

### North Star
- **Goal:** One ordered resolution chain — agent/skill model → Claude gateway → Codex gateway → API key → error — consulted by every dispatch surface (chat, n8n dispatch, qa-runner fix-attempts, skill-trainer), with the operator's per-agent/per-skill model finally reaching `spawn.ts --model`.
- **Success criteria (verifiable):**
  - A new `resolveEffectiveModel({agentSlug, skillSlug, bodyModel})` returns `{model, provider}` and is the SINGLE place id→family mapping happens (via `getModelById().provider`).
  - Setting a model on an agent in `/settings/agents` then dispatching that agent with no per-turn override sends THAT model as `--model` to the gateway (today it sends the OAuth default). Verify in `gateway_turns.model`.
  - `callClaude` and `app/api/claude-session/dispatch/route.ts` honor the full chain incl. Codex as an automatic fallback after the Claude gateway (not only for gpt-class models).
  - In lean-mode (Claude gateway only, no API-key rows) the Agentdex dropdown shows GPT/Gemini/DeepSeek when codex/openrouter/env keys are reachable — not just 3 Claude models.
  - NIM + Ollama have AI_PROVIDERS cards and MODEL_CATALOG rows; `google` is a `getLlm()` runtime family.
  - `npx tsc --noEmit`, `npm run check:retry-storm`, `npm run check:provider-agnostic` pass.
- **Hard constraints:** No third resolver — extend `getLlm`/`callClaude`/`dispatch.ts`, never parallel. ACTIVE LLM PROVIDER switch NOT deleted (only lever for global $0-marginal routing). Fail-soft everywhere: a missing `agent_library.model`/`skill_overrides`/DB-down path falls through to the next tier, never crashes a dispatch. No model version pinned in spec prose (provider-agnostic check). Retry-storm: all touched routes stay 200+`{ok:false}`.

### Why
The operator's #1 desired behaviour — "the model I set per agent/skill wins" — is FALSE in code today: `agent_library.model` and `skill_overrides` (`lib/skills/overrides.ts`, already shipped) are WRITTEN but never READ at dispatch. The chain is split between `callClaude` (gateway→api) and `dispatch-fix` (claude→codex→ai-sdk), and Codex is a model-class branch, not a fallback tier. This plan unifies them and reconciles the consciously-deferred router in `task_plan-workforce-intelligence.md:84` — the real payoff is PLAN-WINDOW budget (Opus→Haiku on the gateway via `weightForModel`, `lib/claw/plan-window.ts`), not API dollars.

### Absorbs-into (exact paths)
- Resolver helper → `lib/ai/dispatch.ts` (seam from `task_plan-model-agnostic-chat.md` M2), owned by `task_plan-model-agnostic-platform.md`.
- Edits: `lib/claw/llm.ts` (callClaude), `app/api/claude-session/dispatch/route.ts`, `lib/llm/provider.ts`.
- Reuses: `lib/models/catalog.ts`, `lib/models/recommender.ts` + `lib/agents/cache.ts`, `lib/claw/codex-gateway.ts`, `app/api/qa/dispatch-fix/route.ts`, `lib/skills/overrides.ts`.
- Cards/UI: `lib/ai/providers.ts`, `components/settings/AgentList.tsx`, `components/settings/ActiveProviderSwitch.tsx`, `app/api/gateway-status/route.ts`.

### Scope — atomic tasks (each ≤ 1 tool call, ≤ 300 lines)

**🚀 — ship now (resolver + cards + the dropdown bug):**

**PR1 — effective-model resolver (the missing top tier)**
- File: `lib/ai/dispatch.ts` (add `resolveEffectiveModel`) + `lib/llm/provider.ts` (add `familyForModel(id)` using `getModelById(id).provider` → `LlmProvider`, with gpt|codex→family handled by `shouldRouteToCodex`).
- Change: pure function returning `{model, provider}` from precedence bodyModel > agent_library.model > skill_overrides > active-provider default; fail-soft to `{undefined,'claude'}`.
- Verify: unit test — agent with stored `gpt-5.5` resolves `{model:'gpt-5.5', provider:'codex-routable'}`; missing agent falls through to `claude`.

**PR2 — wire the chain into the two resolvers**
- File: `lib/claw/llm.ts` + `app/api/claude-session/dispatch/route.ts`.
- Change: before the gateway tier, call `resolveEffectiveModel`; in the dispatch route load `agent_library.model` for `body.agentSlug` when `body.model` is absent so it flows to `spawn.ts --model`; make `shouldRouteToCodex` consider the resolved family so Codex is an automatic fallback after the Claude gateway, not only for gpt-prefixed ids.
- Verify: dispatch an agent whose stored model is `claude-haiku-4-5` with no per-turn model → `gateway_turns.model='claude-haiku-4-5'`; stored `gpt-5.5` → routes to codex-gateway.

**PR3 — NIM + Ollama provider cards**
- File: `lib/ai/providers.ts` (add `nim` + `ollama` rows; both need `lib/models/types.ts` `AiProviderKey` extended to include `'nim'|'ollama'`).
- Change: two `AI_PROVIDERS` entries (NIM api-mode `NVIDIA_NIM_API_KEY`; Ollama subscription/local `OLLAMA_BASE_URL`), matching the liquid-glass card shape.
- Verify: `/settings?tab=ai` renders NIM + Ollama cards; `tsc` passes with the widened union.

**PR4 — catalog rows + `google` runtime family**
- File: `lib/models/catalog.ts` (add NIM rows `meta/llama-3.3-70b-instruct`, `meta/llama-3.1-8b-instruct`, `deepseek-ai/deepseek-r1`; Ollama `llama3.3`; tag provider `nim`/`ollama`) + `lib/llm/provider.ts` (add `'google'` to `LlmProvider` + a `getGoogleModel` via `@ai-sdk/google` or an OpenRouter slug shim).
- Change: catalog entries (cost/latency/capabilities) so NIM/Ollama/Gemini are recommender-visible; `getLlm` gains a `google` case.
- Verify: `getAvailableModels(['nim'])` returns ≥1 row; `getLlm({provider:'google'})` constructs without throwing.

**PR5 — fix AgentList provider detection (the lean-mode Claude-only bug — highest leverage)**
- File: `components/settings/AgentList.tsx`.
- Change: build `providers` from gateway-status `codexConfigured`→add `'openai'`, `openrouterConfigured`→include openrouter-reachable models, plus env-key providers and the active `LLM_PROVIDER` family — not only `connected_accounts` rows.
- Verify: with codex configured + no API-key rows, the dropdown shows GPT models alongside Claude.

**PR6 — surface the resolved chain in gateway-status (operator visibility)**
- File: `app/api/gateway-status/route.ts` + the AI Providers tab banner.
- Change: add a `chain: string[]` field (ordered, e.g. `['agent/skill model','claude-gateway','codex-gateway','api']`) and a `qaRunnerModel` hint so the tab renders "what qa-runner will fix on".
- Verify: GET returns `chain` ending in `'api'` or `'none'`; banner shows the order.

**PR7 — relabel ACTIVE LLM PROVIDER as the global AI-SDK default**
- File: `components/settings/ActiveProviderSwitch.tsx`.
- Change: header/help copy → "Global default provider for context-free AI-SDK calls (chat fallback, qa-runner, skill-trainer). Per-agent/per-skill models take precedence." No behaviour change.
- Verify: copy renders; `check:provider-agnostic` passes (no version pins in prose).

**📋 — smart model routing (SHIP-AS-OPT-IN, deferred behind a per-agent flag):**

**PR8 — dispatch-time auto-route (recommender moved to h4)**
- File: `lib/ai/dispatch.ts` (call into `recommendModelForAgent` from `lib/models/recommender.ts`, reusing `lib/agents/cache.ts` 24h cache; swap `JUDGE_MODEL` to a Haiku-class cheap model) gated behind `agent_library.auto_route` (new boolean, default false).
- Change: when the flag is on AND the cache misses, the cheap judge picks model+provider for the resolved candidate set, then the chain proceeds; cache HIT = free. Low-stakes/background dispatches bias to cheapest-available (NIM).
- Verify: agent with `auto_route=true` + repeated identical task pays the evaluator once (cache hit on 2nd); `auto_route=false` skips the judge entirely.

### Smart-routing EVALUATION — verdict: SHIP-AS-OPT-IN (h4 trajectory regulation)
- **Is the extra cheap-eval hop worth it?** Conditionally. The judge already exists (`recommendModelForAgent`), already has a 24h cache (`lib/agents/cache.ts`) and a static fallback (`pickStaticFallback`). Moving it from click-time to dispatch-time is ~1 cache-keyed call, not new infra.
- **Cost/latency tradeoff:** ~$0.0008 and ~1–2 s on a Sonnet judge, ~5× cheaper/faster on Haiku — but ONLY on cache MISS. For a HETEROGENEOUS task stream (mixed coding/research/glue) the cache rarely helps and the hop earns its keep by down-shifting low-stakes turns to Haiku/NIM, reclaiming PLAN-WINDOW budget (the real lever, `weightForModel` Opus=5× vs Haiku=0.25×). For a UNIFORM stream (one agent, same task shape) the static per-agent default + the existing Recommend-model button is sufficient and the hop is pure overhead.
- **Verdict & slot:** SHIP-AS-OPT-IN, default OFF, per-agent `auto_route` flag (PR8). It slots at **h4 (trajectory regulation)** inside `resolveEffectiveModel` on the `lib/ai/dispatch.ts` seam — NOT a separate pre-dispatch h3 step (h3 is the environment contract / tool budget; model selection is a trajectory decision). A static per-task heuristic is the fallback already (`pickStaticFallback` by capability + LiveBench), so "skip" is not on the table — the cheap-eval is strictly an opt-in upgrade over a heuristic that already ships. This reconciles the deferred router in `task_plan-workforce-intelligence.md:84`: it is worth it precisely when it saves plan-window budget, opt-in keeps it off for uniform streams.

### ACTIVE LLM PROVIDER decision
KEEP it, relabel (PR7). It is NOT replaced by an Agentdex default — different axis (global context-free family vs per-agent model). qa-runner's default fix model is NOT the switch-as-model; it is the targeted agent's resolved model via `dispatch-fix` once PR1/PR2 land. The switch remains the only zero-redeploy lever to flip ALL fallback traffic to a $0-marginal provider (NIM).

### Open questions
- Should `auto_route` (PR8) live on `agent_library` or a separate `routing_policy` table? (Lean: a boolean column, migrate later if it needs scope.)
- Does `@ai-sdk/google` warrant a real dependency (PR4) or is an OpenRouter `google/gemini-2.5-*` slug shim enough for v1? (Lean: slug shim first, native package only if multimodal needed.)
- Codex-as-automatic-fallback (PR2): confirm `ADR 002` single-tenant constraint doesn't break when a non-gpt agent's Claude gateway is down and we fall to Codex — may need a capability check.

---

## 📋 Settings UX parity — Skills mirrors Agents + Create cards + dynamic provider dropdown

**Status:** 📋 scoped-deferred. Group C (dynamic dropdown) is BLOCKED on the providers-routing sub-plan shipping `GET /api/models/providers/available`. Groups A (Skills parity) and B (Create cards) are 🚀-ready independently once C's endpoint lands (or can ship against a thin interim endpoint, see Task C1).

**North Star**
- **Goal:** Make the Settings → Skills surface MIRROR the Agentdex (manual model dropdown + Recommend + Recommend-all), give Agents+Skills a Connectors-style "Create" intent card, and source both model dropdowns from connected providers — not a Claude-only static list.
- **Success criteria:**
  - Each `SkillCard` in `components/settings/SkillsList.tsx` renders a manual model `<select>` identical to `AgentCard.tsx` `ModelPickerRow` that `PATCH /api/skills/[slug]` with `{model}` on change.
  - `SkillsList` grows a header with a "Recommend models for all" button that loops `recommend()` at 3-at-a-time concurrency (the `AgentList.recommendAll` pattern).
  - Agents tab AND Skills tab each render a Create card mirroring `DescribeConnectionCard`; agent prose routes to agent creation, skill prose to skill scaffold, both with an `operator_tasks` manual fallback.
  - Both the Agentdex dropdown and the new Skills dropdown show every model reachable via `detectAvailableProviders` (respects the disabled-provider toggle + OpenRouter), not just the 3 Claude rows.
  - `npx tsc --noEmit`, `npm run check:retry-storm`, `npm run check:provider-agnostic`, `npm run check:topology` all pass; verified at 1280px AND 375px.
- **Hard constraints:** Skills surface EXTENDS the Agents surface — do NOT fork a parallel component tree; factor shared logic (`useRecommendAll` hook, a shared `ModelPickerRow`) rather than copy-paste. No model version pinned in prose. Every new route returns `200 + {ok:false,error}` on transient failure. Write-size ≤ 300 lines / 10 KB per call. The `skill_overrides` write path is already shipped — do not re-implement it.

**Why**
The Agentdex (built by `task_plan-redesign-ai-providers.md`, Tasks 10-13) already has the per-row model dropdown, per-row Recommend, and list-level Recommend-all. Skills got only the per-row Recommend (PR #388) and is missing the dropdown + Recommend-all. The Connectors "Create" intent card (`task_plan-connector-intent.md`) is a reusable describe→classify→route primitive that Agents/Skills never inherited. And `AgentList.tsx` rolls its own provider detection that drifts from canonical `lib/models/providers.ts#detectAvailableProviders` — the root cause of the Claude-only dropdown in lean-mode. This is an `h3` (environment-contract) consolidation: one provider detector feeds all model-picker surfaces.

**Absorbs into (exact paths)**
- EXTEND `task_plan-redesign-ai-providers.md` (append "Phase 18 — settings UX parity"). Surfaces reused: `components/settings/AgentCard.tsx` (ModelPickerRow lines 197-237), `components/settings/AgentList.tsx` (recommendAll lines 117-133, availableModels lines 77-80), `components/settings/AgentListHeader.tsx` (AgentdexHeader.onRecommendAll), `app/api/models/recommend/route.ts`, `lib/models/recommender.ts#recommendModelForAgent`.
- REUSE write path from `task_plan-model-agnostic-platform.md`: `lib/skills/overrides.ts`, `app/api/skills/[slug]/route.ts` (PATCH/DELETE), `app/api/skills/route.ts` (GET overlay), `app/api/models/recommend-skill/route.ts`.
- REUSE describe→classify→route from `task_plan-connector-intent.md`: `app/api/connected-accounts/describe/route.ts`, `components/settings/AccountList.tsx` (DescribeConnectionCard).
- DEPEND ON providers-routing sub-plan for `GET /api/models/providers/available` (`lib/models/providers.ts#detectAvailableProviders`, migration 082 `ai_provider_disabled`, `lib/models/provider-toggle.ts`).

**Scope**
IN: Skills manual dropdown + Recommend-all; shared `useRecommendAll` hook; Create intent cards on Agents+Skills tabs; `POST /api/agents/describe` + `POST /api/skills/describe`; routing the Agentdex + Skills dropdowns through the canonical available-providers endpoint.
OUT (follow-ups): unifying the Agentdex `skillsCount` (derived from `agent.tools`) with the real `.claude/skills` inventory (cosmetic, noted in exploration); a full agent-spec form editor (Create card dispatches the existing agent-generator/scaffold flow, it does not build a WYSIWYG editor); per-business model pickers reusing the same endpoint.

---

### Group A — Skills parity with the Agentdex (🚀 after C, or against interim endpoint)

#### Task A1 — Shared `useRecommendAll` hook
- File: `lib/hooks/useRecommendAll.ts` (new)
- Change: extract the 3-worker bounded-concurrency loop from `AgentList.recommendAll` (AgentList.tsx lines 117-133) into `useRecommendAll<T>(items, recommendOne)` returning `{ runAll, busy }`.
- Verify: `tsc --noEmit`; `AgentList` still compiles when refactored to consume it (Task A2).

#### Task A2 — Refactor AgentList to consume the shared hook (no behaviour change)
- File: `components/settings/AgentList.tsx`
- Change: replace the inline `recommendAll` + `globalBusy` with `useRecommendAll`; keep `onRecommendAll` wired to `AgentdexHeader`.
- Verify: Agentdex "Recommend models for all" still fires N recommendations 3-at-a-time; `tsc --noEmit`.

#### Task A3 — Add a SkillsList header with "Recommend models for all"
- File: `components/settings/SkillsListHeader.tsx` (new, split to respect write-size)
- Change: mirror `AgentdexHeader` (skill count / verified / draft tallies already in SkillsList lines 169-202) + a Recommend-all button calling `useRecommendAll(skills, recommend)`.
- Verify: button disabled when `skills.length===0` or no providers; spinner during run; 375px layout intact.

#### Task A4 — Add a manual model `<select>` to SkillCard
- File: `components/settings/SkillsList.tsx` (SkillCard, near the model line 341-344)
- Change: render a dropdown over `availableModels` (new prop) that on change calls `PATCH /api/skills/[slug]` with `{model}` (reuse the existing recommend() PATCH branch, lines 110-122, minus rationale); keep the Recommend + Reset buttons.
- Verify: picking a model persists (reload shows `modelOverridden` dot); empty-providers shows the `(no providers connected)` option like AgentCard line 229.

#### Task A5 — Thread availableModels into SkillsList
- File: `components/settings/SkillsList.tsx` (top of component)
- Change: fetch the canonical available-provider set (Task C2 endpoint) and compute `availableModels = MODEL_CATALOG.filter(m => providers.includes(m.provider))`, identical to AgentList lines 77-80; pass to each SkillCard + the header.
- Verify: in lean-mode shows Claude rows; after enabling another provider on the AI tab, the Skills dropdown widens without a redeploy.

---

### Group B — "Create" intent-card parity (🚀; reuses connector-intent primitive)

#### Task B1 — `POST /api/agents/describe`
- File: `app/api/agents/describe/route.ts` (new)
- Change: clone the classify shape of `app/api/connected-accounts/describe/route.ts` (getLlm + temperature 0 + cacheWrap). Classify operator prose into `{ kind: 'agent' | 'manual', name?, slug?, description? }`. On `agent`, return a pre-filled spec stub (name/slug/description) for the client to POST to `/api/agents`; on `manual`, `createTask()` an `operator_tasks` row. Always `200 + {ok}`.
- Verify: curl with "an agent that drafts weekly LinkedIn posts" returns `kind:'agent'` + slug; LLM error returns `{ok:false}` not 5xx.

#### Task B2 — `POST /api/skills/describe`
- File: `app/api/skills/describe/route.ts` (new)
- Change: same classifier; classify into `{ kind: 'skill' | 'manual', name?, slug?, intent? }`. On `skill`, file an `operator_tasks` row that hands the brief to the `skill-trainer` flow (no auto-write of SKILL.md — `skill-trainer` produces `status: draft` per its spec); on `manual`, same fallback. Always `200 + {ok}`.
- Verify: curl with "a skill that computes MRR from a Stripe export" returns `kind:'skill'`; retry-storm-safe.

#### Task B3 — Reusable `DescribeIntentCard` component
- File: `components/settings/DescribeIntentCard.tsx` (new)
- Change: lift the visual + input shape of `AccountList.tsx` DescribeConnectionCard (lines 996-1075) into a generic card taking `{ endpoint, placeholder, onResult }`. Keep the liquid-glass styling + Enter-to-submit + `Create` label.
- Verify: renders identically to the Connectors card; `tsc --noEmit`.

#### Task B4 — Mount Create card on the Agents tab
- File: `app/(protected)/settings/agents/page.tsx` (above `<AgentList />`)
- Change: render `DescribeIntentCard` pointed at `/api/agents/describe`; on `kind:'agent'` POST the stub to `/api/agents` then refresh; on `manual` show the Inbox link.
- Verify: creating an agent adds a card without a page reload; manual fallback lands in the inbox.

#### Task B5 — Mount Create card on the Skills tab
- File: `app/(protected)/settings/page.tsx` (SkillsTab, above `<SkillsList />`)
- Change: render `DescribeIntentCard` pointed at `/api/skills/describe`; surface the filed `skill-trainer` task + Inbox link.
- Verify: skill prose files a draft-skill task; 375px intact.

---

### Group C — Dynamic provider dropdown (BLOCKED on providers-routing sub-plan)

#### Task C1 — Note + interim shim (only if providers-routing slips)
- File: `task_plan-redesign-ai-providers.md` (Phase 18 notes)
- Change: record that Group C's dropdown depends on `GET /api/models/providers/available`. If that endpoint is not yet shipped by the providers-routing plan, land a thin interim route returning `detectAvailableProviders(userId)` here and hand ownership back later.
- Verify: dependency is explicit in the plan; no duplicate detector logic ships.

#### Task C2 — `GET /api/models/providers/available`
- File: `app/api/models/providers/available/route.ts` (new — confirm ownership with providers-routing sub-plan first)
- Change: `guardRequest` + return `{ providers: await detectAvailableProviders(g.userId) }` (the enabled set, disabled-toggle subtracted). Distinct from existing `GET /api/models/providers` which returns only the DISABLED list.
- Verify: curl returns `['anthropic']` in lean-mode; enabling OpenRouter via env surfaces `'openrouter'`.

#### Task C3 — Route the Agentdex through the canonical detector
- File: `components/settings/AgentList.tsx`
- Change: delete the inline detection (lines 27 `AI_PLATFORMS`, 39-67 gateway/accounts union) and fetch `/api/models/providers/available` instead; keep `availableModels` filter (lines 77-80) unchanged.
- Verify: dropdown respects the operator's disabled-provider toggle + includes OpenRouter; `tsc --noEmit`; no regression to Recommend-all.

**Open questions**
1. Confirm ownership of `GET /api/models/providers/available` — does the providers-routing sub-plan ship it, or does this plan (Task C2) own it? (Avoid two routes.)
2. Should the Skills Create flow auto-scaffold a `status: draft` SKILL.md immediately, or only file a `skill-trainer` brief? Current plan files the brief (B2) to keep the verify-gate intact — confirm with operator.
3. Should the Agents Create card pre-fill a spec form, or dispatch the existing `agent-generator` agent end-to-end? Current plan returns a stub for `POST /api/agents` (lightest path); a full agent-generator dispatch is a heavier follow-up.

---

## 🚀 Durable Chat + Persistent Notifications

**Status:** 🚀 ready — every primitive already ships; this wires them. Operator approves the phase before kickoff (Long-Horizon Protocol).

### North Star
- **Goal:** A chat turn survives tab/app close — its reply persists and a notification fires even with no browser open, and reopening the session re-attaches to the still-running turn.
- **Success criteria:**
  - Close the tab mid-turn → the assistant reply still lands in `chat_messages` (verified by reload after the gateway job finishes, browser never re-polled).
  - A turn that finishes while the operator is away fires `notifyOperator(...,'chat-turn',...)` (slack now; webpush when VAPID lands).
  - Reopen a session whose turn is still running → UI shows a live spinner + resumes the poll (no silent dead reply).
  - Error notifications (enqueue / network / 402-cap / crash) persist and appear in `/inbox` off the chat page.
- **Hard constraints:**
  - `chat_messages` metadata shape unchanged — `persistCompletedTurn` stays the single writer; no double-write between reconciler and a late browser poll.
  - New cron returns **200 + `{ok:false}`** on transient failure + gates on `CRON_SECRET`-or-bot-bearer (retry-storm + cron-route rules). Reconciler is cron-driven — never a kept-alive stream (sse pitfall #1).
  - Reconciler runs inside gateway `RETAIN_MS` (10min) so results persist before GC.
  - h4 layer (trajectory regulation) — no new approval gates removed; the reconciler only persists + notifies, never mutates production.

### Why
Today execution is detached but **persistence is 100% browser-poll-gated**: `persistCompletedTurn` (`lib/chat/persist-completed-turn.ts:333`) only runs when a browser poll sees `status==='done'`. Close the tab → poll loop dies → gateway GCs the result after 10min → reply lost. Errors are worse: `setError()` (`PlatformChat.tsx:194`) is component-local React state, discarded on navigation, never persisted (only the crash path at `poll/route.ts:173` survives reload). This is the missing backend half of `task_plan-mobile-copilot.md` — a 30-min phone turn is useless if it dies when the operator pockets the device.

### Absorbs-into (exact paths)
- Substrate: `supabase/migrations/053_background_tasks.sql`, `lib/background-tasks/dispatch.ts`, `app/api/background-tasks/[id]/dispatch/route.ts`, `lib/auth/bot.ts`.
- Persist seam: `lib/chat/persist-completed-turn.ts`, `app/api/platform-chat/poll/route.ts`, `lib/claw/gateway-jobs.ts:getGatewayJob`.
- Notify: `lib/notifications/dispatch.ts`, `lib/notifications/webpush.ts`, `lib/notify/wake.ts`, `public/sw.js`.
- Inbox: `lib/approvals/system-alerts.ts`, `components/inbox/types.ts`, `app/(protected)/inbox/page.tsx`.
- Cron exemplar (copy the 200-pattern + auth): `app/api/cron/optimizer-scan-failures/route.ts`.

### Scope
In: persist jobId at enqueue; server reconciler; re-attach on reopen; DB-backed error persistence + `/inbox` chat-turn source; `chat-turn` notification category. Out (follow-ups): server-side gateway job cancel; durable gateway job store beyond 10min; BusinessChat parity (mirror after platform lands).

---

### Phase A — Persist the in-flight jobId at dispatch (foundation)

**Task A1 — chat_sessions in-flight columns**
- File: `supabase/migrations/098_chat_inflight_turn.sql` (new)
- Change: add `inflight_job_id text`, `inflight_started_at timestamptz`, `inflight_drained boolean default false` to `chat_sessions` (idempotent `add column if not exists`; partial index on `inflight_job_id where inflight_drained=false`).
- Verify: migration re-runs clean; `psql \d chat_sessions` shows the columns.

**Task A2 — set in-flight on enqueue**
- File: `app/api/platform-chat/route.ts` (after the successful `enqueueGatewayJob` block ~line 373)
- Change: write `inflight_job_id=enqueued.jobId, inflight_started_at=now(), inflight_drained=false` onto `sessionRow.id` via a new `setInflightTurn()` helper (add to `lib/chat/sessions.ts`).
- Verify: send a turn, row shows `inflight_job_id` before any poll lands.

**Task A3 — clear in-flight in persistCompletedTurn**
- File: `lib/chat/persist-completed-turn.ts` (Stage 3, after `appendMessage`)
- Change: set `inflight_drained=true, inflight_job_id=null` for `input.sessionId` (claim-once guard — the function is the single writer). Add `clearInflightTurn()` to `lib/chat/sessions.ts`.
- Verify: after a normal poll completes, the session row's `inflight_drained=true`.

---

### Phase B — Server-side reconciler (drains detached turns, no browser)

**Task B1 — reconciler core (reuse gateway poll + persist)**
- File: `lib/chat/reconcile-inflight.ts` (new)
- Change: `reconcileInflightTurns()` — select `chat_sessions` where `inflight_drained=false AND inflight_started_at > now()-9min` (inside `RETAIN_MS`), for each call `getGatewayJob(...)` (`lib/claw/gateway-jobs.ts`); on `done`/`error` call `persistCompletedTurn(...)` (which flips `inflight_drained`); skip `pending`/`running`. Per-session try/catch, fail-soft. Every fetch already carries `AbortSignal.timeout` via `getGatewayJob`.
- Verify: unit-call against a finished gateway job with no browser; `chat_messages` gains the assistant row.

**Task B2 — reconciler cron route (200-pattern + bot auth)**
- File: `app/api/cron/chat-turn-drain/route.ts` (new — copy auth + 200-on-transient shape from `app/api/cron/optimizer-scan-failures/route.ts`)
- Change: `CRON_SECRET`-or-`authBotToken` gate → call `reconcileInflightTurns()` → return `{ok:true, drained:n}`; on any throw return **200 + `{ok:false,error}`** (cron-route rule). `maxDuration=60`.
- Verify: `curl` with bearer returns 200; `npm run check:cron-route` clean.

**Task B3 — fire-and-forget self-kick at enqueue (drain within seconds, not next tick)**
- File: `app/api/platform-chat/route.ts` (alongside A2)
- Change: after setting in-flight, fire-and-forget `POST /api/cron/chat-turn-drain` with the bot bearer (mirror `fireAndForgetDispatch` in `persist-completed-turn.ts:41`, `AbortSignal.timeout(5_000)`, no await). The cron-job.org tick is the safety net; the self-kick reconciles the common case fast.
- Verify: close tab immediately after sending; reply persists within ~one reconciler pass without the scheduled tick.

**Task B4 — register the cron**
- File: `vercel.json` (cron entry, title `Nexus: chat-turn-drain`, every 2min) + `memory/platform/SECRETS.md` (note `CRON_SECRET` reuse, no new secret)
- Change: add the schedule so cron-job.org picks it up (lean-mode scheduler); titled `Nexus:` so it auto-wires into `/cron-health`.
- Verify: appears in cron-job.org sync; `/cron-health` lists it.

---

### Phase C — Re-attach on reopen

**Task C1 — expose in-flight jobId on session load**
- File: `app/api/platform-chat/sessions/[id]/messages/route.ts`
- Change: include `inflight_job_id` + `inflight_started_at` (when `inflight_drained=false`) in the response.
- Verify: GET a session with a running turn returns the jobId.

**Task C2 — resume poll on reopen**
- File: `components/platform-chat/PlatformChat.tsx` (the `useEffect([activeSessionId])` at line 327)
- Change: after loading history, if the response carries a live `inflight_job_id`, set `busy=true`, show the spinner, and call the existing `pollUntilDone(jobId, sessionId)` to re-attach (it already persists + renders on `done`). Guard against double-attach.
- Verify: start a turn, reload the page → spinner resumes, reply lands when the gateway finishes.

---

### Phase D — Persistent notification center (errors + completions)

**Task D1 — `chat-turn` notification category**
- File: `lib/notifications/dispatch.ts`
- Change: add `'chat-turn'` to `NotificationCategory` + `DEFAULT_ENABLED` (`['slack','webpush']`). No other change — fan-out is reused.
- Verify: `tsc --noEmit`; `notifyOperator(uid,'chat-turn',{...})` resolves channels.

**Task D2 — notify on reconciled completion/error**
- File: `lib/chat/reconcile-inflight.ts` (B1)
- Change: after `persistCompletedTurn`, fire-and-forget `notifyOperator(userId,'chat-turn',{title, body, link_href:'/manage-platform/chat?session=<id>', severity: crashed?'critical':'info'})` — only when reconciled server-side (operator was away). Reuses `wake()`/webpush implicitly via the fan-out.
- Verify: finish a turn with no tab open → slack ping arrives (webpush skipped:'unconfigured' until VAPID).

**Task D3 — persist non-crash errors onto the user message**
- File: `app/api/platform-chat/route.ts` (the enqueue-fail + 402-cap branches)
- Change: on enqueue/cap failure, write `metadata.turn_error={code,message}` onto the just-persisted user `chat_messages` row (extend the existing crash-metadata seam). Add `markTurnError()` to `lib/chat/sessions.ts`.
- Verify: force an enqueue failure → reload shows the error, not a silent gap.

**Task D4 — `/inbox` chat-turn source**
- File: `lib/approvals/system-alerts.ts` + `components/inbox/types.ts`
- Change: add `loadChatTurnAlerts(db,userId)` returning recent `chat_messages` rows with `metadata.crashed` or `metadata.turn_error` (last 7d) as `FleetPendingItem` with `kind:'chat-turn'`; widen `SystemAlertItem.source` union + the fleet `ApprovalKind` to include `'chat-turn'`; add to `loadAllSystemAlerts`.
- Verify: a crashed turn appears as an info banner in `/inbox`, deep-linking to the session.

**Task D5 — surface error banner from persisted state (not just React state)**
- File: `components/platform-chat/PlatformChat.tsx` (history-load map at line 341)
- Change: read `m.metadata?.turn_error` alongside `crashed` so a reload renders the error inline (today only `crashed` survives).
- Verify: reload after a forced enqueue error → banner shows.

---

### Open questions
- Webpush is staged-disabled (`lib/notifications/webpush.ts`) until `web-push` npm + VAPID keys land in Doppler — flag as a prerequisite for "wake my closed phone". Slack path works today; ship that first, webpush activates on env.
- Reconciler cadence: 2min cron + enqueue self-kick covers the 10min `RETAIN_MS`. If turns routinely exceed 10min (mobile-copilot 30/60-min selector), a durable gateway job store is a follow-up — flag in `task_plan-mobile-copilot.md` Phase 1 risk.
- BusinessChat parity: same seam (`persistCompletedTurn` already takes `taskScope`/`sessionTagFallback`); mirror after platform lands rather than forking.

---

## 📋 Local-First Hosting — Mac Mini as observation host + high-autonomy sandbox lane

**Status:** 📋 scoped-deferred. The observation half is assembly of shipped pieces and could ship first-week; the high-autonomy whole-machine lane is net-new + the riskiest surface in the repo and is ADR-gated.

### North Star
- **Goal:** Run the full lean-mode bundle on an always-on Mac Mini as the operator's local OBSERVATION + high-autonomy-sandbox host beside KVM4, so the operator watches agents act on a macOS desktop — without dissolving the sandbox boundary that bounds agent autonomy.
- **Success criteria (verifiable):**
  - [ ] `docker compose -f docker-compose.mac.yaml up` brings up all 5 services (nexus-app + claude-gateway + codex-gateway + nexus-sandbox + n8n) + ollama on Apple Silicon, each `DOPPLER_TOKEN`-only.
  - [ ] `curl -X POST http://localhost:8080/exec -d '{"script":"echo hi","image":"alpine"}'` returns `ok:true` on the Mini (sandbox verified under macOS Docker/Podman VM).
  - [ ] The Tauri desktop window (`apps/desktop/`) opens the Mini's local UI; `/audit` terminal streams the Mini's agent activity.
  - [ ] `LLM_PROVIDER=ollama` produces real on-box inference (the `lib/llm/providers/ollama.ts` throw is gone).
  - [ ] The high-autonomy lane is reachable ONLY via an explicit gate (`lib/kill-switches.ts` key, off by default) and runs under a dedicated non-admin macOS user; a single kill command halts it.
  - [ ] Any host-role change lands a `[[mocs/platform-topology]]` infra-change atom + an AGENTS.md Topology edit in the same PR.
- **Hard constraints:**
  - **No regression to the Coolify/KVM4 prod stack** — purely additive; KVM4 paused-not-deleted on any cutover (mirrors `task_plan-lean-mode.md` Reversibility insurance).
  - **nexus-sandbox stays the DEFAULT execution boundary even locally.** Whole-machine access is a separate gated lane, never a `LOCAL_MODE` relaxation.
  - **Doppler-token-only secret pattern preserved** (AGENTS.md "Docker images and docker-compose"). No per-var secrets pasted into the Mac compose.
  - **Provider-agnostic stays the rule** (`npm run check:provider-agnostic`).

### Why (grounded)
- `task_plan-desktop-app.md` North Star *literally names the Mac mini* and is mostly shipped (LOCAL_MODE, `docker-compose.local.yaml`, `scripts/local-install.sh`, export-import, `apps/desktop/` Tauri shell). This plan = make that the operator's PRIMARY runtime on an always-on Mini + add a high-autonomy local lane.
- Three real deltas the desktop plan does NOT cover: (a) `docker-compose.local.yaml:21-78` ships only `nexus + db + ollama` — it omits the `claude-gateway`/`codex-gateway`/`nexus-sandbox`/`n8n` the operator's real workload needs; (b) no Coolify-equivalent story on macOS; (c) no "loose whole-machine access" capability — `lib/platform/local-mode.ts` only relaxes auth/Composio/secrets, not the sandbox.
- `docs/adr/002-codex-gateway-sandbox.md:31` *explicitly rejected* a laptop VM for autonomous runs ("laptop sleeps, network changes, IP rotation"). An always-on Mini overturns that — but the new ADR must cite + overturn it, not silently re-litigate.

### Absorbs-into (exact paths)
- EXTEND `task_plan-desktop-app.md` — add **Phase 7 (full-bundle Mac compose)** + **Phase 8 (high-autonomy lane)**; close its open **Phase 4 (node-cron sidecar)** as a dependency for a primary Mini.
- REUSE `task_plan-lean-mode.md` spine: `services/lean-deploy/`, `services/nexus-sandbox/`, `scripts/migrate-to-lean-kvm.mjs`, the `lib/lean-mode.ts` flag, `app/api/sandbox/exec/route.ts`.
- REUSE shipped: `lib/platform/local-mode.ts`, `docker-compose.local.yaml`, `apps/desktop/`, `/api/admin/export` (Phase 5), `lib/kill-switches.ts`, `app/(protected)/audit/page.tsx` + `lib/audit/sources.ts`.
- NEW ADR `docs/adr/NNN-mac-mini-host.md` (orchestrator decision + ADR-002 overturn).

### Scope
**In:** full-bundle Mac compose, Apple-Silicon sandbox verification, desktop+audit observation wiring, Ollama activation, the gated whole-machine lane design, node-cron sidecar, cloudflared-on-macOS path, topology atom.
**Out (future):** promoting the Mini to PRIMARY (post-soak), gVisor/Firecracker sandbox upgrade (ADR-006 precondition, customer-code only), per-business sandbox containers locally.

### FIRST WEEK — observation host (low-risk, additive)

**Task 1 — Full-bundle Mac compose**
- File: `docker-compose.mac.yaml` (new)
- Change: Extend `docker-compose.local.yaml` to add `claude-gateway`, `codex-gateway`, `nexus-sandbox`, `n8n` on a shared bridge network with aliases; each service's `environment:` block is `DOPPLER_TOKEN`-only.
- Verify: `docker compose -f docker-compose.mac.yaml config` validates; `up` reaches healthy on all services.

**Task 2 — Verify rootless sandbox on Apple Silicon**
- File: `services/nexus-sandbox/README.md` (extend "Host fallback" section)
- Change: Document running `services/nexus-sandbox/server.mjs` under macOS — `podman machine` (or the host-systemd→launchd equivalent) since macOS already nests Podman in a Linux VM; note `privileged:true` behaves differently.
- Verify: `curl POST localhost:8080/exec {"script":"echo hi"}` → `ok:true` on the Mini.

**Task 3 — Point the desktop window + audit at the Mini**
- File: `apps/desktop/README.md` (extend "URL configuration (future v2)") + `apps/desktop/src-tauri/tauri.conf.json`
- Change: Document the `~/Library/Application Support/Nexus/url.txt` → `http://localhost:3000` toggle so the desktop shell wraps the Mini; confirm `/audit` (`lib/audit/sources.ts`) streams local activity.
- Verify: Desktop window loads the Mini UI; `/audit` panes show Mini agent rows.

**Task 4 — Activate the Ollama adapter**
- File: `lib/llm/providers/ollama.ts`
- Change: Replace the `throw` in `getOllamaModel()` with `createOllama({ baseURL })` (`ollama-ai-provider`, per the file's own TODO) so on-box Apple-Silicon inference works.
- Verify: `LLM_PROVIDER=ollama` smoke test returns text without hitting Claude Max.

### FIRST MONTH — orchestrator + high-autonomy lane (ADR-gated)

**Task 5 — ADR: orchestrator choice + ADR-002 overturn**
- File: `docs/adr/NNN-mac-mini-host.md` (new) + `docs/adr/INDEX.md`
- Change: Decide (b1) Linux-VM-on-Mini-running-Coolify (reuses `migrate-to-lean-kvm.mjs` verbatim) vs (b2) direct `docker compose` + launchd + cloudflared launchd service. Cite + overturn `docs/adr/002-codex-gateway-sandbox.md:31` for an always-on Mini; document required always-on settings.
- Verify: ADR indexed; decision references the exact tradeoff.

**Task 6 — High-autonomy lane design (the risky, net-new part)**
- File: `task_plan-desktop-app.md` (new Phase 8 section) + `lib/kill-switches.ts` (add a `whole_machine_lane` key, default OFF)
- Change: Define an explicit gated lane: dedicated non-admin macOS user for the agent, TCC/Full-Disk-Access scoped per-app, SIP intact, an allow/deny path list, and a hardware kill (`launchctl bootout` + `podman kill --all`) wired to the new switch. nexus-sandbox remains default; this lane is opt-in per task, never per session.
- Verify: Lane is unreachable with the switch off; kill command halts a running agent.

**Task 7 — node-cron sidecar (desktop Phase 4) for cron independence**
- File: per `task_plan-desktop-app.md` Phase 4 (open)
- Change: In-process `node-cron` reading `vercel.json` + `~/.nexus/disabled-crons.json`, so a primary Mini doesn't depend on cron-job.org hitting KVM4.
- Verify: A local cron fires on schedule with `LOCAL_MODE=1`; KVM4 unaffected.

**Task 8 — cloudflared-on-macOS + topology atom**
- File: `services/lean-deploy/README.md` (extend "DNS + ingress") + `memory_atom` write
- Change: Document `cloudflared` as a launchd service mapping `nexus.<domain> -> localhost:3000` on the Mini; write a `[[mocs/platform-topology]]` infra-change atom + AGENTS.md Topology edit per the Post-infrastructure-change protocol the FIRST time a host role changes.
- Verify: `memory_search "Mac Mini"` returns the atom; `npm run check:topology` passes.

### Open questions
- Orchestrator: VM-Coolify (reuse `migrate-to-lean-kvm.mjs`, which is hardcoded to `COOLIFY_KVM4_*` + Coolify REST) vs direct-compose+launchd (macOS-visible, loses Coolify UI). Resolved in Task 5 ADR.
- State sync KVM4↔Mini: reuse `/api/admin/export` tar.gz (Phase 5) for cutover/rollback — confirm `pg_dump` round-trips against the local `postgres:16` schema.
- Promotion gate: how long an uptime soak before the Mini becomes primary and KVM4 drops to warm standby (mirror lean-mode's 7-day pause window).


---

## 📚 Learning Interleaving — concept curriculum + difficulty-aware interleave + self-distill

**Status**: 🚀 ready to ship (concept curriculum + interleave upgrade) · 🔬 research (self-distilled agentic reinforcement). Absorb as **Phase 24 of `task_plan-learning-system.md`** — do NOT open a new plan file.

**North Star**
- **Goal**: Teach the operator how their own platform *works* (LLMs, harness h2–h5, skills/sub-harnesses) on the already-shipped `/learn` surface, with interleaving that mixes that concept track into atom-fact review by desirable difficulty.
- **Success criteria**: (a) a `concept` CardKind renders multi-paragraph explainers sourced from `AGENTS.md` h2–h5 + `memory/molecular/mocs/agent-framework-survey.md`, graded by the existing Feynman grader; (b) `interleave()` is FSRS-retrievability-aware and weaves concept + atom cards without back-to-back same-atom variants; (c) verified agent artifacts (SKILL.md / sub_harness) can seed a concept lesson; (d) `npx tsc --noEmit` + `npm run check:retry-storm` pass.
- **Hard constraints**: molecular graph stays source of truth (concept lessons are a *new* source, never edit atoms from `/learn`); migration 023's CHECK is *relaxed additively* (existing rows untouched); no new Anthropic spend in the hot path beyond the existing 1/min Feynman grader; each task ≤ 300 lines / 10 KB; **interface-only** — zero model changes (`AGENTS.md#harness-taxonomy`).

**Why**: `/learn` is fully shipped (routes, `lib/learning/*`, 13 components, migration 023, FSRS-4) but is 100% atom-fact cards for one audience. The brain-dump wants the operator taught the *concepts the agents embody*, plus a real interleaving function. Both are extensions of existing surfaces — re-inventing either is a failure.

**Absorbs-into (exact paths)**
- Home plan: `task_plan-learning-system.md` (Phase 24 appended to its `## Progress`).
- Interleave: `app/api/learn/session/route.ts:68-88` (`interleave()`).
- Kind: `lib/types.ts:457` (`CardKind`) + `supabase/migrations/023_learning_system.sql:15` (CHECK).
- Generators/sync/grader reused: `lib/learning/card-generator.ts`, `lib/learning/atom-sync.ts`, `app/api/learn/grade-feynman/route.ts`, `app/api/learn/path/route.ts`.
- Curriculum source: `AGENTS.md` (h2–h5 taxonomy) + `memory/molecular/mocs/agent-framework-survey.md` + `memory/molecular/atoms/voyager-iterative-curriculum-absorbed.md`.
- Self-distill (CITE, don't rebuild): `.claude/agents/skill-trainer.md`, `.claude/agents/loop-runner.md` (mode=synthesize, lines 135-165), `app/api/skills/[slug]/promote/route.ts`, `app/api/sub-harnesses/[slug]/promote/route.ts`; layer declarations next to `task_plan-harness-absorption.md`.

### Scope A — Concept curriculum (🚀 ship)

A `concept` lesson is a hand-authored / MOC-derived explainer (markdown body) graded by the Feynman grader. It is a new lesson **source**, distinct from atom-fact cards; it rides the same FSRS scheduler, path UI, and stats.

- **A1 — relax the kind CHECK** — File: `supabase/migrations/098_concept_cards.sql` — Change: additive migration — `alter table flashcards drop constraint ...kind_check` then re-add with `'concept'` added; `IF NOT EXISTS`-safe; backfill nothing. Verify: re-running is a no-op; `insert ... kind='concept'` succeeds.
- **A2 — widen the type union** — File: `lib/types.ts:457` — Change: `CardKind = ... | 'concept'`; add optional `bodyMd?: string` + `conceptSlug?: string` to `Flashcard`. Verify: `npx tsc --noEmit` clean.
- **A3 — concept lesson source** — File: `lib/learning/concept-source.ts` (new) — Change: parse `concept` lesson seeds from a hand-authored manifest `lib/learning/concept-curriculum.ts` (one lesson per h2–h5 layer + "what is an LLM" + "what is a skill/sub-harness"), each carrying `front` (title), `bodyMd` (explainer), `referenceContext` (for grading). Pure, no I/O. Verify: unit-import returns ≥ 6 seeds.
- **A4 — author the curriculum manifest** — File: `lib/learning/concept-curriculum.ts` (new) — Change: 6–8 explainers paraphrased from `AGENTS.md` h2–h5 + agent-framework-survey MOC (provider-agnostic prose — no model-version pins). Verify: `npm run check:provider-agnostic` passes.
- **A5 — wire concept seeds into sync** — File: `lib/learning/atom-sync.ts` — Change: after atom reconcile, upsert `concept` cards from `concept-source.ts` keyed on `conceptSlug` (mirror the SHA-stale path using a manifest hash). Verify: cron run inserts concept cards once, idempotent on re-run.
- **A6 — render concept cards** — File: `components/learn/ConceptCard.tsx` (new) + `components/learn/ReviewCard.tsx` (edit switch) — Change: render `bodyMd` then reuse the Feynman "explain it back" textarea → `grade-feynman`. Verify: `/learn/session` shows a concept card end-to-end.
- **A7 — grader accepts concept bodyMd** — File: `app/api/learn/grade-feynman/route.ts` — Change: when the card has `bodyMd`, use it as `reference` (today falls back to `back`). One-line. Verify: grading a concept card returns a score.

### Scope B — Difficulty-aware interleaving (🚀 ship)

- **B1 — interleave upgrade** — File: `app/api/learn/session/route.ts:68-88` — Change: replace round-robin-by-moc with a scheduler that (i) buckets by `(track ∈ {concept|atom}, moc_slug)`, (ii) orders within a session by FSRS `retrievability` (weakest interleaved among stronger — desirable difficulty), (iii) forbids back-to-back same-`atom_slug` (cloze variants). Keep the `size*3` over-fetch. Verify: a session with 2 cloze variants of one atom never places them adjacent; concept + atom cards alternate.
- **B2 — pull concept track into the batch** — File: `app/api/learn/session/route.ts` — Change: the due query already selects all non-archived kinds, so concept cards flow in automatically once A1–A6 land; assert the fallback (lowest-retrievability) also includes concept cards. Verify: `dueCount` includes concept cards on a quiet day.
- **B3 — declare the harness layer** — File: `task_plan-harness-absorption.md` (append one line) — Change: note operator-deck interleaving = curriculum scheduling (NOT an agent `h4` concern); agent-side interleaved reasoning is the deferred `h4` item (Scope D). Verify: line present, links to `AGENTS.md#harness-taxonomy`.

### Scope C — Agent→operator distill pipe (🚀 thin ship)

- **C1 — promote-triggered concept seed** — File: `lib/learning/distill-bridge.ts` (new) — Change: `conceptSeedFromVerifiedArtifact({kind:'skill'|'sub-harness', slug})` builds a `concept` lesson seed ("How `<slug>` works") from the verified SKILL.md / HARNESS.md frontmatter `intent` + steps. Pure. Verify: returns a seed for a known verified slug.
- **C2 — fire on promote** — File: `app/api/skills/[slug]/promote/route.ts` + `app/api/sub-harnesses/[slug]/promote/route.ts` — Change: after the draft→verified flip, best-effort enqueue the concept seed (fail-soft; never block promote). Verify: promoting a skill creates one concept card; promote still succeeds if seeding throws.

### Scope D — Self-distilled agentic reinforcement (🔬 research only)

NOT shippable as a new loop — the capability already exists as the **union** of `skill-trainer` (reinforcement: grade-until-3-consecutive-passes) + `loop-runner` mode=synthesize (self-distillation: explorer→verifier→replayable sub_harness). Research deliverable, not code:
- Name + link the two primitives as one "self-distilled reinforcement" capability in `task_plan-harness-absorption.md`; do not fork a third trainer.
- Spec (research) surfacing skill-trainer iteration grades + synthesize explorer/verifier trajectories as a learnable telemetry stream — connects to `task_plan-workforce-intelligence.md` Task 2 (per-agent capability scoring). The agent never self-grades; verification stays the reward (`AGENTS.md` Ralph-loop "verify-then-propose").
- Honesty note: process-reward / weight fine-tuning is OUT — interface-only-adaptation invariant.

### Scope E — Agent-side interleaved reasoning (🔬 research, deferred)

The secondary reading of "interleaving" (interleaved tool-use/reasoning for agents) is an `h4` trajectory-regulation concern, partly covered by Ralph-loop `iteration-plan` cadence, higher-risk, unbuilt. Park next to `task_plan-harness-absorption.md` h4 surfaces; do not start until Scopes A–C land.

### Open questions
- Concept manifest: hand-authored (A4) first, or auto-derive lessons from MOC bodies via a cron Claude pass? Recommend hand-author 6–8 to seed, auto-derive later (reuses `atom-sync` SHA machinery).
- Should concept lessons appear as their own `/learn` path *unit* ("Platform internals") or be folded under existing MOC units? Recommend a dedicated synthetic unit (extend `app/api/learn/path/route.ts` grouping).
- C2 seeding: enqueue immediately vs let the nightly `sync-learning-cards` cron pick it up? Recommend cron (keeps promote routes side-effect-light, respects retry-storm rule).

---

## 🚀 Gamify-LifeOS — Accomplishments (real-revenue) + Health LifeOS domain

**Status:** 🚀 Accomplishments v1 ready-ish (pure-read, zero new-entity risk) · 📋 LifeOS/Health scoped-deferred (needs the `life_domain` entity) · 🔬 "what the live event IS" research-only.

This is the most greenfield cluster in the brain-dump, but it still plugs into real shipped surfaces — it builds **zero new engines**. Accomplishments is a read-model over the dashboard's existing revenue truth; LifeOS is one extension of the departments abstraction.

### North Star
- **Goal:** Give the operator a glanceable, motivating Accomplishments/levels surface driven by REAL revenue, then seed the Business-OS → Life-OS transition by modelling Health as the first agentic `life_domain` reusing the department/ecosystem fleet machinery.
- **Success criteria:**
  - `/accomplishments` renders tiered achievements (first business · first niche · per-niche revenue tiers · combined-revenue tiers) computed from REAL `experiment_metrics` + `revenue_events`, never a mock.
  - Crossing a revenue tier flips an `accomplishments_unlocked` row and fires `notifyOperator(…, 'milestone', …)` once (idempotent — no re-notify on persistent state).
  - A derived `operatorLevel` + a locked "Level N unlocks: live event" hook render on the page.
  - `/health` ships as the first LifeOS domain backed by a non-revenue `life_domain` row that a department/team attaches to — the org-chart, departments registry, and ecosystem adapters are reused unchanged.
- **Hard constraints:**
  - Accomplishments is **pure-read** over `experiment_metrics`/`revenue_events` — no new revenue store, no write to the revenue tables. Revenue stays in sync with `/dashboard` automatically.
  - Reuse the shipped Learn gamification primitives (`DailyStreak`, `StreakBadge`, `CalendarHeatmap`) — do NOT build a second XP/streak system.
  - `life_domain` must NOT route through `checkKillSwitch(businessSlug)` / `kpi_targets` / revenue aggregation — life domains have no revenue. Bypass, don't fake a $0 business.
  - Mobile-first: the level track must pass at 375px (operator runs Nexus from his phone — `AGENTS.md`). Verify the `iphone` Playwright project.
  - h-taxonomy: Accomplishments is an h3 read-surface (it surfaces operator state); the `life_domain`→team binding is h4 (trajectory regulation for a non-revenue fleet). No model-version pins in prose.

### Why
No accomplishments/level/health surface exists today (grep: zero `rank`/`tier`/`achievement`/`life-OS` primitives). But the substrate is fully present: the Learn system is a domain-agnostic progress engine bound to flashcards, and `app/api/dashboard/fleet/route.ts` already sums real per-business revenue. Accomplishments is the cheapest high-motivation win in the backlog because it is a pure-read consumer. LifeOS is the strategic arc — the departments abstraction was built ecosystem-agnostic precisely so non-product domains could plug in; Health is the proof.

### Absorbs into (exact paths)
- **Revenue truth (reuse, don't rebuild):** `app/api/dashboard/fleet/route.ts` (the `payloadUsd()` extractor + `kind=revenue` sum), `lib/dashboard/fleet-types.ts`, `app/api/dashboard/route.ts` (date-ranged `groupSeries`), `revenue_events` (`lib/database.types.ts:2426`), `experiment_metrics` (`lib/database.types.ts:1146`).
- **Gamification primitives (reuse):** `lib/types.ts:537` `DailyStreak`, `components/learn/StreakBadge.tsx`, `components/learn/CalendarHeatmap.tsx`, `app/(protected)/learn/stats/page.tsx`, `supabase/migrations/023_learning_system.sql` (DB pattern).
- **Business/niche source:** `lib/business/db.ts` (`listBusinessesForUser`), `lib/business/types.ts:77` (`BusinessRow.niche`), `lib/businesses/mcp-manifest.ts:164` (`NICHE_PROFILES`, 8 niches).
- **Notification fan-out (reuse + 1 category):** `lib/notifications/dispatch.ts` (`notifyOperator`, `NotificationCategory`).
- **Motivational render slot (reuse):** `components/dashboard/CoachingCard.tsx`, `lib/coaching/insights.ts` (`CoachingInsight` shape).
- **Nav:** `components/layout/Sidebar.tsx` BASE_NAV (lines 157-169 — register `/accomplishments` + `/health` next to `/learn`).
- **LifeOS extension home:** `task_plan-departments-and-ecosystems.md`, `lib/teams/departments.ts`, `app/(protected)/teams/org-chart/page.tsx`, `lib/teams/store.ts` (`teams`+`team_members`, migration 060).
- **Loops (optional progress signal):** `supabase/migrations/094_loops.sql`, `task_plan-loops-sprints.md` — a daily Health habit is a natural `mode='iterate'` Loop; a revenue tier is a natural Loop end-outcome.

### Scope
- **In (v1, 🚀):** Accomplishments page + catalog + unlock table + all-time revenue rollup + recompute cron + `milestone` notification + level-gate hook + CoachingCard nudge + sidebar entry.
- **In (v1, 📋 scoped):** `life_domain` entity + `/health` page + Health department spec + department→life_domain binding. Ships AFTER Accomplishments — it carries new-entity risk.
- **Out:** What the "live event" literally is (webinar/cohort/celebration) — 🔬 open question. Habit→Loop auto-dispatch for Health. Relationships/Finance/other LifeOS domains. Leaderboards (single-operator platform — no peers to rank against).

### Atomic tasks — Accomplishments (🚀 v1)
- **A1 — unlock-state migration** · File: `supabase/migrations/098_accomplishments.sql` · Change: idempotent `create table if not exists accomplishments_unlocked (user_id text, achievement_id text, tier int, unlocked_at timestamptz default now(), primary key(user_id, achievement_id))` + deny-by-default RLS mirroring migration 023 · Verify: re-run is a no-op; `\d accomplishments_unlocked` shows the PK.
- **A2 — achievement catalog** · File: `lib/accomplishments/catalog.ts` · Change: static `ACHIEVEMENTS[]` defining tiers — `first_business`, `first_niche`, per-niche revenue tiers (key off `NICHE_PROFILES`), combined-revenue tiers (e.g. $100/$1k/$10k/$100k), each with `{id, label, kind, threshold, niche?, level}` · Verify: `tsc --noEmit`; unit-import lists ≥ 4 tier families.
- **A3 — all-time revenue rollup** · File: `lib/accomplishments/revenue.ts` · Change: `getAllTimeRevenue(userId)` reusing the `payloadUsd` extractor + `kind=revenue` sum from `fleet/route.ts` but with no `gte('ts')` window, plus `revenue_events.amount_usd`, returning `{ combined, byNiche, byBusiness }` · Verify: returns real sums for a seeded business; no mock import.
- **A4 — evaluation helper** · File: `lib/accomplishments/evaluate.ts` · Change: `evaluate(userId)` compares `getAllTimeRevenue` + business/niche counts (`listBusinessesForUser`) against `catalog.ts`, derives `operatorLevel`, returns newly-crossed tiers · Verify: synthetic input crossing $100 yields exactly the `combined_100` tier.
- **A5 — read API** · File: `app/api/accomplishments/route.ts` · Change: `GET` → `{ ok, unlocked, locked, operatorLevel, nextTier }`; pure-read; returns 200 with `{ok:false}` on transient failure (retry-storm rule) · Verify: `curl` returns tiers for the owner; 401 unauth.
- **A6a — page scaffold** · File: `app/(protected)/accomplishments/page.tsx` · Change: `'use client'` page shell fetching `/api/accomplishments`, header + empty section markers (level track, achievement grid, live-event hook) · Verify: renders at 1280px and 375px.
- **A6b — level track + grid** · File: `app/(protected)/accomplishments/page.tsx` (Edit) · Change: fill the achievement grid reusing `StreakBadge` visual language + a progress bar toward `nextTier`; locked tiers greyed · Verify: locked vs unlocked styling differs; `iphone` Playwright project passes.
- **A6c — level-gated live-event hook** · File: `app/(protected)/accomplishments/page.tsx` (Edit) · Change: render a locked "Level N unlocks: live event" card with a deep-link placeholder gated on `operatorLevel` · Verify: card shows lock state below current level, unlock affordance at/above.
- **A7 — milestone notification category** · File: `lib/notifications/dispatch.ts` · Change: add `'milestone'` to `NotificationCategory` + a `DEFAULT_ENABLED['milestone'] = ['slack','webpush']` row · Verify: `tsc --noEmit`; `notifyOperator(u,'milestone',…)` type-checks.
- **A8 — recompute cron** · File: `app/api/cron/accomplishments-recompute/route.ts` · Change: calls `evaluate`, upserts newly-crossed tiers into `accomplishments_unlocked`, fires `notifyOperator(…, 'milestone', …)` ONCE per new tier (transition guard reads prior rows so persistent state never re-notifies) · Verify: `npm run check:cron-route` passes (returns 200 on transient failure); second run with no new revenue sends zero notifications.
- **A9 — sidebar + coaching nudge** · File: `components/layout/Sidebar.tsx` (Edit, lines 157-169) + `lib/coaching/insights.ts` (Edit) · Change: add `{ href:'/accomplishments', label:'Wins', icon:Trophy }` to BASE_NAV; emit a `CoachingInsight` when a tier was unlocked in the last 24h · Verify: nav link routes; CoachingCard shows the "you won this" nudge.

### Atomic tasks — Health LifeOS (📋 scoped-deferred, ships after A-series)
- **L1 — life_domain entity migration** · File: `supabase/migrations/099_life_domains.sql` · Change: idempotent `life_domains (slug text pk, user_id text, kind text default 'life', label text, status text, created_at)` — deliberately NO revenue/kpi columns; deny-by-default RLS · Verify: re-run no-op; column set has no `kpi_targets`.
- **L2 — life-domain types + reader** · File: `lib/life/types.ts` + `lib/life/db.ts` · Change: `LifeDomainRow` + `listLifeDomainsForUser(userId)` mirroring `lib/business/db.ts` shape · Verify: `tsc --noEmit`.
- **L3 — Health department spec** · File: `lib/teams/departments.ts` (Edit) + `.claude/agents/departments/health/health-lead.md` · Change: register a `health` department (roles: `fitness-coach`, `nutrition-planner`; ecosystemKinds: `memory`,`search`,`llm`; NO revenue approval gates) forked from `.claude/agents/departments/_template.md` · Verify: `npm run check:agent-spec-freshness` + `check:provider-agnostic` pass.
- **L4 — team→life_domain binding** · File: `app/api/teams/spawn/route.ts` (Edit) + `lib/teams/store.ts` (Edit) · Change: accept `life_domain_slug` as an alternative to `business_slug`; when present, skip every revenue/`checkKillSwitch` path · Verify: spawning a Health team inserts `team_members` rows and never calls `checkKillSwitch`.
- **L5 — Health habit-log table + page** · File: `supabase/migrations/099_life_domains.sql` (extend) + `app/(protected)/health/page.tsx` · Change: `life_habit_log (user_id, domain_slug, day date, payload jsonb)` + a `'use client'` page reusing `CalendarHeatmap` + `DailyStreak` for daily habit logging (the streak engine generalised from flashcard-review to arbitrary daily events) · Verify: renders at 375px; logging a day advances the streak.
- **L6 — sidebar + framing** · File: `components/layout/Sidebar.tsx` (Edit) + `task_plan-departments-and-ecosystems.md` (Edit) · Change: add `/health` nav link; append a "LifeOS domains" section to the departments plan documenting the `life_domain` extension as the Business-OS → Life-OS spine · Verify: nav routes; plan cross-links `lib/life/db.ts`.

### Open questions
- 🔬 **What IS the level-gated "live event"?** Webinar, operator-only celebration screen, cohort unlock? v1 ships the level-crossing detection + notification + a render slot; the event content is a separate plan. Do not build event infra here.
- 📋 **life_domain vs business_operators flag?** This plan picks a dedicated `life_domains` table (cleaner RLS, no revenue columns to null out). Alternative: a `kind='life'` flag on `business_operators`. Decide before L1 — the table choice is the only irreversible bit.
- 📋 **Should Accomplishments also read goal/issue completion** (`lib/goals/ancestry.ts`, migrations 047-052) as a non-revenue accomplishment source? Deferred — v1 keys purely off revenue + business/niche counts to stay pure-read.
- 📋 **Habit→Loop auto-dispatch:** should a Health habit BE a `mode='iterate'` Loop (migration 094) dispatched daily, rather than a manual log? Natural fit but adds cost-guard surface to a non-revenue domain — defer to a LifeOS-v2 plan.

---

## Implementation log

### Session 2026-05-30 — Wave 1 kickoff
Implementing the foundation slice (see Waves above). Order: provider expansion (cards+catalog+dynamic dropdown+relabel) → effective-model resolver (PR1) → audit memory-observability (Akashic Thread B). Each driven to green on `tsc` + targeted Playwright + `npm run check:all`, committed per atomic task, shipped as draft PR(s).

#### Progress
- [x] **Provider expansion (Providers-Routing PR3/PR4/PR5/PR6a)** — SHIPPED + verified.
  - `AiProviderKey` += `nim`/`ollama`; NVIDIA NIM + Ollama cards (`lib/ai/providers.ts`); catalog rows (`lib/models/catalog.ts`).
  - `gateway-status` returns `envProviders[]` (presence-only) + `chain[]`.
  - Dynamic dropdown: extracted `lib/models/detect-providers.ts` (pure, 16-assertion unit test); `AgentList` consumes codex/openrouter/env signals.
  - **Verified E2E (authenticated Playwright):** NIM+Ollama cards render; Agentdex dropdown shows `GPT-5.5 / GPT-5 mini / o4` alongside Claude when the Codex gateway is configured (was Claude-only before). `tests/playwright/settings-providers-expansion.spec.ts`.
- [x] **Audit memory-observability (Akashic Thread B)** — SHIPPED + verified.
  - New 'Memory calls' AuditSource (Brain icon) — `tool_call_audit` lens on `mcp_server='memory-hq'`.
  - `/api/memory/event` instrumented with fail-soft `recordToolCall` (the in-app write path the MCP server + agents + CLI all route through).
  - **Verified E2E (authenticated Playwright):** Memory pane selectable on `/audit`. `tests/playwright/audit-memory-pane.spec.ts`.
- [ ] **Effective-model resolver (Providers-Routing PR1/PR2)** — DEFERRED (needs live-gateway E2E; not shippable unverified). FINDINGS below.

#### Findings — effective-model resolver (the "per-agent model wins" ask)
Code-traced this session; it is a deeper change than the sub-plan assumed:
- `agent_library.model` IS stored but read by NOTHING at dispatch (confirmed). The per-agent model is currently display + cost-weighting only.
- `app/api/claude-session/dispatch/route.ts:517` uses `shouldRouteToCodex(body.model)` for codex routing, but the **Claude-gateway fall-through (`:602` `dispatchToOpenClaw`) passes NO `model` at all** — so "per-agent Claude model wins" requires threading a `model` arg through `dispatchToOpenClaw` → gateway-call → `spawn.ts --model`, not just a resolver.
- Wiring it half-way (codex-routing only) yields a confusing asymmetry (a GPT model routes to codex, but Haiku does nothing) — worse than not shipping.
- **Why deferred:** the only honest verification is a live gateway dispatch checking `gateway_turns.model`, which this session can't exercise (no running gateway to dispatch to). Belongs in a focused session with the operator's gateway up.
- **Clean execution path:** (1) pure `resolveEffectiveModel({agentSlug,skillSlug,bodyModel})` in `lib/ai/dispatch.ts` (precedence bodyModel > `agent_library.model` > `skill_overrides` > active-provider default; family via `getModelById().provider` + `shouldRouteToCodex`); (2) thread the resolved model through `dispatchToOpenClaw` + gateway-call → `spawn.ts --model`; (3) load `agent_library.model` when `body.model` absent (reuse the `isPlatformBriefEnabled` agent_library query at `:320`); (4) verify with a real dispatch → assert `gateway_turns.model`. ACTIVE LLM PROVIDER switch already correctly scoped (its copy is the PR7 relabel).
